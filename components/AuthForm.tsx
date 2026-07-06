"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    const supabase = createClient();
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (result.error) {
      setStatus(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setStatus("Check your email to confirm your account, then come back here.");
      return;
    }

    router.push("/chat");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent)]">Erna</p>
        <h1 className="mt-2 text-3xl font-semibold">Private sign in</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Secure access for your personal assistant, memory, tasks, and admin controls.
        </p>
      </div>

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

      <button
        disabled={loading}
        className="mt-6 w-full rounded-md bg-[var(--accent)] px-4 py-3 font-medium text-black hover:bg-[var(--accent-strong)]"
      >
        {loading ? "Working..." : mode === "signin" ? "Enter" : "Create account"}
      </button>

      {status ? <p className="mt-4 text-sm text-[var(--danger)]">{status}</p> : null}
    </form>
  );
}
