import { AppShell } from "@/components/AppShell";
import { ChatShell } from "@/components/ChatShell";
import { nostrNpub, requireUser } from "@/lib/auth";

export default async function ChatPage() {
  const user = await requireUser();

  return (
    <AppShell active="chat" email={user.email} npub={nostrNpub(user)}>
      <ChatShell />
    </AppShell>
  );
}
