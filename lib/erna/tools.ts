import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv } from "@/lib/env";
import {
  deleteMemory,
  getRelevantMemories,
  listTasks,
  rescheduleTask,
  saveMemory,
  setTaskStatus,
  updateProfilePreferences,
} from "@/lib/erna/memory";
import { deleteNote, saveNote, searchKnowledge } from "@/lib/erna/knowledge";
import { convertCurrency } from "@/lib/erna/currency";
import { lookupBookingRule } from "@/lib/erna/accounting";

export const ernaTools: Anthropic.Tool[] = [
  {
      name: "save_memory",
      description: "Save a durable memory about the user, their preferences, or important facts.",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string" },
          category: { type: "string", enum: ["profile", "preference", "relationship", "work", "life", "general"] },
          importance: { type: "number", minimum: 1, maximum: 5 },
        },
        required: ["content"],
        additionalProperties: false,
      },
  },
  {
      name: "create_task",
      description: "Create a private task for the user.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          notes: { type: "string" },
          due_at: { type: "string", description: "ISO timestamp or null" },
        },
        required: ["title"],
        additionalProperties: false,
      },
  },
  {
      name: "list_tasks",
      description:
        "List the user's tasks. Use this before completing or rescheduling so you have the task id. Returns task ids, titles, status, and due dates.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["open", "done", "archived", "all"],
            description: "Which tasks to return. Defaults to open.",
          },
        },
        additionalProperties: false,
      },
  },
  {
      name: "complete_task",
      description: "Mark a task as done. Requires the task id (call list_tasks first if you don't have it).",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task id (UUID)." },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
  },
  {
      name: "reschedule_task",
      description: "Change a task's due date, or clear it. Requires the task id.",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task id (UUID)." },
          due_at: { type: "string", description: "New ISO timestamp, or null to clear the due date." },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
  },
  {
      name: "save_note",
      description:
        "Save a note or document to the user's private knowledge base for later retrieval. Use for reference material, longer notes, snippets, or saved facts the user wants to keep.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          source_url: { type: "string", description: "Optional URL the note came from." },
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
  },
  {
      name: "search_knowledge",
      description: "Search the user's private knowledge base of saved notes and documents.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
  },
  {
      name: "delete_note",
      description:
        "Delete a note from the knowledge base by id. Call search_knowledge first to find the id, and confirm with the user before deleting.",
      input_schema: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "The note id (UUID)." },
        },
        required: ["note_id"],
        additionalProperties: false,
      },
  },
  {
      name: "search_memory",
      description:
        "Search long-term memories by keyword. Returns memory ids so you can reference or delete them.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
  },
  {
      name: "delete_memory",
      description:
        "Delete a long-term memory by id. Call search_memory first to find the id, and confirm with the user before deleting.",
      input_schema: {
        type: "object",
        properties: {
          memory_id: { type: "string", description: "The memory id (UUID)." },
        },
        required: ["memory_id"],
        additionalProperties: false,
      },
  },
  {
      name: "convert_currency",
      description:
        "Convert an amount between two currencies using live exchange rates. Covers 160+ world currencies. Use 3-letter ISO codes (e.g. USD, EUR, AED, DKK, IDR, GBP, JPY).",
      input_schema: {
        type: "object",
        properties: {
          amount: { type: "number" },
          from: { type: "string", description: "Source 3-letter currency code." },
          to: { type: "string", description: "Target 3-letter currency code." },
        },
        required: ["amount", "from", "to"],
        additionalProperties: false,
      },
  },
  {
      name: "bookkeeping_rule",
      description:
        "Look up how to book a Hasky Labs expense or bank transaction in Dinero (Danish bookkeeping): account, momskode, and whether to make it an automatic rule. Knowledge only; does not touch Dinero.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Supplier name or bank transaction text, e.g. 'Anthropic' or 'NETLIFY INC'." },
        },
        required: ["query"],
        additionalProperties: false,
      },
  },
  {
      name: "update_preferences",
      description: "Replace the saved user preferences object when the user explicitly shares preferences.",
      input_schema: {
        type: "object",
        properties: {
          preferences: { type: "object", additionalProperties: true },
        },
        required: ["preferences"],
        additionalProperties: false,
      },
  },
  {
      name: "web_search",
      description:
        "Search the web for current information, news, prices, documentation, or anything not on Wikipedia. Returns titles, URLs and snippets; call fetch_url to read a result in full.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
  },
  {
      name: "integration_status",
      description: "Check whether optional calendar, email, and external task integrations are connected.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
  },
  {
      name: "wikipedia_lookup",
      description:
        "Look up a topic on Wikipedia and get a reliable summary plus the article URL. Use for any factual question about people, places, history, science, companies, concepts, or definitions. Free, no key needed. Prefer this over guessing from memory.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Topic or article title, e.g. 'Lightning Network' or 'Copenhagen'." },
          lang: { type: "string", description: "Wikipedia language code. Defaults to 'en'. Use 'da' for Danish, 'id' for Indonesian." },
        },
        required: ["query"],
        additionalProperties: false,
      },
  },
  {
      name: "fetch_url",
      description:
        "Fetch a web page and return its readable text (HTML stripped, truncated). Use when the user shares a link, or after web_search to read a result in full.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL." },
        },
        required: ["url"],
        additionalProperties: false,
      },
  },
  {
      name: "calculate",
      description:
        "Evaluate an arithmetic expression exactly. Supports + - * / % ^ parentheses and functions sqrt, abs, round, floor, ceil, min, max, pow, log, ln, exp, sin, cos, tan, plus constants pi and e. Use this for any math instead of estimating.",
      input_schema: {
        type: "object",
        properties: {
          expression: { type: "string", description: "e.g. '(1200 * 1.25) / 7.46' or 'sqrt(2) * pi'." },
        },
        required: ["expression"],
        additionalProperties: false,
      },
  },
  {
      name: "current_datetime",
      description: "Get the exact current date and time in a given IANA timezone. Use for 'what time is it in Jakarta', countdowns, or date arithmetic.",
      input_schema: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "IANA zone, e.g. 'Europe/Copenhagen'. Defaults to the user's timezone or UTC." },
        },
        additionalProperties: false,
      },
  },
];

