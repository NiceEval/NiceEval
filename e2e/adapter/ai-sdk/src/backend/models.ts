// Model resolution shared by the HTTP server and in-process official Agent factory.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/** Default model for every Experiment in this repo unless overridden. */
export const DEFAULT_MODEL = "gpt-5.6-luna";

const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });

export function resolveModel(modelId: string): LanguageModel {
  return provider.chat(modelId);
}
