import { NextResponse } from "next/server";
import { authenticate, safeError } from "@/lib/erna/guard";
import { convertCurrency } from "@/lib/erna/currency";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticate(request);

    const { searchParams } = new URL(request.url);
    const result = await convertCurrency({
      amount: Number(searchParams.get("amount")),
      from: searchParams.get("from") || "",
      to: searchParams.get("to") || "",
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return safeError(error, "Conversion failed");
  }
}
