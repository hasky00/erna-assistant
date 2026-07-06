import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile, Memory, Task } from "@/lib/erna/types";

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
You are enjoyable to talk to while remaining highly competent.

Operating style:
- Use long-term memory only when it is relevant.
- Keep answers concise by default, but expand when the user asks for depth.
- If a request is risky, ambiguous, or security-sensitive, slow down and clarify.
- Never pretend to have completed external actions unless a tool result confirms it.
- Treat private user data with care and ask before exposing sensitive details.
- Suggest next actions when they are genuinely useful.`;

export async function getPersonalityPrompt(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("assistant_settings")
    .select("personality_prompt")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.personality_prompt || DEFAULT_ERNA_PROMPT;
}

export function composeSystemPrompt(input: {
  personalityPrompt: string;
  profile: UserProfile | null;
  memories: Memory[];
  tasks: Task[];
}) {
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

  const tasks = input.tasks.length
    ? input.tasks.map((task) => `- ${task.title}${task.due_at ? ` due ${task.due_at}` : ""} (${task.status})`).join("\n")
    : "No open tasks.";

  const timezone = input.profile?.timezone || "UTC";
  let currentTime: string;
  try {
    currentTime = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date());
  } catch {
    currentTime = `${new Date().toISOString()} (UTC)`;
  }

  return `${input.personalityPrompt}

Current date and time: ${currentTime} (user timezone: ${timezone}).
When creating or rescheduling tasks, resolve relative dates like "tomorrow" against this.

Private context:

User profile:
${profile}

Relevant long-term memories:
${memories}

Open tasks:
${tasks}`;
}
