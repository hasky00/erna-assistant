"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Landing page for the password reset email.
 *
 * Two link shapes are accepted:
 * - `?token_hash=…&type=recovery` — from the Supabase "Reset password" email
 *   template pointed at this page. Verified with `verifyOtp`, so it works in any
 *   browser and for resets sent from the Supabase dashboard.
 * - `?code=…` — Supabase's default PKCE link. The browser client exchanges it
 *   while initialising, which needs the verifier cookie from the browser that
 *   requested the reset.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");

    if (tokenHash && params.get("type") === "recovery") {
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: "recovery" })
        .then(({ data, error }) => {
          setReady(!error && data.session ? "ok" : "invalid");
        });
      return;
    }

    // getSession waits for the client to finish handling a `code` in the URL.
    supabase.auth.getSession().then(({ data }) => {
      setReady(data.session ? "ok" : "invalid");
    });
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (password !== confirm) {
      setStatus("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await createClient().auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    router.push("/chat");
    router.refresh();
  }

  const inputClass =
    "mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-3 outline-none focus:border-[var(--accent)]";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
          Erna
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Fresh start</h1>

        {ready === "checking" ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Dusting off your reset link...
          </p>
        ) : null}

        {ready === "invalid" ? (
          <>
            <p className="mt-4 text-sm leading-6 text-[var(--danger)]">
              This reset link is invalid or has expired. Each link only works
              once — ask for a fresh one from the sign-in page.
            </p>
            <a
              href="/login"
              className="mt-6 block w-full rounded-md bg-[var(--accent)] px-4 py-3 text-center font-medium text-black hover:bg-[var(--accent-strong)]"
            >
              Back to sign in
            </a>
          </>
        ) : null}

        {ready === "ok" ? (
          <form onSubmit={submit}>
            <label className="mt-5 block text-sm">
              New password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                className={inputClass}
              />
            </label>

            <label className="mt-4 block text-sm">
              Confirm password
              <input
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                className={inputClass}
              />
            </label>

            <button
              disabled={loading}
              className="mt-6 w-full rounded-md bg-[var(--accent)] px-4 py-3 font-medium text-black hover:bg-[var(--accent-strong)]"
            >
              {loading ? "Working..." : "Save it (and remember it this time)"}
            </button>

            {status ? (
              <p className="mt-4 text-sm text-[var(--danger)]">{status}</p>
            ) : null}
          </form>
        ) : null}
      </div>
    </main>
  );
}
