// bub 的 span mapper:原生 OTLP span → canonical GenAI semconv。
//
// Bub and its tape store plugin use GenAI span names with optional subjects.
// The plugin's bub.agent.step groups the work of one model loop step.

import type { TraceSpan } from "../../../types.ts";
import {
  OP_CHAT,
  OP_CREATE_AGENT,
  OP_EXECUTE_TOOL,
  OP_INVOKE_AGENT,
  heuristicTag,
  tagSpan,
  type SpanTag,
} from "../canonical.ts";

function bubTag(span: TraceSpan): SpanTag {
  switch (span.name.split(" ", 1)[0]?.toLowerCase()) {
    case "execute_tool":
      return { op: OP_EXECUTE_TOOL, kind: "tool" };
    case "chat":
      return { op: OP_CHAT, kind: "model" };
    case "invoke_agent":
      return { op: OP_INVOKE_AGENT, kind: "agent" };
    case "create_agent":
      return { op: OP_CREATE_AGENT, kind: "agent" };
    case "bub.agent.step":
      return { kind: "turn" };
    default:
      return heuristicTag(span);
  }
}

export function mapBubSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans.map((s) => tagSpan(s, bubTag(s)));
}
