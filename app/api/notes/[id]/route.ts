import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteNote } from "@/lib/erna/knowledge";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await deleteNote(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
