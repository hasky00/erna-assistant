import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/api";
import { deleteNote } from "@/lib/erna/knowledge";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createApiClient(request);
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
