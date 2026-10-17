import { NextResponse } from "next/server";
import { authenticate, safeError } from "@/lib/erna/guard";
import type { Conversation } from "@/lib/erna/types";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);

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

    if (error) throw error;

    const rows = data || [];
    const hasMore = rows.length > limit;
    const conversations = rows.slice(0, limit);

    return NextResponse.json({
      conversations,
      hasMore,
    });
  } catch (error) {
    return safeError(error, "Failed to load conversations");
  }
}
