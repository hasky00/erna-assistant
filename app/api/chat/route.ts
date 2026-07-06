import { NextResponse } from "next/server";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOpenAI, getOpenAIModel } from "@/lib/openai";
import { composeSystemPrompt, getPersonalityPrompt } from "@/lib/erna/prompts";
import { ensureProfile, getOpenTasks, getRelevantMemories } from "@/lib/erna/memory";
import { ernaTools, runTool } from "@/lib/erna/tools";

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
    const supabase = await createClient();
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

    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: composeSystemPrompt({ personalityPrompt, profile, memories, tasks }),
      },
      ...parsed.data.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const openai = getOpenAI();
    let finalContent = "";
    const toolResults: Array<{ name: string; result: unknown }> = [];

    for (let i = 0; i < 4; i += 1) {
      const completion = await openai.chat.completions.create({
        model: getOpenAIModel(),
        messages,
        tools: ernaTools,
        tool_choice: "auto",
        temperature: 0.7,
      });

      const assistantMessage = completion.choices[0]?.message;
      if (!assistantMessage) {
        throw new Error("OpenAI returned no message.");
      }

      messages.push(assistantMessage);

      if (!assistantMessage.tool_calls?.length) {
        finalContent = assistantMessage.content || "";
        break;
      }

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== "function") {
          continue;
        }
        const result = await executeToolCall(supabase, user.id, toolCall);
        toolResults.push({ name: toolCall.function.name, result });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    if (!finalContent) {
      finalContent = "I handled the tool work, but I need one more prompt to turn it into a clean answer.";
    }

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: finalContent,
      metadata: { toolResults },
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

function normalizeChatError(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    const code = "code" in error ? String((error as { code?: unknown }).code) : "";

    if (status === 429 || code === "insufficient_quota") {
      return {
        status: 429,
        message: "OpenAI quota exceeded. Add billing/credits to the OpenAI project for this API key, or use a key from a project with available quota.",
      };
    }

    if (status === 401) {
      return {
        status: 401,
        message: "OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local.",
      };
    }
  }

  if (error instanceof Error) {
    return { status: 500, message: error.message };
  }

  return { status: 500, message: "Chat failed unexpectedly." };
}

async function getOrCreateConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  toolCall: ChatCompletionMessageToolCall,
) {
  if (toolCall.type !== "function") {
    return { ok: false, error: "Unsupported tool call type." };
  }

  try {
    return await runTool({
      supabase,
      userId,
      name: toolCall.function.name,
      argumentsText: toolCall.function.arguments,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tool failed.",
    };
  }
}
