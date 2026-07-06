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

`SUPABASE_SERVICE_ROLE_KEY` is reserved for future admin jobs. Do not expose it in client code.

5. Start the app:

```bash
npm run dev
```

6. Open `http://localhost:3000`, create an account, then chat with Erna.

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
