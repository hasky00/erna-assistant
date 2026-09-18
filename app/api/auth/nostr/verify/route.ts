import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  NOSTR_CHALLENGE_COOKIE,
  nostrEmail,
  shortNpub,
  verifyLoginEvent,
} from "@/lib/nostr/login";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function requestHost(request: Request) {
  return (
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    request.headers.get("host") ||
    new URL(request.url).host
  );
}

/**
 * Find the Supabase user for a Nostr pubkey, creating one on first sign-in.
 *
 * `profiles.npub` is the source of truth for the mapping. Only the service
 * role can write that column (see supabase/migrations), so a user can't claim
 * someone else's key. New accounts get a placeholder email and no password.
 */
async function findOrCreateUser(pubkey: string, npub: string) {
  const admin = createAdminClient();

  async function linkedEmail() {
    const { data: profile, error: lookupError } = await admin
      .from("profiles")
      .select("id")
      .eq("npub", npub)
      .maybeSingle<{ id: string }>();
    if (lookupError) throw lookupError;
    if (!profile) return null;

    const { data, error } = await admin.auth.admin.getUserById(profile.id);
    if (error || !data.user?.email) throw error ?? new Error("Linked user has no email.");
    return data.user.email;
  }

  const existing = await linkedEmail();
  if (existing) return { email: existing };

  const email = nostrEmail(pubkey);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { nostr_pubkey: pubkey, nostr_npub: npub },
  });
  if (createError || !created.user) {
    if (createError?.code === "email_exists") {
      // A concurrent first sign-in may have just linked it.
      const raced = await linkedEmail();
      if (raced) return { email: raced };
      // Otherwise the placeholder address is taken but not linked via
      // profiles.npub — e.g. someone signed up with it by email. Never hand
      // that account out.
      return { conflict: true as const };
    }
    throw createError ?? new Error("Could not create user.");
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: created.user.id,
    npub,
    display_name: shortNpub(npub),
  });
  if (profileError) {
    // Roll back so the next attempt starts clean instead of hitting email_exists.
    await admin.auth.admin.deleteUser(created.user.id);
    throw profileError;
  }

  return { email };
}

/**
 * Verify a signed kind-22242 event and start a Supabase session.
 *
 * The session is minted by generating a magic-link token server-side with the
 * service role (no email is sent) and immediately redeeming it with
 * `verifyOtp` on the cookie-backed SSR client. The result is an ordinary
 * Supabase session — access + refresh token in the usual cookies — so RLS,
 * bearer auth and /api/chat work unchanged.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const challenge = cookieStore.get(NOSTR_CHALLENGE_COOKIE)?.value;
  // Single use: burn the challenge whatever the outcome.
  cookieStore.set(NOSTR_CHALLENGE_COOKIE, "", { path: "/api/auth/nostr", maxAge: 0 });

  if (!challenge) {
    return fail("Challenge expired. Please try again.", 401);
  }

  const body = (await request.json().catch(() => null)) as { event?: unknown } | null;
  const result = verifyLoginEvent(body?.event, { challenge, host: requestHost(request) });
  if (!result.ok) {
    return fail(result.error, 401);
  }

  let email: string;
  try {
    const user = await findOrCreateUser(result.pubkey, result.npub);
    if ("conflict" in user) {
      return fail("This key's account is in a conflicting state. Contact the admin.", 409);
    }
    email = user.email;
  } catch (error) {
    console.error("nostr login: user lookup failed", error);
    return fail("Sign-in failed. Please try again.", 500);
  }

  const { data: link, error: linkError } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link.properties?.hashed_token) {
    console.error("nostr login: generateLink failed", linkError);
    return fail("Sign-in failed. Please try again.", 500);
  }

  const supabase = await createClient();
  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError) {
    console.error("nostr login: verifyOtp failed", otpError);
    return fail("Sign-in failed. Please try again.", 500);
  }

  return NextResponse.json({ ok: true, npub: result.npub }, { headers: { "Cache-Control": "no-store" } });
}
