import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/erna/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;

    if (!conversationId) {
      return NextResponse.json({ error: "Conversation id required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership (and get title)
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id, title")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (convError || !conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Load messages in chronological order
    const { data: msgs, error: msgsError } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .in("role", ["user", "assistant"]) // only display turns; tool/system are internal
      .order("created_at", { ascending: true })
      .returns<Array<{ role: "user" | "assistant"; content: string; created_at: string }>>();

    if (msgsError) {
      return NextResponse.json({ error: msgsError.message }, { status: 500 });
    }

    const messages: ChatMessage[] = (msgs || []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    return NextResponse.json({
      conversationId: conv.id,
      title: conv.title,
      messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load conversation messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
