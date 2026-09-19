import { verifyEvent, type Event } from "nostr-tools/pure";
import { npubEncode } from "nostr-tools/nip19";

/** NIP-42 client authentication kind, reused here for web sign-in. */
export const NOSTR_LOGIN_KIND = 22242;

/** How long an issued challenge (and the signed event) stays valid. */
export const NOSTR_CHALLENGE_TTL_SECONDS = 5 * 60;

export const NOSTR_CHALLENGE_COOKIE = "erna_nostr_challenge";

/** Placeholder address for Nostr accounts; `.erna` is not a real TLD, so no mail is ever delivered. */
export const NOSTR_EMAIL_DOMAIN = "nostr.erna";

export function nostrEmail(pubkey: string) {
  return `${pubkey}@${NOSTR_EMAIL_DOMAIN}`;
}

export function isNostrEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(`@${NOSTR_EMAIL_DOMAIN}`);
}

/** `npub1abcdef…uvwxyz` — enough to recognise, short enough for the header. */
export function shortNpub(npub: string) {
  return npub.length > 20 ? `${npub.slice(0, 10)}…${npub.slice(-6)}` : npub;
}

/** The unsigned template the browser asks `window.nostr.signEvent` to sign. */
export function loginEventTemplate(challenge: string, origin: string) {
  return {
    kind: NOSTR_LOGIN_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["relay", origin],
      ["challenge", challenge],
    ],
    content: "",
  };
}

type VerifyResult = { ok: true; pubkey: string; npub: string } | { ok: false; error: string };

function tagValue(event: Event, name: string) {
  return event.tags.find((tag) => Array.isArray(tag) && tag[0] === name)?.[1];
}

/**
 * Check a signed login event against the challenge this browser was issued.
 *
 * `verifyEvent` recomputes the event id from its contents and checks the
 * Schnorr signature against `pubkey`, so a valid result proves the holder of
 * that key signed exactly this challenge.
 */
export function verifyLoginEvent(
  input: unknown,
  expected: { challenge: string; host: string; now?: number },
): VerifyResult {
  const event = input as Event;
  if (
    !event ||
    typeof event !== "object" ||
    typeof event.id !== "string" ||
    typeof event.sig !== "string" ||
    typeof event.pubkey !== "string" ||
    typeof event.content !== "string" ||
    typeof event.created_at !== "number" ||
    !Array.isArray(event.tags)
  ) {
    return { ok: false, error: "Malformed event." };
  }

  if (event.kind !== NOSTR_LOGIN_KIND) {
    return { ok: false, error: "Wrong event kind." };
  }

  if (!/^[0-9a-f]{64}$/.test(event.pubkey)) {
    return { ok: false, error: "Invalid pubkey." };
  }

  if (tagValue(event, "challenge") !== expected.challenge) {
    return { ok: false, error: "Challenge mismatch." };
  }

  const relay = tagValue(event, "relay");
  let relayHost: string | null = null;
  try {
    relayHost = relay ? new URL(relay).host : null;
  } catch {
    relayHost = null;
  }
  if (relayHost !== expected.host) {
    return { ok: false, error: "Event was signed for a different site." };
  }

  const now = expected.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > NOSTR_CHALLENGE_TTL_SECONDS) {
    return { ok: false, error: "Event timestamp is too far from now." };
  }

  // Verify a fresh copy: nostr-tools caches a "verified" symbol on event
  // objects, and only the plain fields should count.
  const plain: Event = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  };
  if (!verifyEvent(plain)) {
    return { ok: false, error: "Invalid signature." };
  }

  return { ok: true, pubkey: event.pubkey, npub: npubEncode(event.pubkey) };
}
