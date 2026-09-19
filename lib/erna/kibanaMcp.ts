/**
 * Bridge from Erna to the remote **Kibana Banking MCP** endpoint.
 *
 * Instead of talking to Elasticsearch directly, Erna delegates banking-telemetry
 * questions to the remote MCP server (the `kibana-assistant-mcp-server` running the
 * HTTP transport) using OpenAI's hosted **MCP tool** on the Responses API. OpenAI
 * connects to the MCP server, lists its tools, calls them as needed, and returns a
 * natural-language answer — Erna never has to hold Elasticsearch credentials.
 *
 * Configuration (all optional — the feature is inert until set):
 *   - `KIBANA_MCP_URL`   — the remote endpoint, e.g. `https://mcp.bankstr.xyz/mcp`
 *   - `KIBANA_MCP_TOKEN` — bearer token the endpoint requires (its `MCP_AUTH_TOKEN`)
 *
 * @module
 */
import { optionalEnv } from "@/lib/env";
import { getOpenAI, getOpenAIModel } from "@/lib/openai";

/** Tools the remote server exposes; scoping the allow-list keeps the model on-rails. */
const ALLOWED_TOOLS = [
  "discoverClusterTool",
  "kibanaSearchTool",
  "listIndicesTool",
  "getIndexMappingsTool",
];

export interface KibanaMcpConfig {
  url: string;
  token: string;
}

/**
 * Resolve the remote MCP endpoint config from the environment.
 *
 * @returns The config, or `null` when the integration is not configured.
 */
export function getKibanaMcpConfig(): KibanaMcpConfig | null {
  const url = optionalEnv("KIBANA_MCP_URL");
  const token = optionalEnv("KIBANA_MCP_TOKEN");
  if (!url || !token) return null;
  return { url, token };
}

/** Whether the Kibana telemetry bridge is available in this deployment. */
export function isKibanaMcpConfigured(): boolean {
  return getKibanaMcpConfig() !== null;
}

export interface TelemetryAnswer {
  ok: boolean;
  text: string;
  /** Names of the remote MCP tools OpenAI actually invoked, for transparency/audit. */
  toolsUsed: string[];
  error?: string;
}

/**
 * Answer a banking-telemetry question by delegating to the remote Kibana MCP endpoint.
 *
 * @param question - A natural-language question, e.g. "How many SWIFT payments failed
 *   in the last 24h, broken down by beneficiary bank?"
 */
export async function queryBankingTelemetry(question: string): Promise<TelemetryAnswer> {
  const config = getKibanaMcpConfig();
  if (!config) {
    return {
      ok: false,
      text: "",
      toolsUsed: [],
      error:
        "Banking telemetry is not configured. Set KIBANA_MCP_URL and KIBANA_MCP_TOKEN to enable it.",
    };
  }

  const openai = getOpenAI();

  const response = await openai.responses.create({
    model: getOpenAIModel(),
    input: [
      {
        role: "system",
        content:
          "You are a banking-telemetry analyst. Use the kibana_banking tools to discover " +
          "indices and run read-only Elasticsearch queries. Always call the discovery tool " +
          "before searching. Answer concisely with concrete numbers and cite the index used.",
      },
      { role: "user", content: question },
    ],
    tools: [
      {
        type: "mcp",
        server_label: "kibana_banking",
        server_description:
          "Read-only access to banking telemetry (SWIFT, SEPA, APM traces, logs) in Elasticsearch via Kibana.",
        server_url: config.url,
        headers: { Authorization: `Bearer ${config.token}` },
        allowed_tools: ALLOWED_TOOLS,
        require_approval: "never",
      },
    ],
  });

  const toolsUsed = extractMcpToolCalls(response);
  const text = response.output_text?.trim() || "";

  return {
    ok: true,
    text: text || "The query ran but produced no summary text.",
    toolsUsed,
  };
}

/**
 * Pull the names of MCP tool calls out of a Responses API result.
 *
 * The output array contains items of `type: "mcp_call"` with a `name` field when the
 * model invoked a remote tool. Kept defensive so SDK shape changes degrade gracefully.
 */
function extractMcpToolCalls(response: { output?: unknown }): string[] {
  const output = response.output;
  if (!Array.isArray(output)) return [];
  const names: string[] = [];
  for (const item of output) {
    if (
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "mcp_call" &&
      typeof (item as { name?: unknown }).name === "string"
    ) {
      names.push((item as { name: string }).name);
    }
  }
  return names;
}
