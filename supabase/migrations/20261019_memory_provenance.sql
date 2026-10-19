-- Memory provenance: remember which conversation a memory came from, so the
-- Memory page can answer "why do you know that?". Deleting the conversation
-- keeps the memory but clears the link.
alter table public.memories
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null;

create index if not exists memories_conversation_idx on public.memories(conversation_id);
