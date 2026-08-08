// Model resolution shared by the HTTP server and the official Agent factory experiment.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/** 本 Repo 实验的默认模型（e2e.json.secrets 注入的凭据走 @ai-sdk/openai）。 */
export const DEFAULT_MODEL = "gpt-5.6-luna";

const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });

export function resolveModel(modelId: string): LanguageModel {
  return provider.chat(modelId);
}
