import { AppShell } from "@/components/AppShell";
import { AdminPromptEditor } from "@/components/AdminPromptEditor";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPersonalityPrompt } from "@/lib/erna/prompts";

export default async function AdminPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const personalityPrompt = await getPersonalityPrompt(supabase, user.id);

  return (
    <AppShell active="admin" email={user.email}>
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <AdminPromptEditor initialPrompt={personalityPrompt} />

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ["Memory", "Stored in Supabase with RLS and retrieved into each chat."],
            ["Tools", "Server-side tool calls for memories, tasks, web search, and integrations."],
            ["Modules", "Calendar, email, and external task providers are represented as connectable modules."],
          ].map(([title, body]) => (
            <section key={title} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
