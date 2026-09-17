"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey } from "@/lib/env";

/**
 * Client for requesting a password reset email.
 *
 * The default browser client uses PKCE, whose link only works in the browser
 * that asked for it. The implicit flow puts the session tokens in the link's
 * `#fragment` instead, so the email can be opened on any device. It is the same
 * link shape Supabase sends for "Send password recovery" in the dashboard, and
 * works with the default (non-editable) email template.
 */
export function createRecoveryRequestClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    getSupabasePublishableKey(),
    {
      auth: {
        flowType: "implicit",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

/** True when a URL fragment came from a recovery email (tokens or an error). */
export function isRecoveryFragment(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("type") === "recovery" || params.has("error_code");
}
