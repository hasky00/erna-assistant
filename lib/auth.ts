import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function getCurrentUser() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    return user;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Missing required environment variable")) {
      return null;
    }
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** The npub a user signed up with via "Sign in with Nostr", if any. */
export function nostrNpub(user: User) {
  const npub = user.app_metadata?.nostr_npub;
  return typeof npub === "string" ? npub : null;
}
