import { NextResponse } from "next/server";
import { authenticate, enforceChatRateLimit, safeError } from "@/lib/erna/guard";
import { synthesize, toSpeakable, ttsConfigured } from "@/lib/erna/tts";

/**
 * POST /api/tts  { text: string }  →  audio/mpeg
 *
 * Reads one of Erna's replies aloud. Signed-in users only, same rate limit as
 * chat, text trimmed to a spoken length so free-tier credits last.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);
    await enforceChatRateLimit(supabase, user);

    if (!ttsConfigured()) {
      return NextResponse.json({ error: "Spoken replies are not set up yet." }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const raw = typeof body?.text === "string" ? body.text : "";
    const text = toSpeakable(raw);
    if (!text) {
      return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
    }

    const audio = await synthesize(text);
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return safeError(error, "Could not generate speech");
  }
}