export async function runTool(input: {
  supabase: SupabaseClient;
  userId: string;
  name: string;
  argumentsText: string;
}) {
  const args = parseToolArgs(input.argumentsText);

  if (input.name === "save_memory") {
    const memory = await saveMemory(
      input.supabase,
      input.userId,
      String(args.content),
      typeof args.category === "string" ? args.category : "general",
      typeof args.importance === "number" ? args.importance : 3,
      "tool",
    );
    return { ok: true, memory };
  }

  if (input.name === "create_task") {
    const { data, error } = await input.supabase
      .from("tasks")
      .insert({
        user_id: input.userId,
        title: String(args.title),
        notes: typeof args.notes === "string" ? args.notes : null,
        due_at: typeof args.due_at === "string" ? args.due_at : null,
      })
      .select("id, title, due_at, status")
      .single();

    if (error) throw error;
    return { ok: true, task: data };
  }

  if (input.name === "list_tasks") {
    const status =
      args.status === "done" || args.status === "archived" || args.status === "all"
        ? args.status
        : "open";
    const tasks = await listTasks(input.supabase, input.userId, status);
    return { ok: true, tasks };
  }

  if (input.name === "complete_task") {
    const task = await setTaskStatus(input.supabase, input.userId, String(args.task_id), "done");
    if (!task) return { ok: false, error: "No matching task found for that id." };
    return { ok: true, task };
  }

  if (input.name === "reschedule_task") {
    const dueAt = typeof args.due_at === "string" && args.due_at ? args.due_at : null;
    const task = await rescheduleTask(input.supabase, input.userId, String(args.task_id), dueAt);
    if (!task) return { ok: false, error: "No matching task found for that id." };
    return { ok: true, task };
  }

  if (input.name === "save_note") {
    const note = await saveNote(
      input.supabase,
      input.userId,
      String(args.title),
      String(args.body),
      typeof args.source_url === "string" ? args.source_url : null,
    );
    return { ok: true, note };
  }

  if (input.name === "search_knowledge") {
    const results = await searchKnowledge(input.supabase, input.userId, String(args.query || ""));
    return { ok: true, results };
  }

  if (input.name === "delete_note") {
    const deleted = await deleteNote(input.supabase, input.userId, String(args.note_id));
    return { ok: true, deleted };
  }

  if (input.name === "search_memory") {
    const results = await getRelevantMemories(input.supabase, input.userId, String(args.query || ""));
    return { ok: true, results };
  }

  if (input.name === "delete_memory") {
    const deleted = await deleteMemory(input.supabase, input.userId, String(args.memory_id));
    return { ok: true, deleted };
  }

  if (input.name === "convert_currency") {
    return convertCurrency({
      amount: Number(args.amount),
      from: String(args.from || ""),
      to: String(args.to || ""),
    });
  }

  if (input.name === "bookkeeping_rule") {
    return lookupBookingRule(String(args.query || ""));
  }

  if (input.name === "update_preferences") {
    if (!args.preferences || typeof args.preferences !== "object" || Array.isArray(args.preferences)) {
      throw new Error("preferences must be an object");
    }
    await updateProfilePreferences(input.supabase, input.userId, args.preferences as Record<string, unknown>);
    return { ok: true };
  }

  if (input.name === "web_search") {
    return runWebSearch(String(args.query || ""));
  }

  if (input.name === "wikipedia_lookup") {
    return wikipediaLookup(String(args.query || ""), typeof args.lang === "string" ? args.lang : "en");
  }

  if (input.name === "fetch_url") {
    return fetchUrl(String(args.url || ""));
  }

  if (input.name === "calculate") {
    return calculate(String(args.expression || ""));
  }

  if (input.name === "current_datetime") {
    return currentDatetime(typeof args.timezone === "string" ? args.timezone : undefined);
  }

  if (input.name === "integration_status") {
    const { data, error } = await input.supabase
      .from("tool_connections")
      .select("provider, status, scopes, updated_at")
      .eq("user_id", input.userId);

    if (error) throw error;
    return { ok: true, integrations: data || [] };
  }

  return { ok: false, error: `Unknown tool: ${input.name}` };
}

