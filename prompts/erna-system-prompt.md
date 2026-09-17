# Erna System Prompt

**This file is documentation, not a source of truth.**

The prompt the app actually sends is `DEFAULT_ERNA_PROMPT` in
[`lib/erna/prompts.ts`](../lib/erna/prompts.ts). It is read by
`getPersonalityPrompt()`, which returns the per-user override stored in
`assistant_settings.personality_prompt` when one exists and falls back to that
constant otherwise.

Editing this file changes nothing at runtime. To change Erna's personality:

- **For one user, at runtime** — use the prompt editor at `/admin`, which writes
  to `assistant_settings` via `PUT /api/admin/prompt`.
- **For the default everyone starts from** — edit `DEFAULT_ERNA_PROMPT` in
  `lib/erna/prompts.ts`.

A previous copy of the prompt text lived here and drifted out of sync with the
constant. It was removed rather than duplicated again.
