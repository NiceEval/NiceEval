// o11y 解析器入口:把各 agent 的原始 transcript 归一成 niceeval StreamEvent[]。
// 每个解析器都返回同一个 ParsedTranscript 形状。
//
// 这里没有「按 agent 名分派」的入口:解析器由 adapter 直连(shared.parseCodex /
// parseClaudeCode / parseBub),core 不按名字分支。接新 agent = 写新解析器 + adapter
// 里直接调,不改本文件的任何分派逻辑。

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
