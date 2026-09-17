import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiClient } from "@/lib/supabase/api";
import { DEFAULT_ERNA_PROMPT, getPersonalityPrompt } from "@/lib/erna/prompts";

const updateSchema = z.object({
  personalityPrompt: z.string().min(100).max(12000),
});

export async function GET(request: Request) {
  const supabase = await createApiClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const personalityPrompt = await getPersonalityPrompt(supabase, user.id);
  return NextResponse.json({ personalityPrompt, defaultPrompt: DEFAULT_ERNA_PROMPT });
}

export async function PUT(request: Request) {
  const supabase = await createApiClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { error } = await supabase.from("assistant_settings").upsert({
    user_id: user.id,
    personality_prompt: parsed.data.personalityPrompt,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
