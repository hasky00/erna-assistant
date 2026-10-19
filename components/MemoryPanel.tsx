"use client";

import { useState } from "react";
import type { MemoryWithOrigin } from "@/lib/erna/types";

function originLine(memory: MemoryWithOrigin) {
  const when = new Date(memory.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return memory.conversation_title
    ? `You told me on ${when} in “${memory.conversation_title}”`
    : `You told me on ${when}`;
}

/** Everything Erna remembers about the user: read it, fix it, forget it. */
export function MemoryPanel({ initialMemories }: { initialMemories: MemoryWithOrigin[] }) {
  const [memories, setMemories] = useState(initialMemories);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function forget(memory: MemoryWithOrigin) {
    if (!window.confirm("Forget this memory?")) return;
    const snapshot = memories;
    setMemories((prev) => prev.filter((m) => m.id !== memory.id));
    const res = await fetch(`/api/memories/${memory.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMemories(snapshot);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not forget that memory");
    }
  }

  async function forgetAll() {
    if (!window.confirm("Forget everything Erna knows about you? Chats, tasks and notes stay.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/memories", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not forget memories");
      setMemories([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not forget memories");
    } finally {
      setBusy(false);
    }
  }

  async function save(memory: MemoryWithOrigin) {
    const content = draft.trim();
    if (!content || content === memory.content) return setEditingId(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/memories/${memory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update memory");
      setMemories((prev) => prev.map((m) => (m.id === memory.id ? { ...m, content: data.memory.content } : m)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update memory");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">What Erna knows about you</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Every fact she remembers, where it came from, and a way to forget it. Click a memory to edit it.
          </p>
        </div>
        <button
          onClick={forgetAll}
          disabled={busy || memories.length === 0}
          className="shrink-0 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-40"
        >
          Forget all
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      <ul className="mt-5 space-y-2">
        {memories.length === 0 && (
          <li className="text-sm text-[var(--muted)]">
            Erna hasn&apos;t remembered anything about you yet. Tell her something worth keeping.
          </li>
        )}
        {memories.map((memory) => (
          <li key={memory.id} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            {editingId === memory.id ? (
              <div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 text-sm"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => save(memory)}
                    disabled={busy}
                    className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-black disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-md border border-[var(--border)] px-3 py-1 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => {
                    setEditingId(memory.id);
                    setDraft(memory.content);
                  }}
                  className="flex-1 text-left"
                >
                  <p className="text-sm">{memory.content}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    <span className="mr-2 rounded bg-[rgba(242,184,75,0.12)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                      {memory.category}
                    </span>
                    {originLine(memory)}
                  </p>
                </button>
                <button
                  onClick={() => forget(memory)}
                  title="Forget this memory"
                  className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--danger)]"
                >
                  Forget
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
