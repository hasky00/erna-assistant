import { NextResponse } from "next/server";
import { authenticate, safeError } from "@/lib/erna/guard";
import { deleteNote } from "@/lib/erna/knowledge";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await authenticate(request);

    await deleteNote(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error, "Failed to delete note");
  }
}
