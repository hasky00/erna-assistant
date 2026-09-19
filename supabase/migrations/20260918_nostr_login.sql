-- Sign in with Nostr: link a Nostr key (npub) to a Supabase user.
-- Safe to run more than once. Run it in the Supabase SQL editor before
-- deploying the Nostr login code.

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
