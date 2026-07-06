import OpenAI from "openai";
import { requireEnv } from "@/lib/env";

let client: OpenAI | null = null;

export function getOpenAI() {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }

  return client;
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}
