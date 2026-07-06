"use client";

import { useState } from "react";

type Note = {
  id: string;
  title: string;
  body: string;
  source_url: string | null;
  created_at: string;
};

export function NotesPanel({ initialNotes }: { initialNotes: Note[] }) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch(`/api/notes${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`);
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Search failed");
    setNotes(data.notes);
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.formErrors?.[0] || data.error || "Failed to save note");
      // POST returns a trimmed row; prepend a full-body version optimistically.
      setNotes((prev) => [{ ...data.note, body: body.trim() }, ...prev]);
      setTitle("");
      setBody("");
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }

  async function removeNote(id: string) {
    setError(null);
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setError(data.error || "Delete failed");
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Knowledge base</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black"
        >
          {showForm ? "Cancel" : "New note"}
        </button>
      </div>

      {showForm ? (
        <form onSubmit={addNote} className="mt-4 flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your note…"
            rows={5}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={busy || !title.trim() || !body.trim()}
            className="self-start rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Save note
          </button>
        </form>
      ) : null}

      <form onSubmit={search} className="mt-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button type="submit" className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--panel-strong)]">
          Search
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

      <div className="mt-5 grid gap-3">
        {notes.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            No notes yet. Create one, or ask Erna to save something for you.
          </p>
        ) : null}
        {notes.map((note) => (
          <article key={note.id} className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{note.title}</h3>
              <button
                onClick={() => removeNote(note.id)}
                className="shrink-0 rounded px-2 py-1 text-xs text-[var(--muted)] hover:text-red-400"
              >
                Delete
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{note.body}</p>
            {note.source_url ? (
              <a
                href={note.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-[var(--accent)] hover:underline"
              >
                {note.source_url}
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
