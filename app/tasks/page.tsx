import { AppShell } from "@/components/AppShell";
import { TasksPanel } from "@/components/TasksPanel";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listTasks } from "@/lib/erna/memory";

export default async function TasksPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const tasks = await listTasks(supabase, user.id, "open");

  return (
    <AppShell active="tasks" email={user.email}>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <TasksPanel initialTasks={tasks} />
      </div>
    </AppShell>
  );
}
