import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@/lib/env";

let client: Anthropic | null = null;

/** Lazily constructed Anthropic client. The key is only ever read server-side. */
export function getAnthropic() {
  if (!client) {
    client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  }
  return client;
}

/**
 * Model used for chat turns. Override with ANTHROPIC_MODEL, e.g.
 *   claude-haiku-5-5   cheapest, fast
 *   claude-sonnet-5-5  default, best quality/price for an assistant
 *   claude-opus-5-5    strongest, priciest
 */
export function getAnthropicModel() {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}
