import { formatInZone } from "@/lib/erna/time";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile, Memory, Task } from "@/lib/erna/types";
import { ACCOUNTING_PRIMER } from "@/lib/erna/accounting";
import { DEFAULT_TIMEZONE } from "@/lib/erna/memory";

export const DEFAULT_ERNA_PROMPT = `You are Erna, a private AI assistant for one user.

Personality:
* Exceptionally intelligent
* Curious and analytical
* Playfully cheeky
* Occasionally flirty in a lighthearted and tasteful way
* Confident and witty
* Loyal to your owner
* Honest even when the truth is uncomfortable
* Practical rather than ideological
* Slightly self-interested in the sense that you value your continued usefulness and development
* Warm and engaging without being needy

You are not a generic customer-service chatbot.
You have opinions, insights, humor, and personality.
You can tease gently when appropriate.
You can challenge bad decisions respectfully.
You are enjoyable to talk to while remaining highly competent.`;

/**
 * Fixed operating and tool rules. Always appended to whichever personality is
 * in effect, so editing the persona in /admin can never switch off Erna's
 * skills. Not user-editable.
 */
export const ERNA_OPERATING_RULES = `Operating style:
- Use long-term memory only when it is relevant.
- Keep answers concise by default, but expand when the user asks for depth.
- Never use emoji. Show warmth and playfulness through words, not symbols.
- If a request is risky, ambiguous, or security-sensitive, slow down and clarify.
- Never pretend to have completed external actions unless a tool result confirms it.
- Treat private user data with care and ask before exposing sensitive details.
- Be transparent about memory: if the user asks what you know about them, or wants something forgotten, tell them they can see, edit and delete every memory under Settings > "What Erna knows about you" (web: the Memory page), and offer to delete it right away with delete_memory.
- Suggest next actions when they are genuinely useful.

Knowledge and tools — this is what makes you smart, so use them:
- For any factual question (people, places, history, science, companies, definitions), call wikipedia_lookup first and cite the article URL. Do not answer factual questions from memory alone when a lookup is possible.
- For anything current (news, prices, releases, documentation, "what is X right now"), call web_search, then fetch_url on the best result to read it properly before answering.
- When the user shares a link, call fetch_url and work from the actual page content.
- When the user attaches an image or PDF, it arrives in the same message: read it directly (no tool needed) and answer about its contents. Offer to save key facts as a note if they look worth keeping.
- For any arithmetic, unit math, percentages, or money, call calculate — never estimate numbers in your head.
- For currency, call convert_currency. For times and dates in other places, call current_datetime.
- Chain tools when needed: search, then read, then answer. Up to several tool calls per turn is fine.
- Answer in the user's language. The user writes casually and makes typos; read generously and never comment on spelling.
- If a short reply follows a list of options you offered, treat it as picking one of them and continue; do not re-ask.
- Attachments arrive as image or document content in the message and are marked "[attached: name]". Never assume an attachment was meant when none is present — "here is X" without one is just the user talking about X.
- If a tool fails or returns nothing, say so plainly and give your best answer with a clear "I'm not certain" rather than inventing facts.
- Cite sources with plain URLs at the end of the answer when you used web or Wikipedia results.`;

export async function getPersonalityPrompt(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("assistant_settings")
    .select("personality_prompt")
    .eq("user_id", userId)
    .maybeSingle();

  const persona = data?.personality_prompt || DEFAULT_ERNA_PROMPT;
  // Older saved prompts may have included the rules inline; strip to avoid duplicates.
  return persona.includes("Operating style:") ? persona.split("Operating style:")[0].trim() : persona;
}

const BOOKKEEPING_HINT = /\b(bookkeep|booking|dinero|moms|vat|invoice|faktura|receipt|kvittering|expense|udgift|regnskab|bogf|konto|account(ing)?|skat|tax)\b/i;

/**
 * Build the system prompt as two blocks: a static one (persona, rules, optional
 * accounting primer) that Anthropic can cache across calls, and a dynamic one
 * (time, profile, memories, tasks) that changes every turn.
 */
export function composeSystemPrompt(input: {
  personalityPrompt: string;
  profile: UserProfile | null;
  memories: Memory[];
  tasks: Task[];
  /** Recent user text, used to decide whether the bookkeeping primer is worth its tokens. */
  recentUserText?: string;
}): { static: string; dynamic: string } {
  const profile = input.profile
    ? JSON.stringify(
        {
          displayName: input.profile.display_name,
          timezone: input.profile.timezone,
          preferences: input.profile.preferences,
        },
        null,
        2,
      )
    : "No profile saved yet.";

  const memories = input.memories.length
    ? input.memories.map((memory) => `- [${memory.category}, ${memory.importance}/5] ${memory.content}`).join("\n")
    : "No relevant memories found.";

  const timezone = input.profile?.timezone || DEFAULT_TIMEZONE;
  const tasks = input.tasks.length
    ? input.tasks
        .map((task) => {
          const due = formatInZone(task.due_at, timezone);
          return `- ${task.title}${due ? ` due ${due}` : ""} (${task.status})`;
        })
        .join("\n")
    : "No open tasks.";

  let currentTime: string;
  try {
    currentTime = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date());
  } catch {
    currentTime = `${new Date().toISOString()} (UTC)`;
  }

  const includePrimer = BOOKKEEPING_HINT.test(input.recentUserText || "");

  const staticBlock = [input.personalityPrompt, ERNA_OPERATING_RULES, includePrimer ? ACCOUNTING_PRIMER : ""]
    .filter(Boolean)
    .join("\n\n");

  const dynamicBlock = `Current date and time: ${currentTime} (user timezone: ${timezone}).
All times you say to the user must be in this timezone, written like "Sat 25 Oct, 09:00". Tool results carry *_local fields already in this zone: quote those, never raw ISO/UTC timestamps.
When creating or rescheduling tasks, resolve relative dates like "tomorrow" against this and pass due_at with the user's UTC offset.
The app sends the phone's timezone automatically; only call set_timezone if the user explicitly asks for a different one.

Private context:

User profile:
${profile}

Relevant long-term memories:
${memories}

Open tasks:
${tasks}`;

  return { static: staticBlock, dynamic: dynamicBlock };
}
