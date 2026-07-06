"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage, Conversation } from "@/lib/erna/types";

const starterPrompts = [
  "What do you remember about me?",
  "Help me plan today strategically.",
  "Save that I prefer concise answers.",
];

const INITIAL_GREETING: ChatMessage = {
  role: "assistant",
  content: "I’m Erna. I can remember what matters, manage tasks, use tools, and keep you sharp. What are we doing?",
};

export function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false); // sending
  const [error, setError] = useState("");

  // Conversations list state (for "load more conversations")
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [hasMoreConvos, setHasMoreConvos] = useState(false);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null); // which conv is being loaded into the pane

  const apiMessages = useMemo(
    () => messages.filter((message) => message.role === "user" || message.role === "assistant"),
    [messages],
  );

  const isFreshChat = !conversationId && messages.length === 1 && messages[0]?.content === INITIAL_GREETING.content;

  // Load / refresh the list of conversations (supports cursor for "Load more")
  const loadConversations = useCallback(async (before?: string, append = false) => {
    setListLoading(true);
    if (!append) setListError("");

    const params = new URLSearchParams();
    params.set("limit", "15");
    if (before) params.set("before", before);

    try {
      const res = await fetch(`/api/conversations?${params.toString()}`);
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Failed to load conversations");
      }
      const data = (await res.json()) as { conversations: Conversation[]; hasMore: boolean };

      setConversations((prev) => (append ? [...prev, ...data.conversations] : data.conversations));
      setHasMoreConvos(data.hasMore);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load conversation list";
      setListError(msg);
    } finally {
      setListLoading(false);
    }
  }, []);

  // Load a specific conversation's messages into the chat pane
  const loadConversation = useCallback(async (id: string) => {
    if (loading || loadingConvId) return;

    setLoadingConvId(id);
    setError("");
    setListError("");

    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Failed to load conversation");
      }
      const data = (await res.json()) as {
        conversationId: string;
        title?: string;
        messages: ChatMessage[];
      };

      const loaded = data.messages.length > 0 ? data.messages : [INITIAL_GREETING];
      setMessages(loaded);
      setConversationId(data.conversationId);
      // Keep the list fresh (the one we loaded should be near top)
      // We don't auto-replace list here to avoid jank while viewing history
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load that conversation";
      setError(msg);
    } finally {
      setLoadingConvId(null);
    }
  }, [loading, loadingConvId]);

  // Start a brand new chat (clear state). Does not hit the server until first message.
  function newChat() {
    if (loading) return;
    setMessages([INITIAL_GREETING]);
    setConversationId(undefined);
    setInput("");
    setError("");
    setLoadingConvId(null);
  }

  // Send message (existing behavior + refresh list afterwards so newest conv bubbles to top)
  async function send(content = input) {
    const trimmed = content.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...apiMessages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, messages: nextMessages }),
    });

    setLoading(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(formatApiError(payload.error));
      return;
    }

    const payload = (await response.json()) as {
      conversationId: string;
      message: ChatMessage;
    };
    setConversationId(payload.conversationId);
    setMessages((current) => [...current, payload.message]);

    // Refresh list so the just-updated (or newly created) conversation appears at the top
    // Use a microtask so state settles first
    setTimeout(() => {
      loadConversations(undefined, false);
    }, 50);
  }

  // Initial load of conversation list when the shell mounts
  useEffect(() => {
    loadConversations(undefined, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to load the next page of older conversations ("Load more")
  async function loadMoreConversations() {
    if (!hasMoreConvos || listLoading || conversations.length === 0) return;
    const last = conversations[conversations.length - 1];
    await loadConversations(last.updated_at, true);
  }

  function formatWhen(iso: string) {
    try {
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  return (
    <div className="flex h-[calc(100vh-152px)] min-h-[640px] flex-col md:h-screen">
      <header className="border-b border-[var(--border)] px-4 py-4 md:px-8">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent)]">Chat</p>
            <h2 className="mt-1 text-2xl font-semibold">Ask Erna</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main chat area: conversations list (left) + messages (right) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Conversations list panel — this is what enables "load more conversations" */}
        <div className="hidden w-60 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] md:flex">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Conversations</span>
            <button
              onClick={newChat}
              disabled={loading}
              className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--panel-strong)]"
              title="Start a fresh chat (creates a new conversation on first message)"
            >
              New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 text-sm">
            {conversations.length === 0 && !listLoading && !listError && (
              <p className="px-2 py-3 text-xs text-[var(--muted)]">No conversations yet. Send a message to create one.</p>
            )}

            {conversations.map((conv) => {
              const isActive = conv.id === conversationId;
              const isLoadingThis = loadingConvId === conv.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  disabled={!!loadingConvId || loading}
                  className={`mb-1 w-full rounded-md border px-3 py-2 text-left transition ${
                    isActive
                      ? "border-[var(--accent)] bg-[rgba(242,184,75,0.12)]"
                      : "border-transparent hover:border-[var(--border)] hover:bg-[var(--panel-strong)]"
                  } ${isLoadingThis ? "opacity-60" : ""}`}
                >
                  <div className="truncate font-medium">{conv.title || "Untitled chat"}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--muted)]">{formatWhen(conv.updated_at)}</div>
                </button>
              );
            })}

            {listLoading && conversations.length === 0 && (
              <div className="px-2 py-3 text-xs text-[var(--muted)]">Loading conversations…</div>
            )}

            {hasMoreConvos && (
              <button
                onClick={loadMoreConversations}
                disabled={listLoading}
                className="mt-1 w-full rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--panel-strong)] disabled:opacity-60"
              >
                {listLoading ? "Loading…" : "Load more conversations"}
              </button>
            )}

            {listError && <p className="mt-2 px-2 text-xs text-[var(--danger)]">{listError}</p>}
          </div>

          <div className="border-t border-[var(--border)] p-2 text-[10px] text-[var(--muted)]">
            Click a conversation to load its history and continue.
          </div>
        </div>

        {/* Messages pane */}
        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`max-w-[88%] rounded-lg border px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto border-[rgba(242,184,75,0.45)] bg-[rgba(242,184,75,0.14)]"
                    : "mr-auto border-[var(--border)] bg-[var(--panel)]"
                }`}
              >
                <p className="mb-1 text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  {message.role === "user" ? "You" : "Erna"}
                </p>
                <div className="whitespace-pre-wrap">{message.content}</div>
              </article>
            ))}

            {(loading || loadingConvId) && (
              <div className="mr-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
                {loadingConvId ? "Loading conversation…" : "Erna is thinking..."}
              </div>
            )}
          </div>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="border-t border-[var(--border)] bg-[var(--background)] p-4 md:p-6"
      >
        <div className="mx-auto max-w-4xl">
          {error ? <p className="mb-3 text-sm text-[var(--danger)]">{error}</p> : null}
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Tell Erna what you need..."
              rows={2}
              className="min-h-14 flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 outline-none focus:border-[var(--accent)]"
            />
            <button
              disabled={loading || !input.trim()}
              className="rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-black hover:bg-[var(--accent-strong)]"
            >
              Send
            </button>
          </div>
          <div className="mt-2 text-[10px] text-[var(--muted)] md:hidden">
            On mobile the conversation list is hidden — use a desktop browser or widen the window to load previous chats.
          </div>
        </div>
      </form>
    </div>
  );
}

function formatApiError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    return JSON.stringify(error);
  }

  return "Chat failed. Check API keys and Supabase setup.";
}