function parseToolArgs(argumentsText: string) {
  try {
    return JSON.parse(argumentsText || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const USER_AGENT = "ErnaAssistant/1.0 (+https://haskylabs.com)";

async function runWebSearch(query: string) {
  if (!query.trim()) return { ok: false, error: "Empty query." };

  const apiKey = optionalEnv("TAVILY_API_KEY");
  if (apiKey) {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, max_results: 5 }),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        results?: Array<{ title: string; url: string; content: string }>;
      };
      return {
        ok: true,
        provider: "tavily",
        results: (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
      };
    }
    // fall through to the free provider on failure
  }

  // Free fallback: DuckDuckGo HTML endpoint, no key required.
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!response.ok) {
    return { ok: false, error: `Search failed with ${response.status}` };
  }

  const html = await response.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = html.split('class="result__body"').slice(1, 9);
  for (const block of blocks) {
    const link = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    let url = decodeHtml(link[1]);
    // DDG wraps links as /l/?uddg=<encoded url>
    const m = /[?&]uddg=([^&]+)/.exec(url);
    if (m) url = decodeURIComponent(m[1]);
    results.push({
      title: stripTags(link[2]),
      url,
      snippet: snippet ? stripTags(snippet[1]) : "",
    });
  }

  if (results.length) {
    return { ok: true, provider: "duckduckgo", results };
  }

  // DuckDuckGo serves a bot challenge to many cloud IPs. Degrade to Wikipedia
  // search so the user still gets something, and tell the model why.
  const wiki = await wikipediaLookup(query, "en");
  return {
    ok: false,
    provider: "duckduckgo",
    error:
      "Web search is blocked from this server (DuckDuckGo bot challenge) and no TAVILY_API_KEY is set. " +
      "Falling back to Wikipedia. For live web results, add a free Tavily key (https://tavily.com) to the server env.",
    wikipedia_fallback: wiki.ok ? wiki : null,
  };
}

