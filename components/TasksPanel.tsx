"use client";

import { useState } from "react";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: "open" | "done" | "archived";
  due_at: string | null;
  created_at: string;
};

type Filter = "open" | "done" | "all";

function formatDue(due: string | null) {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function TasksPanel({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filter, setFilter] = useState<Filter>("open");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(next: Filter) {
    setFilter(next);
    setError(null);
    const res = await fetch(`/api/tasks?status=${next}`);
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Failed to load tasks");
    setTasks(data.tasks);
  }

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          due_at: due ? new Date(due).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.formErrors?.[0] || data.error || "Failed to add task");
      setTitle("");
      setDue("");
      if (filter !== "done") setTasks((prev) => [data.task, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    } finally {
      setBusy(false);
    }
  }

  async function patchTask(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Update failed");
    // Drop from view if it no longer matches the active filter.
    if (filter === "open" && body.status && body.status !== "open") {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } else {
      setTasks((prev) => prev.map((t) => (t.id === id ? data.task : t)));
    }
  }

  async function removeTask(id: string) {
    setError(null);
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setError(data.error || "Delete failed");
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Tasks</h2>
        <div className="flex gap-1 rounded-md border border-[var(--border)] p-1">
          {(["open", "done", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => refresh(f)}
              className={`rounded px-3 py-1 text-sm capitalize ${
                filter === f ? "bg-[var(--accent)] text-black" : "text-[var(--muted)] hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={addTask} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

      <ul className="mt-5 flex flex-col gap-2">
        {tasks.length === 0 ? (
          <li className="rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            No {filter === "all" ? "" : filter} tasks.
          </li>
        ) : null}
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2"
          >
            <input
              type="checkbox"
              checked={task.status === "done"}
              onChange={(e) => patchTask(task.id, { status: e.target.checked ? "done" : "open" })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${task.status === "done" ? "text-[var(--muted)] line-through" : ""}`}>
                {task.title}
              </p>
              {task.due_at ? (
                <p className="text-xs text-[var(--muted)]">Due {formatDue(task.due_at)}</p>
              ) : null}
            </div>
            <button
              onClick={() => removeTask(task.id)}
              className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:text-red-400"
              aria-label="Delete task"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
