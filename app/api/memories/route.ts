import { NextResponse } from "next/server";
import { authenticate, safeError } from "@/lib/erna/guard";
import { deleteAllMemories, listMemories } from "@/lib/erna/memory";

/** Everything Erna remembers about the signed-in user, with where each came from. */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);
    const memories = await listMemories(supabase, user.id);
    return NextResponse.json({ memories });
  } catch (error) {
    return safeError(error, "Failed to load memories");
  }
}

/** Forget everything. Conversations, tasks and notes are untouched. */
export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);
    const deleted = await deleteAllMemories(supabase, user.id);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return safeError(error, "Failed to forget memories");
  }
}
