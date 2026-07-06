import type { SupabaseClient } from "@supabase/supabase-js";
import type { Memory, Task, UserProfile } from "@/lib/erna/types";

export async function ensureProfile(supabase: SupabaseClient, userId: string, email?: string) {
  const { data: existing } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle<UserProfile>();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      display_name: email?.split("@")[0] || "Boss",
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

export async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  content: string,
  category = "general",
  importance = 3,
  source = "chat",
) {
  const { data, error } = await supabase
    .from("memories")
    .insert({ user_id: userId, content, category, importance, source })
    .select("*")
    .single<Memory>();

  if (error) throw error;
  return data;
}

export async function getRelevantMemories(supabase: SupabaseClient, userId: string, query: string) {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 3)
    .slice(0, 6);

  let request = supabase
    .from("memories")
    .select("id, content, category, importance, created_at")
    .eq("user_id", userId)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(8);

  if (terms.length) {
    request = request.or(terms.map((term) => `content.ilike.%${term}%`).join(","));
  }

  const { data, error } = await request.returns<Memory[]>();
  if (error) throw error;
  return data || [];
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
