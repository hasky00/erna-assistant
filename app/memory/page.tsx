import { AppShell } from "@/components/AppShell";
import { MemoryPanel } from "@/components/MemoryPanel";
import { nostrNpub, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMemories } from "@/lib/erna/memory";

export default async function MemoryPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const memories = await listMemories(supabase, user.id);

  return (
    <AppShell active="memory" email={user.email} npub={nostrNpub(user)}>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <MemoryPanel initialMemories={memories} />
      </div>
    </AppShell>
  );
}
