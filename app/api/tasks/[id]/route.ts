import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiClient } from "@/lib/supabase/api";
import { deleteTask, rescheduleTask, setTaskStatus } from "@/lib/erna/memory";

const patchSchema = z.object({
  status: z.enum(["open", "done", "archived"]).optional(),
  due_at: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const message = error instanceof Error ? error.message : "Failed to update task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    await deleteTask(supabase, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
