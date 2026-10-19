import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, safeError } from "@/lib/erna/guard";
import { deleteMemory, updateMemory } from "@/lib/erna/memory";

const patchSchema = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  category: z.enum(["profile", "preference", "relationship", "work", "life", "general"]).optional(),
  importance: z.number().int().min(1).max(5).optional(),
});

/** Edit one memory: fix a fact Erna got slightly wrong. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await authenticate(request);
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid memory update" }, { status: 400 });
    }

    const memory = await updateMemory(supabase, user.id, id, parsed.data);
    if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    return NextResponse.json({ memory });
  } catch (error) {
    return safeError(error, "Failed to update memory");
  }
}

/** Forget one memory. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await authenticate(request);
    await deleteMemory(supabase, user.id, id);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return safeError(error, "Failed to forget memory");
  }
}
