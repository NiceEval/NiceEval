// bub 的 span mapper:原生 OTLP span → canonical GenAI semconv。
//
// bub-tapestore-otel 插件把 tape 装饰成 span,名字本就接近 GenAI semconv
// (invoke_agent / agent.step / chat / execute_tool,见 agents/bub.ts 注释),
// 所以这个 mapper 近乎透传 —— 只把 bub 自己的 agent.step(回合步)归到 "turn",
// 其余直接按名映到标准操作;不认得的回落通用 heuristic。

import type { TraceSpan } from "../../../types.ts";
import { OP_CHAT, OP_CREATE_AGENT, OP_EXECUTE_TOOL, OP_INVOKE_AGENT, heuristicTag, tagSpan, type SpanTag } from "../canonical.ts";

function bubTag(span: TraceSpan): SpanTag {
  switch (span.name.toLowerCase()) {
    case "execute_tool":
      return { op: OP_EXECUTE_TOOL, kind: "tool" };
    case "chat":
      return { op: OP_CHAT, kind: "model" };
    case "invoke_agent":
      return { op: OP_INVOKE_AGENT, kind: "agent" };
    case "create_agent":
      return { op: OP_CREATE_AGENT, kind: "agent" };
    case "agent.step": // bub 的回合步:GenAI 无对应操作 → 只给 kind。
      return { kind: "turn" };
    default:
      return heuristicTag(span);
  }
}

export function mapBubSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans.map((s) => tagSpan(s, bubTag(s)));
}
