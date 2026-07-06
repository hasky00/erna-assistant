import type { SupabaseClient } from "@supabase/supabase-js";

export type KnowledgeDocument = {
  id: string;
  title: string;
  body: string;
  source_url: string | null;
  created_at: string;
};

export async function saveNote(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  sourceUrl?: string | null,
) {
  const { data, error } = await supabase
    .from("knowledge_documents")
    .insert({
      user_id: userId,
      title,
      body,
      source_url: sourceUrl || null,
    })
    .select("id, title, source_url, created_at")
    .single();

  if (error) throw error;
  return data;
}

export async function listNotes(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("id, title, body, source_url, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<KnowledgeDocument[]>();

  if (error) throw error;
  return data || [];
}

export async function deleteNote(supabase: SupabaseClient, userId: string, noteId: string) {
  const { error } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", noteId)
    .eq("user_id", userId);
  if (error) throw error;
  return { id: noteId };
}

export async function searchKnowledge(supabase: SupabaseClient, userId: string, query: string) {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 3)
    .slice(0, 6);

  let request = supabase
    .from("knowledge_documents")
    .select("id, title, body, source_url, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (terms.length) {
    const filter = terms
      .map((term) => `title.ilike.%${term}%,body.ilike.%${term}%`)
      .join(",");
    request = request.or(filter);
  }

  const { data, error } = await request.returns<KnowledgeDocument[]>();
  if (error) throw error;

  // Trim bodies so large documents don't blow up the tool payload.
  return (data || []).map((doc) => ({
    ...doc,
    body: doc.body.length > 1200 ? `${doc.body.slice(0, 1200)}…` : doc.body,
  }));
}
