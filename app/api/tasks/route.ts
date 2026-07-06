import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createTask, listTasks } from "@/lib/erna/memory";

const createSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(4000).optional(),
  due_at: z.string().datetime().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = new URL(request.url).searchParams.get("status");
    const filter =
      status === "done" || status === "archived" || status === "all" ? status : "open";
    const tasks = await listTasks(supabase, user.id, filter);
    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load tasks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const message = error instanceof Error ? error.message : "Failed to create task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
