// Time helpers: everything the model sees should be in the user's own
// timezone. Raw ISO/UTC strings stay in the database; the model gets a
// human-readable local rendering alongside.

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "Sat 25 Oct 2026, 09:00" in the given zone; null for missing/invalid input. */
export function formatInZone(iso: string | null | undefined, timeZone: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Adds `due_local` / `created_local` next to the raw timestamps a row carries. */
export function localizeTimestamps<T extends { due_at?: string | null; created_at?: string | null }>(
  row: T,
  timeZone: string,
): T & { due_local?: string | null; created_local?: string | null } {
  const out: T & { due_local?: string | null; created_local?: string | null } = { ...row };
  if ("due_at" in row) out.due_local = formatInZone(row.due_at ?? null, timeZone);
  if ("created_at" in row) out.created_local = formatInZone(row.created_at ?? null, timeZone);
  return out;
}
