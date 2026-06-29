// span mapper 入口:把各 agent 的原生 OTLP span 归一到 canonical GenAI semconv。
// 和 transcript 解析器(o11y/parsers/index.ts)同一个分派模式 —— 按 agent 名包含匹配,
// 认不出来走通用 heuristic 兜底。每个 mapper 是纯函数(不碰沙箱),住 core o11y、可独立单测。
//
// 职责边界:本文件只管「发回来的 span 怎么读」;「沙箱里怎么让 agent 把 OTLP 发出来」
//(写 config.toml / 注入 OTEL_* env)是 adapter 侧的导出配置,与此分开。

import type { TraceSpan } from "../../../types.ts";
import { mapGenericSpans } from "../canonical.ts";
import { mapCodexSpans } from "./codex.ts";
import { mapBubSpans } from "./bub.ts";

export { mapCodexSpans, mapBubSpans };

/**
 * 按 agent 名分派到对应 span mapper;认不出来的走通用 heuristic 兜底。
 * agent 名做包含匹配,兼容 "vercel-ai-gateway/codex" 之类变体(同 parseTranscript)。
 */
export function mapSpansToCanonical(spans: TraceSpan[], agent: string): TraceSpan[] {
  const a = (agent || "").toLowerCase();
  if (a.includes("codex")) return mapCodexSpans(spans);
  if (a.includes("bub")) return mapBubSpans(spans);
  // claude-code 不发 OTLP(无 span 到这);其余未知 agent 走通用兜底。
  return mapGenericSpans(spans);
}
