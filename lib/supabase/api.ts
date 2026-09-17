import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { getSupabasePublishableKey, requireEnv } from "@/lib/env";
import { createClient as createCookieClient } from "@/lib/supabase/server";

/**
 * Pull a bearer token off the request.
 *
 * Browser clients authenticate with Supabase SSR cookies. Native clients (the
 * iOS app) hold a JWT instead and send it as `Authorization: Bearer <token>`.
 */
function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;

  const token = rest.join(" ").trim();
  return token || null;
}

/**
 * Supabase client for an API route, working for both browser and native callers.
 *
 * With a bearer token the JWT is attached to every PostgREST request, so row
 * level security still evaluates `auth.uid()` as that user — the token is
 * verified by Supabase, never trusted locally. Without one we fall back to the
 * cookie-based SSR client so the web app is unchanged.
 */
export async function createApiClient(request: Request): Promise<SupabaseClient> {
  const token = bearerToken(request);
  if (!token) {
    return createCookieClient();
  }

  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getSupabasePublishableKey(),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
