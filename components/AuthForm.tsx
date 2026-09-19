"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NostrSignIn } from "@/components/NostrSignIn";
import { isNostrEmail } from "@/lib/nostr/login";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    setNotice("");

    if (isNostrEmail(email)) {
      setLoading(false);
      setStatus("That address belongs to a Nostr account — use Sign in with Nostr.");
      return;
    }

    const supabase = createClient();

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      setLoading(false);
      if (error) {
        setStatus(error.message);
        return;
      }
      // Same message whether or not the address has an account, so the form
      // can't be used to find out who is registered.
      setNotice(
        "If that email has an account, a rescue link is flying your way. Check your inbox (and spam).",
      );
      return;
    }

    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/login` },
          });

    setLoading(false);

    if (result.error) {
      setStatus(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      // Supabase answers a sign-up for an existing address the same way but
      // sends no email, so point people at sign in / reset as well.
      setNotice(
        "Check your email to confirm your account, then come back here. No email? The address may already have an account — sign in or reset your password.",
      );
      return;
    }

    router.push("/chat");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
          Erna
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          {mode === "forgot" ? "Memory glitch?" : "Private sign in"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Secure access for your personal assistant, memory, tasks, and admin
          controls.
        </p>
      </div>

      {mode === "forgot" ? (
        <p className="mt-6 text-sm leading-6 text-[var(--muted)]">
          Happens to the best of us — even an assistant with long-term memory.
          Drop your email and we&apos;ll send a link to pick a new password.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 rounded-md border border-[var(--border)] p-1">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded px-3 py-2 text-sm ${mode === "signin" ? "bg-[var(--accent)] text-black" : "text-[var(--muted)]"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded px-3 py-2 text-sm ${mode === "signup" ? "bg-[var(--accent)] text-black" : "text-[var(--muted)]"}`}
          >
            Sign up
          </button>
        </div>
      )}

      <label className="mt-5 block text-sm">
        Email
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          required
          className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-3 outline-none focus:border-[var(--accent)]"
        />
      </label>

      {mode !== "forgot" ? (
        <label className="mt-4 block text-sm">
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            minLength={8}
            required
            className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-3 outline-none focus:border-[var(--accent)]"
          />
        </label>
      ) : null}

      <button
        disabled={loading}
        className="mt-6 w-full rounded-md bg-[var(--accent)] px-4 py-3 font-medium text-black hover:bg-[var(--accent-strong)]"
      >
        {loading
          ? "Working..."
          : mode === "signin"
            ? "Enter"
            : mode === "signup"
              ? "Create account"
              : "Send rescue link"}
      </button>

      {mode === "signin" ? (
        <button
          type="button"
          onClick={() => {
            setMode("forgot");
            setStatus("");
            setNotice("");
          }}
          className="mt-3 w-full text-center text-sm text-[var(--muted)] hover:text-[var(--accent)]"
        >
          Forgot, eh? Let me save you
        </button>
      ) : null}

      {mode === "forgot" ? (
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setStatus("");
            setNotice("");
          }}
          className="mt-3 w-full text-center text-sm text-[var(--muted)] hover:text-[var(--accent)]"
        >
          Back to sign in
        </button>
      ) : null}

      {mode !== "forgot" ? <NostrSignIn /> : null}

      {notice ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{notice}</p>
      ) : null}

      {status ? (
        <p className="mt-4 text-sm text-[var(--danger)]">{status}</p>
      ) : null}
    </form>
  );
}
