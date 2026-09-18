create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text default 'UTC',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personality_prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  category text not null default 'general',
  importance int not null default 3 check (importance between 1 and 5),
  source text not null default 'chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'done', 'archived')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tool_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'gmail', 'todoist', 'linear', 'notion', 'other')),
  status text not null default 'not_connected' check (status in ('not_connected', 'connected', 'error')),
  scopes text[] not null default array[]::text[],
  encrypted_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists memories_user_recent_idx on public.memories(user_id, importance desc, created_at desc);
create index if not exists tasks_user_status_idx on public.tasks(user_id, status, due_at);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);
create index if not exists knowledge_documents_user_idx on public.knowledge_documents(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.assistant_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.tasks enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.tool_connections enable row level security;

create policy "profiles are private" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "assistant settings are private" on public.assistant_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "conversations are private" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "messages are private" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "memories are private" on public.memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "tasks are private" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "knowledge is private" on public.knowledge_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "tool connections are private" on public.tool_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sign in with Nostr: link a Nostr key (npub) to a Supabase user.
-- Existing databases: run supabase/migrations/20260918_nostr_login.sql (same SQL).

alter table public.profiles add column if not exists npub text;

create unique index if not exists profiles_npub_key on public.profiles(npub);

-- profiles.npub decides which account a Nostr key signs into, so users must
-- not be able to set it themselves (the "profiles are private" policy would
-- otherwise let anyone claim another person's key). Only the service role —
-- used by /api/auth/nostr/verify — and database admins may write it.
create or replace function public.protect_profile_npub()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' and new.npub is not null then
      raise exception 'profiles.npub can only be set by the server';
    end if;
    if tg_op = 'UPDATE' and new.npub is distinct from old.npub then
      raise exception 'profiles.npub can only be set by the server';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_npub on public.profiles;
create trigger protect_profile_npub
  before insert or update on public.profiles
  for each row execute function public.protect_profile_npub();
