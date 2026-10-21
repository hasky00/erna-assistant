import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropic, getAnthropicModel } from "@/lib/erna/llm";
import { authenticate, enforceChatRateLimit, AuthError } from "@/lib/erna/guard";
import { composeSystemPrompt, getPersonalityPrompt } from "@/lib/erna/prompts";
import { ensureProfile, getOpenTasks, getRelevantMemories } from "@/lib/erna/memory";
import { ernaTools, runTool } from "@/lib/erna/tools";

// How many assistant<->tool round trips a single chat turn may take before we
// stop calling tools and force a written answer. Research questions can chain
// web_search -> fetch_url -> wikipedia_lookup, so give Erna some room.
const MAX_TOOL_ROUNDS = 8;
const MAX_OUTPUT_TOKENS = 4096;
// How many stored turns to rebuild from the database for context.
const HISTORY_TURNS = 40;

// A chat turn can run several tool round trips; let the serverless function live long enough.
export const maxDuration = 120;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const MAX_ATTACHMENT_BYTES = 4_500_000; // Netlify function body cap is ~6 MB; base64 adds a third.

const attachmentSchema = z.object({
  name: z.string().min(1).max(200),
  media_type: z.enum([...IMAGE_TYPES, "application/pdf"]),
  data: z.string().min(1).max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4), // base64
});

export type ChatAttachment = z.infer<typeof attachmentSchema>;

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
    .max(200),
  // Attached to the *last* user message only. Earlier attachments live on as a
  // "[attached: name]" note in history, not as bytes.
  attachments: z.array(attachmentSchema).max(3).optional(),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);
    await enforceChatRateLimit(supabase, user);

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

    const attachments = parsed.data.attachments ?? [];
    const attachmentNote = attachments.length
      ? `\n\n[attached: ${attachments.map((a) => a.name).join(", ")}]`
      : "";

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: lastUserMessage.content + attachmentNote,
      metadata: attachments.length
        ? { attachments: attachments.map((a) => ({ name: a.name, media_type: a.media_type })) }
        : null,
    });

    // Bump conversation activity timestamp so lists ordered by updated_at work
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);

    // History comes from the database, not the client: it is the one place
    // that still knows what tools returned in earlier turns. The client's
    // copy is only the fallback for a brand-new conversation.
    const stored = await loadStoredHistory(supabase, user.id, conversationId);
    const history =
      stored.length > 0
        ? stored
        : parsed.data.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    const recentUserText = [...history, lastUserMessage]
      .filter((m) => m.role === "user")
      .slice(-4)
      .map((m) => m.content)
      .join("\n");

    const system = composeSystemPrompt({ personalityPrompt, profile, memories, tasks, recentUserText });

    // Anthropic requires strictly alternating user/assistant turns starting
    // with a user turn; merge any accidental repeats.
    const messages: Anthropic.MessageParam[] = normalizeHistory([
      ...history,
      { role: "user", content: lastUserMessage.content },
    ]);
    if (attachments.length) attachToLastUserTurn(messages, attachments);

    // Static prompt + tool definitions first with cache_control, so repeated
    // rounds within a turn (and the next turn) reuse the cached prefix.
    const systemBlocks: Anthropic.TextBlockParam[] = [
      { type: "text", text: system.static, cache_control: { type: "ephemeral" } },
      { type: "text", text: system.dynamic },
    ];
    const tools: Anthropic.Tool[] = ernaTools.map((tool, i) =>
      i === ernaTools.length - 1 ? { ...tool, cache_control: { type: "ephemeral" } } : tool,
    );

    const anthropic = getAnthropic();
    const model = getAnthropicModel();
    let finalContent = "";
    const toolResults: Array<{ name: string; result: unknown }> = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemBlocks,
        messages,
        tools,
        tool_choice: { type: "auto" },
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "max_tokens") {
        finalContent = `${extractText(response.content)}\n\n(I ran out of room — say "continue" and I'll pick up where I left off.)`;
        break;
      }

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
        const result = await executeToolCall(supabase, user.id, toolUse, profile?.timezone, conversationId);
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
        system: systemBlocks,
        messages,
        tools,
        tool_choice: { type: "none" },
      });
      finalContent = extractText(wrapUp.content).trim();
    }

    if (!finalContent) {
      finalContent = "I ran the tool work, but couldn't turn it into an answer. The changes above were saved — ask me again and I'll summarize them.";
    }

    const { error: assistantInsertError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: finalContent,
      metadata: { toolResults, model },
    });
    if (assistantInsertError) {
      // The conversation may have been deleted mid-turn. Still return the
      // reply, but log it so the gap in history is explainable.
      console.error("[erna] failed to store assistant message", assistantInsertError.message);
    }

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
    if (error instanceof AuthError) return error.toResponse();
    const normalized = normalizeChatError(error);
    return NextResponse.json({ error: normalized.message }, { status: normalized.status });
  }
}

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  metadata: { toolResults?: Array<{ name: string; result: unknown }> } | null;
};

/**
 * Rebuild the conversation from the database, folding each assistant turn's
 * tool results back in as a compact note so Erna remembers task ids, pages
 * she read, and numbers she computed instead of re-running everything.
 */
async function loadStoredHistory(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, metadata")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS)
    .returns<StoredMessage[]>();
  if (error) throw error;

  const rows = (data || []).reverse();
  // The current user message was inserted just before this call; drop it so
  // it isn't duplicated when we append it explicitly.
  if (rows.length && rows[rows.length - 1].role === "user") rows.pop();

  return rows.map((row) => {
    if (row.role !== "assistant" || !row.metadata?.toolResults?.length) {
      return { role: row.role, content: row.content };
    }
    const notes = row.metadata.toolResults
      .map((t) => `${t.name}: ${compact(t.result)}`)
      .join("\n");
    return { role: "assistant", content: `${row.content}\n\n[tool results from this turn]\n${notes}` };
  });
}

function compact(value: unknown, max = 700) {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

/** Turn uploaded files into Claude image/document blocks on the final user turn. */
function attachToLastUserTurn(messages: Anthropic.MessageParam[], attachments: ChatAttachment[]) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.content !== "string") return;

  const blocks: Anthropic.ContentBlockParam[] = attachments.map((a) =>
    a.media_type === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: a.data },
          title: a.name,
        }
      : {
          type: "image",
          source: { type: "base64", media_type: a.media_type, data: a.data },
        },
  );
  blocks.push({ type: "text", text: last.content });
  last.content = blocks;
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

    // Operator details go to the server log; the person in the app gets a
    // plain sentence they can act on.
    if (status === 429) {
      console.error("[erna] Anthropic 429: rate or credit limit reached for this API key.");
      return { status: 503, message: "Erna is busy right now. Try again in a minute." };
    }

    if (status === 401) {
      console.error("[erna] Anthropic 401: ANTHROPIC_API_KEY was rejected.");
      return { status: 503, message: "Erna is having trouble on the server. Try again shortly." };
    }

    if (status === 404) {
      console.error(`[erna] Anthropic 404: model "${getAnthropicModel()}" not found. Check ANTHROPIC_MODEL.`);
      return { status: 503, message: "Erna is having trouble on the server. Try again shortly." };
    }
  }

  // Never leak Postgres / SDK internals to the client.
  console.error("[erna] chat failed", error);
  return { status: 500, message: "Chat failed unexpectedly. Please try again." };
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
  timezone?: string | null,
  conversationId?: string | null,
) {
  try {
    return await runTool({
      supabase,
      userId,
      name: toolUse.name,
      argumentsText: JSON.stringify(toolUse.input ?? {}),
      timezone,
      conversationId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tool failed.",
    };
  }
}
