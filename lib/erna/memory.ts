import type { SupabaseClient } from "@supabase/supabase-js";
import type { Memory, Task, UserProfile, MemoryWithOrigin } from "@/lib/erna/types";

/** Erna lives in Copenhagen unless the user says otherwise. */
export const DEFAULT_TIMEZONE = "Europe/Copenhagen";

export async function ensureProfile(supabase: SupabaseClient, userId: string, email?: string) {
  const { data: existing } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle<UserProfile>();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      display_name: email?.split("@")[0] || "Boss",
      timezone: DEFAULT_TIMEZONE,
      preferences: {},
    })
    .select("*")
    .single<UserProfile>();

  if (error) throw error;
  return data;
}

export async function updateProfilePreferences(
  supabase: SupabaseClient,
  userId: string,
  preferences: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("profiles")
    .update({ preferences, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) throw error;
}

export async function updateProfileTimezone(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  options: { lock?: boolean } = {},
) {
  const update: Record<string, unknown> = { timezone, updated_at: new Date().toISOString() };
  if (options.lock) {
    // Merge rather than replace preferences: timezone_locked=true means the
    // user picked this zone on purpose; the device zone must not override it.
    const { data } = await supabase.from("profiles").select("preferences").eq("id", userId).maybeSingle<{
      preferences: Record<string, unknown> | null;
    }>();
    update.preferences = { ...(data?.preferences ?? {}), timezone_locked: true };
  }
  const { error } = await supabase.from("profiles").update(update).eq("id", userId);
  if (error) throw error;
}

/**
 * Follow the device: when the app reports the phone's timezone and the user
 * has not locked one explicitly, adopt it. Returns the zone to use now.
 */
export async function adoptDeviceTimezone(
  supabase: SupabaseClient,
  profile: UserProfile,
  deviceTimezone: string | null,
) {
  const current = profile.timezone || DEFAULT_TIMEZONE;
  if (!deviceTimezone || deviceTimezone === current) return current;
  const locked = Boolean((profile.preferences as Record<string, unknown> | null)?.timezone_locked);
  if (locked) return current;
  await updateProfileTimezone(supabase, profile.id, deviceTimezone);
  return deviceTimezone;
}

export async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  content: string,
  category = "general",
  importance = 3,
  source = "chat",
  conversationId: string | null = null,
) {
  const safeImportance = Math.min(5, Math.max(1, Math.round(Number(importance) || 3)));
  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      content,
      category,
      importance: safeImportance,
      source,
      conversation_id: conversationId,
    })
    .select("*")
    .single<Memory>();

  if (error) throw error;
  return data;
}

/** Everything Erna remembers about the user, newest first, with the chat each came from. */
export async function listMemories(supabase: SupabaseClient, userId: string): Promise<MemoryWithOrigin[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("id, content, category, importance, source, conversation_id, created_at, updated_at, conversations(title)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data || []).map((row) => {
    const { conversations, ...memory } = row as Memory & {
      conversations: { title: string } | { title: string }[] | null;
    };
    const conv = Array.isArray(conversations) ? conversations[0] : conversations;
    return { ...memory, conversation_title: conv?.title ?? null };
  });
}

export async function updateMemory(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
  patch: { content?: string; category?: string; importance?: number },
) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.content === "string" && patch.content.trim()) update.content = patch.content.trim();
  if (typeof patch.category === "string" && patch.category) update.category = patch.category;
  if (typeof patch.importance === "number") {
    update.importance = Math.min(5, Math.max(1, Math.round(patch.importance)));
  }

  const { data, error } = await supabase
    .from("memories")
    .update(update)
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle<Memory>();

  if (error) throw error;
  return data;
}

