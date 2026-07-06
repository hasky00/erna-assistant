import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { convertCurrency } from "@/lib/erna/currency";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const result = await convertCurrency({
      amount: Number(searchParams.get("amount")),
      from: searchParams.get("from") || "",
      to: searchParams.get("to") || "",
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