async function wikipediaLookup(query: string, lang: string) {
  if (!query.trim()) return { ok: false, error: "Empty query." };
  const safeLang = /^[a-z]{2,3}$/.test(lang) ? lang : "en";
  const base = `https://${safeLang}.wikipedia.org`;

  // 1. Find the best matching article title.
  const searchUrl = `${base}/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(query)}`;
  const searchRes = await fetch(searchUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!searchRes.ok) return { ok: false, error: `Wikipedia search failed with ${searchRes.status}` };
  const searchData = (await searchRes.json()) as {
    query?: { search?: Array<{ title: string; snippet: string }> };
  };
  const hits = searchData.query?.search || [];
  if (!hits.length) return { ok: false, error: `No Wikipedia article found for "${query}".` };

  // 2. Fetch the summary of the top hit.
  const title = hits[0].title;
  const summaryRes = await fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!summaryRes.ok) return { ok: false, error: `Wikipedia summary failed with ${summaryRes.status}` };
  const summary = (await summaryRes.json()) as {
    title: string;
    description?: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
  };

  return {
    ok: true,
    title: summary.title,
    description: summary.description || null,
    extract: summary.extract || "",
    url: summary.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(title)}`,
    other_matches: hits.slice(1).map((h) => h.title),
  };
}

async function fetchUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http(s) URLs are supported." };
  }
  // Keep the assistant from poking at private networks.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(url.hostname)) {
    return { ok: false, error: "Private or local addresses are not allowed." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain,application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `Fetch failed with ${response.status}` };

    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();
    const text = contentType.includes("html") ? htmlToText(raw) : raw;
    const MAX = 12000;
    return {
      ok: true,
      url: response.url,
      title: contentType.includes("html") ? extractTitle(raw) : null,
      content_type: contentType,
      truncated: text.length > MAX,
      text: text.slice(0, MAX),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Fetch failed." };
  } finally {
    clearTimeout(timer);
  }
}

function calculate(expression: string) {
  const expr = expression.trim();
  if (!expr) return { ok: false, error: "Empty expression." };
  if (expr.length > 300) return { ok: false, error: "Expression too long." };

  // Whitelist: digits, operators, parentheses, dots, commas, whitespace, and known identifiers.
  const allowedIdent = new Set([
    "sqrt", "abs", "round", "floor", "ceil", "min", "max", "pow", "log", "ln", "exp", "sin", "cos", "tan", "pi", "e",
  ]);
  const idents = expr.match(/[A-Za-z_]+/g) || [];
  for (const id of idents) {
    if (!allowedIdent.has(id)) return { ok: false, error: `Unknown identifier: ${id}` };
  }
  if (!/^[0-9A-Za-z_+\-*/%^().,\s]+$/.test(expr)) {
    return { ok: false, error: "Expression contains unsupported characters." };
  }

  const js = expr
    .replace(/\^/g, "**")
    .replace(/\bln\(/g, "Math.log(")
    .replace(/\blog\(/g, "Math.log10(")
    .replace(/\b(sqrt|abs|round|floor|ceil|min|max|pow|exp|sin|cos|tan)\(/g, "Math.$1(")
    .replace(/\bpi\b/g, "Math.PI")
    .replace(/\be\b/g, "Math.E");

  try {
    // Only Math.* and numeric literals can appear after the whitelist above.
    const value = Function(`"use strict"; return (${js});`)() as unknown;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "Result is not a finite number." };
    }
    return { ok: true, expression: expr, result: value, formatted: formatNumber(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not evaluate." };
  }
}

function currentDatetime(timezone?: string) {
  const tz = timezone || "UTC";
  try {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: tz,
    }).format(now);
    return { ok: true, timezone: tz, iso_utc: now.toISOString(), formatted, unix: Math.floor(now.getTime() / 1000) };
  } catch {
    return { ok: false, error: `Unknown timezone: ${tz}` };
  }
}

// ---- small HTML helpers -----------------------------------------------------

function stripTags(html: string) {
  return decodeHtml(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function extractTitle(html: string) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? stripTags(m[1]) : null;
}

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|blockquote|pre)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function decodeHtml(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function formatNumber(value: number) {
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 10 });
}
