import Link from "next/link";
import { signOut } from "@/app/actions";
import { shortNpub } from "@/lib/nostr/login";

export function AppShell({
  children,
  active,
  email,
  npub,
}: {
  children: React.ReactNode;
  active: "chat" | "tasks" | "notes" | "admin";
  email?: string | null;
  /** Set when the user signed in with Nostr; replaces the placeholder email. */
  npub?: string | null;
}) {
  const navItems: Array<{ href: string; label: string; key: typeof active }> = [
    { href: "/chat", label: "Chat", key: "chat" },
    { href: "/tasks", label: "Tasks", key: "tasks" },
    { href: "/notes", label: "Notes", key: "notes" },
    { href: "/admin", label: "Admin", key: "admin" },
  ];
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="shell-grid min-h-screen">
        <aside className="border-b border-[var(--border)] bg-[var(--panel)] p-4 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-4 md:block">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent)]">Private assistant</p>
              <h1 className="mt-1 text-3xl font-semibold">Erna</h1>
              {npub ? (
                <p className="mt-1 font-mono text-xs text-[var(--accent)]" title={npub}>
                  {shortNpub(npub)}
                </p>
              ) : null}
              <p className="mt-2 hidden text-sm leading-6 text-[var(--muted)] md:block">
                Memory, tasks, tools, and personality controls in one private workspace.
              </p>
            </div>
            <form action={signOut}>
              <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--panel-strong)]">
                Sign out
              </button>
            </form>
          </div>

          <nav className="mt-5 flex flex-wrap gap-2 md:flex-col">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm ${
                  active === item.key
                    ? "bg-[var(--accent)] text-black"
                    : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {email && !npub ? <p className="mt-5 hidden text-xs text-[var(--muted)] md:block">{email}</p> : null}
        </aside>

        <section className="min-w-0">{children}</section>
      </div>
    </main>
  );
}
