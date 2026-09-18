import { AppShell } from "@/components/AppShell";
import { NotesPanel } from "@/components/NotesPanel";
import { CurrencyConverter } from "@/components/CurrencyConverter";
import { nostrNpub, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listNotes } from "@/lib/erna/knowledge";

export default async function NotesPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const notes = await listNotes(supabase, user.id);

  return (
    <AppShell active="notes" email={user.email} npub={nostrNpub(user)}>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <NotesPanel initialNotes={notes} />
        <CurrencyConverter />
      </div>
    </AppShell>
  );
}
