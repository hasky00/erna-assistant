import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApiClient } from "@/lib/supabase/api";
import { getAnthropic, getAnthropicModel } from "@/lib/erna/llm";
import { composeSystemPrompt, getPersonalityPrompt } from "@/lib/erna/prompts";
import { ensureProfile, getOpenTasks, getRelevantMemories } from "@/lib/erna/memory";
import { ernaTools, runTool } from "@/lib/erna/tools";

// How many assistant<->tool round trips a single chat turn may take before we
// stop calling tools and force a written answer. Research questions can chain
// web_search -> fetch_url -> wikipedia_lookup, so give Erna some room.
const MAX_TOOL_ROUNDS = 8;
const MAX_OUTPUT_TOKENS = 2048;

// A chat turn can run several tool round trips; let the serverless function live long enough.
export const maxDuration = 120;

const requestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(12000),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: Request) {
  try {
    const supabase = await createApiClient(request);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const lastUserMessage = [...parsed.data.messages].reverse().find((message) => message.role === "user");
    if (!lastUserMessage) {
      return NextResponse.json({ error: "A user message is required." }, { status: 400 });
    }

    const profile = await ensureProfile(supabase, user.id, user.email);
    const [personalityPrompt, memories, tasks, conversationId] = await Promise.all([
      getPersonalityPrompt(supabase, user.id),
      getRelevantMemories(supabase, user.id, lastUserMessage.content),
      getOpenTasks(supabase, user.id),
      getOrCreateConversation(supabase, user.id, parsed.data.conversationId, lastUserMessage.content),
    ]);

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: lastUserMessage.content,
    });

    // Bump conversation activity timestamp so lists ordered by updated_at work
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);

    const system = composeSystemPrompt({ personalityPrompt, profile, memories, tasks });

    // Anthropic requires strictly alternating user/assistant turns starting
    // with a user turn; merge any accidental repeats from the client.
    const messages: Anthropic.MessageParam[] = normalizeHistory(parsed.data.messages);

    const anthropic = getAnthropic();
    const model = getAnthropicModel();
    let finalContent = "";
    const toolResults: Array<{ name: string; result: unknown }> = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages,
        tools: ernaTools,
        tool_choice: { type: "auto" },
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        finalContent = extractText(response.content);
        break;
      }

      // Run every requested tool, then hand all results back in one user turn.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const result = await executeToolCall(supabase, user.id, toolUse);
        toolResults.push({ name: toolUse.name, result });
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
          is_error: isErrorResult(result),
        });
      }
      messages.push({ role: "user", content: results });
    }

    if (!finalContent) {
      // We left the loop with tool calls still outstanding (or an empty reply).
      // Ask once more with tools disabled so the turn ends in a real answer
      // rather than a placeholder, since the tool side effects already happened.
      const wrapUp = await anthropic.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages,
        tools: ernaTools,
        tool_choice: { type: "none" },
      });
      finalContent = extractText(wrapUp.content).trim();
    }

    if (!finalContent) {
      finalContent = "I ran the tool work, but couldn't turn it into an answer. The changes above were saved — ask me again and I'll summarize them.";
    }

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: finalContent,
      metadata: { toolResults, model },
    });

    // Bump again after assistant reply
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);

    return NextResponse.json({
      conversationId,
      message: {
        role: "assistant",
        content: finalContent,
      },
      toolResults,
    });
  } catch (error) {
    const normalized = normalizeChatError(error);
    return NextResponse.json({ error: normalized.message }, { status: normalized.status });
  }
}

/** Collapse consecutive same-role messages and make sure history starts with a user turn. */
function normalizeHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of history) {
    const previous = out[out.length - 1];
    if (previous && previous.role === message.role && typeof previous.content === "string") {
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }
    out.push({ role: message.role, content: message.content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

function extractText(content: Anthropic.ContentBlock[]) {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function isErrorResult(result: unknown) {
  return typeof result === "object" && result !== null && "ok" in result && (result as { ok: unknown }).ok === false;
}

function normalizeChatError(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number((error as { status?: unknown }).status);

    if (status === 429) {
      return {
        status: 429,
        message: "Anthropic rate limit or credit limit reached. Check the Anthropic console for this API key's usage and billing.",
      };
    }

    if (status === 401) {
      return {
        status: 401,
        message: "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in the server environment.",
      };
    }

    if (status === 404) {
      return {
        status: 500,
        message: `Model "${getAnthropicModel()}" was not found. Check ANTHROPIC_MODEL.`,
      };
    }
  }

  if (error instanceof Error) {
    return { status: 500, message: error.message };
  }

  return { status: 500, message: "Chat failed unexpectedly." };
}

async function getOrCreateConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | undefined,
  firstMessage: string,
) {
  if (conversationId) {
    const { data } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (data?.id) return data.id as string;
  }

  const title = firstMessage.length > 48 ? `${firstMessage.slice(0, 48)}...` : firstMessage;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

async function executeToolCall(
  supabase: SupabaseClient,
  userId: string,
  toolUse: Anthropic.ToolUseBlock,
) {
  try {
    return await runTool({
      supabase,
      userId,
      name: toolUse.name,
      argumentsText: JSON.stringify(toolUse.input ?? {}),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tool failed.",
    };
  }
}
