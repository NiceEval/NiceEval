import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type ProviderName = "openai" | "deepseek";

interface ProviderDef {
  apiKeyEnv: string;
  baseUrlEnv?: string;
  defaultBaseUrl: string;
}

const PROVIDERS: Record<ProviderName, ProviderDef> = {
  openai: {
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  deepseek: {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com",
  },
};

export interface ModelDef {
  id: string;
  label: string;
  provider: ProviderName;
  contextTokens: number;
  supportsVision?: boolean;
}

export const MODELS: ModelDef[] = [
  { id: "deepseek-v4-flash", label: "DeepSeek v4 Flash",  provider: "deepseek", contextTokens: 128_000, supportsVision: false },
  { id: "deepseek-v4-pro",   label: "DeepSeek v4 Pro",    provider: "deepseek", contextTokens: 200_000, supportsVision: false },
  { id: "gpt-4o-mini",       label: "GPT-4o Mini",        provider: "openai",   contextTokens: 128_000, supportsVision: true  },
  { id: "gpt-5.4",           label: "GPT-5.4",            provider: "openai",   contextTokens: 400_000, supportsVision: true  },
];

export function modelSupportsVision(modelId: string): boolean {
  return MODELS.find((m) => m.id === modelId)?.supportsVision ?? true;
}

type ModelFactory = (modelId: string) => LanguageModel;

const factories: Record<ProviderName, ModelFactory> = {
  openai: (() => {
    const p = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
    return (id) => p.chat(id);
  })(),
  deepseek: (() => {
    const p = createOpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    });
    return (id) => p.chat(id);
  })(),
};

export function resolveModel(modelId: string): LanguageModel {
  const def = MODELS.find((m) => m.id === modelId);
  const provider: ProviderName = def?.provider ?? "openai";
  return factories[provider](modelId);
}
