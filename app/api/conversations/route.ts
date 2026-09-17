import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/api";
import type { Conversation } from "@/lib/erna/types";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export async function GET(request: Request) {
  try {
    const supabase = await createApiClient(request);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
    const before = searchParams.get("before"); // ISO timestamp for cursor (updated_at < before)

    let query = supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(limit + 1);

    if (before) {
      // strict less-than for cursor pagination
      query = query.lt("updated_at", before);
    }

    const { data, error } = await query.returns<Conversation[]>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data || [];
    const hasMore = rows.length > limit;
    const conversations = rows.slice(0, limit);

    return NextResponse.json({
      conversations,
      hasMore,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load conversations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
