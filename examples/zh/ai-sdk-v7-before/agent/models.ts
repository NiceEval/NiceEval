// 模型注册表:示例支持 OpenAI 兼容的两家 provider。鉴权(key / base url)是 agent 的私事,
// 在这里读 env;【跑哪个模型】是实验的事,经 ctx.model 传进 adapter(见 experiments/)。
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type ProviderName = "openai" | "deepseek";

export interface ModelDef {
  id: string;
  provider: ProviderName;
  supportsVision: boolean;
}

export const MODELS: ModelDef[] = [
  { id: "deepseek-v4-flash", provider: "deepseek", supportsVision: false },
  { id: "deepseek-v4-pro",   provider: "deepseek", supportsVision: false },
  { id: "gpt-4o-mini",       provider: "openai",   supportsVision: true  },
  // gpt-5.4 本身支持视觉;但经当前 OPENAI_BASE_URL 网关传图会被拒
  // ("Expected a valid URL" —— 网关转 Responses API 时不认 data URL)。
  // 直连 OpenAI 或换支持图像输入的网关后,把它改回 true,image-understanding 就会真跑。
  { id: "gpt-5.4",           provider: "openai",   supportsVision: false },
];

export const DEFAULT_MODEL = "deepseek-v4-flash";

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
  return factories[def?.provider ?? "openai"](modelId);
}
