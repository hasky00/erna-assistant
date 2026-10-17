import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, safeError } from "@/lib/erna/guard";
import { deleteTask, rescheduleTask, setTaskStatus } from "@/lib/erna/memory";

const patchSchema = z.object({
  status: z.enum(["open", "done", "archived"]).optional(),
  due_at: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await authenticate(request);

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    let task = null;
    if (parsed.data.status) {
      task = await setTaskStatus(supabase, user.id, id, parsed.data.status);
    }
    if (parsed.data.due_at !== undefined) {
      task = await rescheduleTask(supabase, user.id, id, parsed.data.due_at);
    }
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return safeError(error, "Failed to update task");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await authenticate(request);

    await deleteTask(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error, "Failed to delete task");
  }
}
