"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginEventTemplate } from "@/lib/nostr/login";

type NostrEvent = ReturnType<typeof loginEventTemplate> & {
  id: string;
  pubkey: string;
  sig: string;
};

/** NIP-07 browser extension API (Alby, nos2x, …). */
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: ReturnType<typeof loginEventTemplate>): Promise<NostrEvent>;
    };
  }
}

export function NostrSignIn() {
  const router = useRouter();
  const [hasExtension, setHasExtension] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    // Extensions inject window.nostr after page load, sometimes a beat late.
    const check = () => setHasExtension(!!window.nostr);
    check();
    const timer = window.setTimeout(check, 500);
    return () => window.clearTimeout(timer);
  }, []);

  async function signIn() {
    setStatus("");
    if (!window.nostr) {
      setHasExtension(false);
      return;
    }

    setLoading(true);
    try {
      const challengeResponse = await fetch("/api/auth/nostr/challenge", { method: "POST" });
      if (!challengeResponse.ok) throw new Error("Couldn't start Nostr sign-in.");
      const { challenge } = (await challengeResponse.json()) as { challenge: string };

      const event = await window.nostr.signEvent(
        loginEventTemplate(challenge, window.location.origin),
      );

      const verifyResponse = await fetch("/api/auth/nostr/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      });
      if (!verifyResponse.ok) {
        const { error } = (await verifyResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(error || "Nostr sign-in failed.");
      }

      router.push("/chat");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nostr sign-in was cancelled.");
      setLoading(false);
    }
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
        <span className="h-px flex-1 bg-[var(--border)]" />
        or
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        className="mt-5 w-full rounded-md border border-[var(--accent)] px-4 py-3 font-medium text-[var(--accent)] hover:bg-[var(--panel-strong)]"
      >
        {loading ? "Waiting for your signer..." : "Sign in with Nostr"}
      </button>

      {hasExtension === false ? (
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          No Nostr signer found. Install a NIP-07 browser extension such as{" "}
          <a
            href="https://getalby.com"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline"
          >
            Alby
          </a>{" "}
          or{" "}
          <a
            href="https://github.com/fiatjaf/nos2x"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline"
          >
            nos2x
          </a>
          , then reload this page.
        </p>
      ) : null}

      {status ? <p className="mt-3 text-sm text-[var(--danger)]">{status}</p> : null}
    </div>
  );
}
