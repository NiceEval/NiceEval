// Model resolution shared by all three entry points (HTTP server, in-process agent,
// zero-mapping agent) so the underlying provider wiring only lives in one place.
//
// "deepseek-v4-flash" is the same alias other e2e repos use against DEEPSEEK_BASE_URL
// (a proxy gateway, not the public DeepSeek API) — reusing it keeps this repo's cost
// profile consistent with its siblings instead of inventing a new model id.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type ProviderName = "openai" | "deepseek";

/** Default model for every Experiment in this repo unless overridden. */
export const DEFAULT_MODEL = "deepseek-v4-flash";

function providerFor(modelId: string): ProviderName {
  return modelId.startsWith("gpt-") || modelId.startsWith("openai/") ? "openai" : "deepseek";
}

type ModelFactory = (modelId: string) => LanguageModel;

const factories: Record<ProviderName, ModelFactory> = {
  openai: (() => {
    const p = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });
    return (id) => p.chat(id);
  })(),
  deepseek: (() => {
    const p = createOpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL });
    return (id) => p.chat(id);
  })(),
};

export function resolveModel(modelId: string): LanguageModel {
  return factories[providerFor(modelId)](modelId);
}
