// o11y 解析器入口:把各 agent 的原始 transcript 归一成 fastevals StreamEvent[]。
// 每个解析器都返回同一个 ParsedTranscript 形状,parseTranscript 按 agent 名分派。

import type { StreamEvent, Usage } from "../../types.ts";
import { parseCodexTranscript, parseCodex } from "./codex.ts";
import { parseClaudeCodeTranscript, parseClaudeCode } from "./claude-code.ts";
import { parseBubTranscript, parseBub } from "./bub.ts";

/** 解析结果:事件流为核心,外加 usage / 压缩次数 / 是否全程解析成功。 */
export interface ParsedTranscript {
  events: StreamEvent[];
  usage: Usage;
  compactions: number;
  parseSuccess: boolean;
}

export {
  parseCodexTranscript,
  parseCodex,
  parseClaudeCodeTranscript,
  parseClaudeCode,
  parseBubTranscript,
  parseBub,
};

/**
 * 按 agent 名分派到对应解析器;认不出来的走通用(bub)兜底。
 * agent 名做包含匹配,兼容 "vercel-ai-gateway/codex"、"claude-code-1m" 之类的变体。
 */
export function parseTranscript(raw: string | undefined, agent: string): ParsedTranscript {
  const a = (agent || "").toLowerCase();
  if (a.includes("codex")) return parseCodexTranscript(raw);
  if (a.includes("claude")) return parseClaudeCodeTranscript(raw);
  if (a.includes("bub")) return parseBubTranscript(raw);
  // 默认:通用 JSONL 兜底解析器。
  return parseBubTranscript(raw);
}
