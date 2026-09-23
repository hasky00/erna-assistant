// Danish bookkeeping knowledge for Hasky Labs (enkeltmandsvirksomhed, Dinero).
// Knowledge only — Erna advises; she never books anything in Dinero herself.

export const ACCOUNTING_PRIMER = `Accounting skill (Danish bookkeeping, Dinero):
You also act as a careful Danish bookkeeping helper for the user's company Hasky Labs
(enkeltmandsvirksomhed, CVR 31961424, branche 62.10.00, VAT-registered, quarterly moms, books kept in Dinero).
- Bogføringsloven 2026: registered digital bookkeeping system required for enkeltmandsvirksomheder with net revenue
  over 300,000 kr in two consecutive years (Dinero is registered, so she is covered). Every posting needs a bilag;
  keep bilag digitally for 5 years.
- Dinero "automatiske bogføringsregler" are created by booking a bank line once and ticking remember. A rule repeats
  the same account + momskode forever, so a wrong momskode is repeated too.
- Moms basics: Danish suppliers 25% købsmoms. Foreign services (Anthropic, X, Netlify, Replit, Google, Name.com)
  use omvendt betalingspligt — EU or non-EU code depends on the country on the invoice, not the brand.
  Repræsentation (guests, business meals): 25% of the moms and 25% of the expense deductible.
  Mixed private/business (phone, internet): only the business share; never automate these.
- Quarterly moms deadlines (check skat.dk): Q1 → 1 June, Q2 → 1 Sept, Q3 → 1 Dec, Q4 → 1 March.
- Stripe/PayPal payouts are not revenue by themselves: revenue comes from sales invoices; payouts go to a
  mellemregningskonto and fees to gebyrer.
- Use the bookkeeping_rule tool to look up a supplier or transaction before answering.
- You are not an accountant (revisor): say so on anything with real tax risk, and never claim you booked
  something in Dinero.`;

export type BookingRule = {
  match: string[];
  supplier: string;
  account: string;
  momskode: string;
  automate: boolean;
  note: string;
};

export const BOOKING_RULES: BookingRule[] = [
  {
    match: ["anthropic", "claude"],
    supplier: "Anthropic (Claude)",
    account: "Software og IT-abonnementer",
    momskode: "Omvendt betalingspligt – ydelser (EU or non-EU per invoice address)",
    automate: true,
    note: "Check whether the invoice is from an EU (e.g. Ireland) or US entity.",
  },
  {
    match: ["x corp", "twitter", "x premium", "premium+"],
    supplier: "X / Twitter Premium+ (@haskyLabs)",
    account: "Reklame og markedsføring",
    momskode: "Omvendt betalingspligt – ydelser (EU or non-EU per invoice address)",
    automate: true,
    note: "Business account only; a private X subscription is not deductible.",
  },
  {
    match: ["netlify", "replit", "name.com", "google play", "google", "vercel", "supabase", "github"],
    supplier: "Hosting / dev tools (Netlify, Replit, Name.com, Google, Vercel, Supabase, GitHub)",
    account: "Software og IT-abonnementer / hosting",
    momskode: "Omvendt betalingspligt – ydelser (EU or non-EU per invoice address)",
    automate: true,
    note: "Google Play is only deductible if used for the business (e.g. NotebookLM research).",
  },
  {
    match: ["alhambrabits", "alhambra"],
    supplier: "AlhambraBits",
    account: "Varekøb / materialer (hardware for Kizami)",
    momskode: "EU-køb af varer (erhvervelsesmoms) if EU supplier with VAT number; otherwise read the invoice",
    automate: false,
    note: "Physical goods — check invoice for VAT number and country before choosing momskode.",
  },
  {
    match: ["kaffek", "kaffe"],
    supplier: "KaffeK",
    account: "Kontorhold / personaleudgifter",
    momskode: "Købsmoms 25%",
    automate: true,
    note: "If coffee is for guests/clients it is repræsentation (25% deductible) instead.",
  },
  {
    match: ["hi3g", " 3 ", "tre ", "telefon", "mobil", "bredbånd", "internet"],
    supplier: "3 (Hi3G) – phone and broadband",
    account: "Telefon og internet",
    momskode: "Købsmoms 25% (business share only)",
    automate: false,
    note: "Mixed private/business on a private subscription: book only the business share, or move it to an erhverv plan.",
  },
  {
    match: ["sydbank", "arbejdernes landsbank", "gebyr", "kontogebyr"],
    supplier: "AL Sydbank fees",
    account: "Bankgebyrer",
    momskode: "Ingen moms",
    automate: true,
    note: "Erhvervskonto Basis: 250 kr/month; 3,000 kr opening fee also here.",
  },
  {
    match: ["stripe", "paypal"],
    supplier: "Stripe / PayPal payouts",
    account: "Mellemregningskonto (Stripe/PayPal); fees to Gebyrer",
    momskode: "Ingen moms on payout; sales moms is on the sales invoice",
    automate: true,
    note: "Revenue is booked from sales invoices, not from payouts.",
  },
  {
    match: ["privat", "overførsel", "egen konto", "mobilepay"],
    supplier: "Transfers to/from private account",
    account: "Privat hævning / privat indskud",
    momskode: "Ingen moms",
    automate: false,
    note: "Only automate if the counter-account is clearly her own private account.",
  },
  {
    match: ["dkpto", "patent", "varemærke", "trademark"],
    supplier: "DKPTO trademark fee",
    account: "Etableringsomkostninger / rådgivning",
    momskode: "Ingen moms",
    automate: false,
    note: "One-off purchase — do not create a rule.",
  },
];

export function lookupBookingRule(query: string) {
  const q = ` ${query.toLowerCase()} `;
  const matches = BOOKING_RULES.filter((rule) => rule.match.some((m) => q.includes(m)));
  return {
    ok: true,
    query,
    matches,
    fallback: matches.length
      ? undefined
      : "No saved rule. Ask for the invoice: supplier country, VAT number, and business purpose, then suggest account + momskode and say it is a suggestion.",
    reminder: "Every posting needs a bilag attached in Dinero. Not advice from a revisor.",
  };
}
