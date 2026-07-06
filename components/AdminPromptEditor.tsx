"use client";

import { useState } from "react";

export function AdminPromptEditor({ initialPrompt }: { initialPrompt: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    setStatus("");

    const response = await fetch("/api/admin/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personalityPrompt: prompt }),
    });

    setLoading(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setStatus(typeof payload.error === "string" ? payload.error : "Prompt update failed.");
      return;
    }

    setStatus("Saved.");
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 md:p-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent)]">Personality</p>
          <h2 className="mt-1 text-2xl font-semibold">Erna’s system prompt</h2>
        </div>
        <button
          onClick={save}
          disabled={loading}
          className="rounded-md bg-[var(--accent)] px-4 py-2 font-medium text-black hover:bg-[var(--accent-strong)]"
        >
          {loading ? "Saving..." : "Save prompt"}
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={22}
        className="mt-5 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 font-mono text-sm leading-6 outline-none focus:border-[var(--accent)]"
      />

      <div className="mt-4 flex flex-col gap-2 text-sm text-[var(--muted)] md:flex-row md:items-center md:justify-between">
        <p>{prompt.length} characters. Minimum save length: 100.</p>
        {status ? <p className={status === "Saved." ? "text-[var(--accent)]" : "text-[var(--danger)]"}>{status}</p> : null}
      </div>
    </section>
  );
}
