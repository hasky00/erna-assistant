import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, safeError } from "@/lib/erna/guard";
import { DEFAULT_ERNA_PROMPT, getPersonalityPrompt } from "@/lib/erna/prompts";

const updateSchema = z.object({
  personalityPrompt: z.string().min(100).max(12000),
});

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);
    const personalityPrompt = await getPersonalityPrompt(supabase, user.id);
    return NextResponse.json({ personalityPrompt, defaultPrompt: DEFAULT_ERNA_PROMPT });
  } catch (error) {
    return safeError(error, "Failed to load prompt");
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { error } = await supabase.from("assistant_settings").upsert({
      user_id: user.id,
      personality_prompt: parsed.data.personalityPrompt,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error, "Failed to save prompt");
  }
}
