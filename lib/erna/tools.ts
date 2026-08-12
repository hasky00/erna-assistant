import type { ChatCompletionTool } from "openai/resources/chat/completions";
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
import { isKibanaMcpConfigured, queryBankingTelemetry } from "@/lib/erna/kibanaMcp";

const baseTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save a durable memory about the user, their preferences, or important facts.",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a private task for the user.",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List the user's tasks. Use this before completing or rescheduling so you have the task id. Returns task ids, titles, status, and due dates.",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Mark a task as done. Requires the task id (call list_tasks first if you don't have it).",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task id (UUID)." },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_task",
      description: "Change a task's due date, or clear it. Requires the task id.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task id (UUID)." },
          due_at: { type: "string", description: "New ISO timestamp, or null to clear the due date." },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_note",
      description:
        "Save a note or document to the user's private knowledge base for later retrieval. Use for reference material, longer notes, snippets, or saved facts the user wants to keep.",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description: "Search the user's private knowledge base of saved notes and documents.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description:
        "Delete a note from the knowledge base by id. Call search_knowledge first to find the id, and confirm with the user before deleting.",
      parameters: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "The note id (UUID)." },
        },
        required: ["note_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description:
        "Search long-term memories by keyword. Returns memory ids so you can reference or delete them.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description:
        "Delete a long-term memory by id. Call search_memory first to find the id, and confirm with the user before deleting.",
      parameters: {
        type: "object",
        properties: {
          memory_id: { type: "string", description: "The memory id (UUID)." },
        },
        required: ["memory_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_currency",
      description:
        "Convert an amount between two currencies using live exchange rates. Covers 160+ world currencies. Use 3-letter ISO codes (e.g. USD, EUR, AED, DKK, IDR, GBP, JPY).",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "update_preferences",
      description: "Replace the saved user preferences object when the user explicitly shares preferences.",
      parameters: {
        type: "object",
        properties: {
          preferences: { type: "object", additionalProperties: true },
        },
        required: ["preferences"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web when current information is needed. Requires TAVILY_API_KEY.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "integration_status",
      description: "Check whether optional calendar, email, and external task integrations are connected.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

/** Delegates banking-telemetry questions to the remote Kibana MCP endpoint. */
const kibanaTelemetryTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "query_banking_telemetry",
    description:
      "Answer questions about banking telemetry — SWIFT/SEPA payments, transaction status, " +
      "APM traces, microservice logs — by querying the organization's Elasticsearch through the " +
      "remote Kibana MCP endpoint. Pass the user's question in natural language.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The banking-telemetry question, in natural language.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
};

/**
 * Tools exposed to the model. The telemetry tool is advertised only when the remote
 * Kibana MCP endpoint is configured (KIBANA_MCP_URL + KIBANA_MCP_TOKEN), so unconfigured
 * deployments never see a dead tool.
 */
export const ernaTools: ChatCompletionTool[] = isKibanaMcpConfigured()
  ? [...baseTools, kibanaTelemetryTool]
  : baseTools;

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

  if (input.name === "update_preferences") {
    if (!args.preferences || typeof args.preferences !== "object" || Array.isArray(args.preferences)) {
      throw new Error("preferences must be an object");
    }
    await updateProfilePreferences(input.supabase, input.userId, args.preferences as Record<string, unknown>);
    return { ok: true };
  }

  if (input.name === "query_banking_telemetry") {
    return queryBankingTelemetry(String(args.question || ""));
  }

  if (input.name === "web_search") {
    return runWebSearch(String(args.query || ""));
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

async function runWebSearch(query: string) {
  const apiKey = optionalEnv("TAVILY_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      error: "Web search is not configured. Add TAVILY_API_KEY to enable this optional tool.",
    };
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, max_results: 5 }),
  });

  if (!response.ok) {
    return { ok: false, error: `Search failed with ${response.status}` };
  }

  return { ok: true, results: await response.json() };
}
