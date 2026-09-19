import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { NOSTR_CHALLENGE_COOKIE, NOSTR_CHALLENGE_TTL_SECONDS } from "@/lib/nostr/login";

/**
 * Issue a single-use challenge for "Sign in with Nostr".
 *
 * The challenge is also kept in an httpOnly cookie scoped to the Nostr auth
 * routes, so the verify step only accepts an event signed for the challenge
 * this same browser was given.
 */
export async function POST() {
  const challenge = randomBytes(32).toString("hex");

  const response = NextResponse.json({ challenge });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(NOSTR_CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/nostr",
    maxAge: NOSTR_CHALLENGE_TTL_SECONDS,
  });
  return response;
}
