# Erna

Erna is a private LLM-powered personal assistant with long-term memory, secure authentication, a clean chat interface, an admin personality prompt editor, and a server-side tool system.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth and Postgres
- OpenAI API
- Vercel-ready deployment

## Features

- Auth-gated chat UI
- OpenAI chat completions with tool calling
- Editable Erna personality/system prompt
- Long-term memory in Supabase (save, search, delete)
- User profile and preferences
- Task management: create, list, complete, reschedule, delete — via chat or a Tasks page
- Knowledge base: save/search/delete notes — via chat or a Notes page
- Currency converter (live ECB rates, no API key)
- Time-aware system prompt (resolves "tomorrow" in the user's timezone)
- Optional calendar, email, external task, and web search modules
- Mobile-friendly dark UI

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a Supabase project.

3. Run the SQL in `supabase/schema.sql` in the Supabase SQL editor.

4. Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

`SUPABASE_SERVICE_ROLE_KEY` is required for Sign in with Nostr (see below). It is only read server-side — never give it a `NEXT_PUBLIC_` prefix or import `lib/supabase/admin.ts` from client code.

5. Start the app:

```bash
npm run dev
```

6. Open `http://localhost:3000`, create an account, then chat with Erna.

## Sign in with Nostr

The login page has a **Sign in with Nostr** button next to email/password. It
uses a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md)
browser extension (`window.nostr`, e.g. Alby or nos2x); without one, the page
shows install links.

1. `POST /api/auth/nostr/challenge` returns a random 32-byte challenge and
   stores it in a short-lived (5 min), httpOnly cookie.
2. The browser asks the extension to sign a kind `22242` event (NIP-42 style)
   with tags `["relay", <site origin>]` and `["challenge", <challenge>]`.
3. `POST /api/auth/nostr/verify` burns the challenge cookie, then checks the
   event with `nostr-tools`: kind, challenge, site host, timestamp (±5 min),
   event id, and Schnorr signature against the pubkey.
4. The pubkey is looked up in `profiles.npub`. On first sign-in the server
   creates a Supabase user with a placeholder email `<hex pubkey>@nostr.erna`
   (no password, so email/password login is impossible) and a profile row
   holding the npub.
5. The server mints a normal Supabase session: it generates a magic-link token
   with the service-role key (no email is sent) and immediately redeems it with
   `verifyOtp` on the cookie-backed client. The rest of the app — RLS, bearer
   auth, `/api/chat` — sees an ordinary Supabase user.

When signed in with Nostr, the sidebar header shows the shortened npub instead
of the placeholder email.

**Database:** run `supabase/migrations/20260918_nostr_login.sql` on existing
projects (fresh setups get it from `schema.sql`). It adds `profiles.npub`
(unique) and a trigger so only the service role can set it; otherwise the
"profiles are private" policy would let a user claim someone else's key.

## Project Structure

```text
app/
  api/chat/route.ts
  api/admin/prompt/route.ts
  admin/page.tsx
  chat/page.tsx
  login/page.tsx
components/
lib/
  erna/
  supabase/
memory/
prompts/
public/
supabase/schema.sql
tools/
```

## Deployment

1. Push the repo to GitHub.
2. Import it into Vercel.
3. Add the same environment variables in Vercel Project Settings.
4. Set the Supabase auth site URL to your Vercel production URL.
5. Deploy.

## Security Notes

- All app pages require Supabase authentication.
- API routes validate the current user server-side.
- Supabase row-level security keeps user data private.
- OpenAI and optional provider API keys are only read server-side.
- Optional OAuth integrations should encrypt provider tokens before storing them in `tool_connections`.
