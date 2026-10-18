import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { isAllowedUser, notOnGuestListMessage } from "@/lib/erna/guard";
import { signOut } from "@/app/actions";

export default async function LoginPage() {
  const user = await getCurrentUser();

  // Signed in but not on the guest list: show a clear message instead of
  // bouncing between /login and /chat forever.
  if (user && !isAllowedUser(user)) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center">
          <h1 className="text-xl font-semibold">Not on the guest list yet</h1>
          <p className="mt-3 text-sm text-[var(--muted)]">{notOnGuestListMessage(user)}</p>
          <form action={signOut} className="mt-6">
            <button className="rounded-md border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--panel-strong)]">
              Sign out
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (user) redirect("/chat");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <AuthForm />
    </main>
  );
}
