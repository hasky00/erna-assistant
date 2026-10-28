import { optionalEnv } from "@/lib/env";

/**
 * Spoken replies via ElevenLabs.
 *
 * The API key lives only on the server; the app calls /api/tts and gets MP3
 * back. Credits are spent per character, so the text is trimmed to a spoken
 * length and markdown is stripped before it goes out.
 *
 * Env:
 *   ELEVENLABS_API_KEY   required for /api/tts to work
 *   ELEVENLABS_VOICE_ID  optional, defaults to Erna's chosen voice (Isabella)
 *   ELEVENLABS_MODEL_ID  optional, defaults to the fast/cheap Flash model
 */

/** ElevenLabs said no; carries their status and message so the client can show it. */
export class TTSUpstreamError extends Error {
  constructor(
    public readonly upstreamStatus: number,
    detail: string,
  ) {
    super(`ElevenLabs ${upstreamStatus}: ${detail}`);
  }
}

export const DEFAULT_VOICE_ID = "gIfqD5jrnhkFu8ENVbXC"; // Isabella
export const DEFAULT_MODEL_ID = "eleven_flash_v2_5";

/** Longest reply Erna will read aloud; keeps a tap to ~30 s and a few hundred credits. */
export const MAX_SPOKEN_CHARS = 600;

export function ttsConfigured() {
  return !!optionalEnv("ELEVENLABS_API_KEY");
}

/** Turn a chat reply (markdown) into something that reads well out loud. */
export function toSpeakable(markdown: string) {
  let text = markdown
    .replace(/```[\s\S]*?```/g, " ")          // code blocks
    .replace(/`([^`]*)`/g, "$1")                // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // links → label
    .replace(/^#{1,6}\s+/gm, "")                // headings
    .replace(/^\s*[-*+]\s+/gm, "")              // bullets
    .replace(/^\s*\d+\.\s+/gm, "")              // numbered lists
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // bold/italic/strike
    .replace(/^\s*>\s?/gm, "")                  // quotes
    .replace(/\|/g, " ")                        // tables
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (text.length <= MAX_SPOKEN_CHARS) return text;

  // Cut at the last sentence end before the limit so she never stops mid-word.
  const head = text.slice(0, MAX_SPOKEN_CHARS);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("\n"));
  text = cut > MAX_SPOKEN_CHARS / 2 ? head.slice(0, cut + 1) : head;
  return text.trim();
}

export async function synthesize(text: string): Promise<ArrayBuffer> {
  const apiKey = optionalEnv("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

  const voiceId = optionalEnv("ELEVENLABS_VOICE_ID") || DEFAULT_VOICE_ID;
  const modelId = optionalEnv("ELEVENLABS_MODEL_ID") || DEFAULT_MODEL_ID;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TTSUpstreamError(response.status, detail.slice(0, 300));
  }
  return response.arrayBuffer();
}
