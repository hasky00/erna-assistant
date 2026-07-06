"use client";

import { useState } from "react";

// Common currencies for the dropdowns; any valid 3-letter code still works
// because the field also accepts free text via the datalist.
const CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD", "SGD",
  "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "DKK", "NOK", "SEK", "PLN", "CZK",
  "HUF", "TRY", "RUB", "INR", "IDR", "MYR", "THB", "PHP", "VND", "KRW", "TWD",
  "ZAR", "NGN", "KES", "EGP", "MAD", "GHS", "BRL", "MXN", "ARS", "CLP", "COP",
];

type Result = {
  ok: boolean;
  amount?: number;
  from?: string;
  to?: string;
  rate?: number | null;
  result?: number;
  date?: string | null;
  error?: string;
};

function CurrencyField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <input
        list="erna-currencies"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().slice(0, 3))}
        className="w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm uppercase outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

export function CurrencyConverter() {
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState("AED");
  const [to, setTo] = useState("DKK");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  function swap() {
    setFrom(to);
    setTo(from);
    setResult(null);
  }

  async function convert(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/convert?amount=${encodeURIComponent(amount)}&from=${from}&to=${to}`,
      );
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <datalist id="erna-currencies">
        {CURRENCIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <h2 className="text-lg font-semibold">Currency converter</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Live global rates — 160+ currencies. Type or pick any 3-letter code.
      </p>

      <form onSubmit={convert} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Amount</span>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>

        <CurrencyField value={from} onChange={setFrom} label="From" />

        <button
          type="button"
          onClick={swap}
          aria-label="Swap currencies"
          className="mb-[2px] rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel-strong)]"
          title="Swap"
        >
          ⇄
        </button>

        <CurrencyField value={to} onChange={setTo} label="To" />

        <button
          type="submit"
          disabled={busy || !amount || !from || !to}
          className="rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy ? "Converting…" : "Convert"}
        </button>
      </form>

      {result ? (
        result.ok ? (
          <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-2xl font-semibold">
              {result.amount?.toLocaleString()} {result.from} ={" "}
              <span className="text-[var(--accent)]">
                {result.result?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {result.to}
              </span>
            </p>
            {result.rate ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                1 {result.from} = {result.rate.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                {result.to}
                {result.date ? ` · ${result.date}` : ""}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-red-400">{result.error || "Conversion failed."}</p>
        )
      ) : null}
    </section>
  );
}
