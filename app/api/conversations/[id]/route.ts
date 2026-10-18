import { NextResponse } from "next/server";
import { authenticate, safeError } from "@/lib/erna/guard";

// Deletes one conversation. Its messages go with it via the
// messages.conversation_id ON DELETE CASCADE in supabase/schema.sql.
// Long-term memories are a separate table and are never touched here.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Conversation id required" }, { status: 400 });
    }

    const { supabase, user } = await authenticate(request);

    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");

    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return safeError(error, "Failed to delete conversation");
  }
}
