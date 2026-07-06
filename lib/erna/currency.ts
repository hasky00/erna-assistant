// Currency conversion using the free Open Exchange Rate API
// (https://www.exchangerate-api.com/docs/free — no API key required).
// Covers 160+ world currencies including AED, DKK, IDR, etc.

export async function convertCurrency(input: { amount: number; from: string; to: string }) {
  const amount = Number(input.amount);
  const from = String(input.from || "").trim().toUpperCase();
  const to = String(input.to || "").trim().toUpperCase();

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "amount must be a non-negative number." };
  }
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return { ok: false, error: "from and to must be 3-letter currency codes (e.g. USD, AED, DKK)." };
  }
  if (from === to) {
    return { ok: true, amount, from, to, rate: 1, result: amount, date: null };
  }

  let response: Response;
  try {
    response = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, error: "Could not reach the currency service." };
  }

  if (!response.ok) {
    return { ok: false, error: `Currency lookup failed (${response.status}).` };
  }

  const data = (await response.json()) as {
    result?: string;
    "error-type"?: string;
    time_last_update_utc?: string;
    rates?: Record<string, number>;
  };

  if (data.result !== "success" || !data.rates) {
    if (data["error-type"] === "unsupported-code") {
      return { ok: false, error: `Unsupported currency code: ${from}.` };
    }
    return { ok: false, error: "Currency service returned an error." };
  }

  const rate = data.rates[to];
  if (typeof rate !== "number") {
    return { ok: false, error: `Unsupported or unavailable target currency: ${to}.` };
  }

  return {
    ok: true,
    amount,
    from,
    to,
    rate,
    result: Math.round(amount * rate * 100) / 100,
    date: data.time_last_update_utc || null,
    source: "exchangerate-api.com (open access)",
  };
}
