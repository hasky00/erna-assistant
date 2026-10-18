import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { optionalEnv } from "@/lib/env";
import { createApiClient } from "@/lib/supabase/api";

/**
 * Erna is a single-owner assistant. Supabase proves *who* a caller is
 * (password or Schnorr-signed Nostr event); this module decides *whether that
 * identity is allowed in at all*. Everything the model can touch sits behind
 * `authenticate()`, so a stranger with a valid account still gets a 403.
 *
 * Configure with either or both:
 *   ERNA_ALLOWED_EMAILS=you@example.com,other@example.com
 *   ERNA_ALLOWED_NPUBS=npub1...,npub1...
 *
 * With neither set the gate is open (first-run convenience) and a warning is
 * logged on every request so it is hard to forget.
 */

function csv(name: string) {
  return (optionalEnv(name) || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function allowlist() {
  return { emails: csv("ERNA_ALLOWED_EMAILS"), npubs: csv("ERNA_ALLOWED_NPUBS") };
}

export function allowlistConfigured() {
  const { emails, npubs } = allowlist();
  return emails.length > 0 || npubs.length > 0;
}

export function isAllowedNpub(npub: string) {
  const { npubs } = allowlist();
  if (!allowlistConfigured()) return true;
  return npubs.includes(npub.toLowerCase());
}

/** Friendly 403 text: tells the tester what to do, and which address to send. */
export function notOnGuestListMessage(user: User) {
  const who = user.email || "your account";
  return `${who} isn't on Erna's guest list yet. Ask Erna's owner to add you, then try again.`;
}

export function isAllowedUser(user: User) {
  if (!allowlistConfigured()) {
    console.warn("[erna] ERNA_ALLOWED_EMAILS / ERNA_ALLOWED_NPUBS not set — anyone with an account can use Erna.");
    return true;
  }
  const { emails, npubs } = allowlist();
  const email = user.email?.toLowerCase();
  const npub = typeof user.app_metadata?.nostr_npub === "string" ? user.app_metadata.nostr_npub.toLowerCase() : null;
  if (email && emails.includes(email)) return true;
  if (npub && npubs.includes(npub)) return true;
  return false;
}

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 429,
    message: string,
  ) {
    super(message);
  }

  toResponse() {
    return NextResponse.json({ error: this.message }, { status: this.status });
  }
}

/**
 * Authenticate an API request and enforce the owner allowlist.
 * Throws `AuthError`; routes catch it and return `error.toResponse()`.
 */
export async function authenticate(request: Request): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await createApiClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) throw new AuthError(401, "Unauthorized");
  if (!isAllowedUser(user)) throw new AuthError(403, notOnGuestListMessage(user));
  return { supabase, user };
}

// ---- rate limiting ----------------------------------------------------------

const PER_MINUTE = Number(optionalEnv("ERNA_RATE_PER_MINUTE") || 20);
const PER_DAY = Number(optionalEnv("ERNA_RATE_PER_DAY") || 400);

/**
 * Cheap per-user rate limit backed by the existing `messages` table: count the
 * caller's own user messages in the last minute and day. Serverless-safe (no
 * in-memory state) and RLS-scoped, so it needs no extra table.
 */
export async function enforceChatRateLimit(supabase: SupabaseClient, userId: string) {
  const now = Date.now();
  const since = (ms: number) => new Date(now - ms).toISOString();

  const [minute, day] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", since(60_000)),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", since(86_400_000)),
  ]);

  if ((minute.count ?? 0) >= PER_MINUTE) {
    throw new AuthError(429, "Slow down — too many messages in the last minute.");
  }
  if ((day.count ?? 0) >= PER_DAY) {
    throw new AuthError(429, "Daily message limit reached. Try again tomorrow.");
  }
}

/** Log the real error server-side; hand the client a generic line. */
export function safeError(error: unknown, fallback: string) {
  if (error instanceof AuthError) return error.toResponse();
  console.error("[erna]", fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
