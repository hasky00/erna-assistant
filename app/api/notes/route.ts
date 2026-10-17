import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, safeError } from "@/lib/erna/guard";
import { listNotes, saveNote, searchKnowledge } from "@/lib/erna/knowledge";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(50000),
  source_url: z.string().url().max(2000).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);

    const q = new URL(request.url).searchParams.get("q")?.trim();
    const notes = q ? await searchKnowledge(supabase, user.id, q) : await listNotes(supabase, user.id);
    return NextResponse.json({ notes });
  } catch (error) {
    return safeError(error, "Failed to load notes");
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const note = await saveNote(
      supabase,
      user.id,
      parsed.data.title,
      parsed.data.body,
      parsed.data.source_url ?? null,
    );
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return safeError(error, "Failed to save note");
  }
}
