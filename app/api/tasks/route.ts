import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, safeError } from "@/lib/erna/guard";
import { createTask, listTasks } from "@/lib/erna/memory";

const createSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(4000).optional(),
  due_at: z.string().datetime().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);

    const status = new URL(request.url).searchParams.get("status");
    const filter =
      status === "done" || status === "archived" || status === "all" ? status : "open";
    const tasks = await listTasks(supabase, user.id, filter);
    return NextResponse.json({ tasks });
  } catch (error) {
    return safeError(error, "Failed to load tasks");
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const task = await createTask(supabase, user.id, {
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      due_at: parsed.data.due_at ?? null,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return safeError(error, "Failed to create task");
  }
}