/** Forget everything. Returns how many memories were removed. */
export async function deleteAllMemories(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("memories").delete().eq("user_id", userId).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

const STOPWORDS = new Set([
  "what", "which", "when", "where", "who", "whom", "with", "that", "this", "these", "those", "there", "have",
  "has", "had", "from", "about", "your", "you", "yours", "mine", "ours", "they", "them", "their", "will",
  "would", "could", "should", "can", "does", "did", "please", "tell", "know", "want", "need", "like", "just",
  "also", "some", "more", "much", "many", "very", "then", "than", "into", "onto", "over", "under", "again",
  "hvad", "hvor", "hvem", "hvordan", "hvornår", "hvorfor", "ikke", "eller", "også", "noget", "nogen", "skal",
  "kan", "vil", "har", "var", "jeg", "dig", "mig", "det", "den", "der", "med", "for", "til", "som", "men",
  "and", "the", "but", "not", "are", "was", "were", "for", "our", "his", "her", "its", "min", "din", "sin",
  "apa", "yang", "dengan", "untuk", "saya", "kamu", "bisa", "tidak", "sudah", "akan", "dari", "ini", "itu",
]);

/** Unicode-aware keyword extraction: keeps æøå, é, etc., drops filler words. */
export function keywords(query: string, max = 8) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const term = raw.trim();
    if (term.length < 3 || STOPWORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Memories for the system prompt: the user's most important ones are always
 * included (so Erna never forgets who she is talking to), plus up to 8 that
 * match the current message by keyword.
 */
export async function getRelevantMemories(supabase: SupabaseClient, userId: string, query: string) {
  const terms = keywords(query);

  const core = supabase
    .from("memories")
    .select("id, content, category, importance, created_at")
    .eq("user_id", userId)
    .gte("importance", 4)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<Memory[]>();

  const matched = terms.length
    ? supabase
        .from("memories")
        .select("id, content, category, importance, created_at")
        .eq("user_id", userId)
        .or(terms.map((term) => `content.ilike.%${term.replace(/[%,()]/g, " ")}%`).join(","))
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(8)
        .returns<Memory[]>()
    : Promise.resolve({ data: [] as Memory[], error: null });

  const [coreRes, matchedRes] = await Promise.all([core, matched]);
  if (coreRes.error) throw coreRes.error;
  if (matchedRes.error) throw matchedRes.error;

  const byId = new Map<string, Memory>();
  for (const m of [...(coreRes.data || []), ...(matchedRes.data || [])]) byId.set(m.id, m);
  return [...byId.values()].slice(0, 16);
}

export async function getOpenTasks(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, due_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(8)
    .returns<Task[]>();

  if (error) throw error;
  return data || [];
}

export async function listTasks(
  supabase: SupabaseClient,
  userId: string,
  status: "open" | "done" | "archived" | "all" = "open",
) {
  let request = supabase
    .from("tasks")
    .select("id, title, notes, status, due_at, created_at")
    .eq("user_id", userId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (status !== "all") {
    request = request.eq("status", status);
  }

  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

export async function setTaskStatus(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  status: "open" | "done" | "archived",
) {
  const { data, error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id, title, status, due_at")
    .maybeSingle<Task>();

  if (error) throw error;
  return data;
}

export async function createTask(
  supabase: SupabaseClient,
  userId: string,
  input: { title: string; notes?: string | null; due_at?: string | null },
) {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: input.title,
      notes: input.notes ?? null,
      due_at: input.due_at ?? null,
    })
    .select("id, title, notes, status, due_at, created_at")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTask(supabase: SupabaseClient, userId: string, taskId: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId).eq("user_id", userId);
  if (error) throw error;
  return { id: taskId };
}

export async function deleteMemory(supabase: SupabaseClient, userId: string, memoryId: string) {
  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("id", memoryId)
    .eq("user_id", userId);
  if (error) throw error;
  return { id: memoryId };
}

export async function rescheduleTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  dueAt: string | null,
) {
  const { data, error } = await supabase
    .from("tasks")
    .update({ due_at: dueAt, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id, title, status, due_at")
    .maybeSingle<Task>();

  if (error) throw error;
  return data;
}
