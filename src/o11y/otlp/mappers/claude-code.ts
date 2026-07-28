// claude-code 的 span mapper:原生 OTLP span(beta 遥测)→ canonical GenAI semconv。
//
// claude CLI 的 span 自带标准 gen_ai.operation.name(llm_request → chat、tool →
// execute_tool),通用 heuristic 直接信任 —— 这里只编码 heuristic 做不到的两件事:
//   1. claude_code.interaction(每个 user prompt 的根 span)归 "turn":它没有对应的
//      GenAI 操作,不标注会在大 trace 过滤时被当噪声丢掉,瀑布图失去回合层;
//   2. tool span 的 tool_use_id 复制成 call_id —— transcript 事件流的 callId 就是
//      tool_use id,enrichTraceWithIO 按 call_id 才 join 得上工具入参/出参。

import type { JsonValue, TraceSpan } from "../../../types.ts";
import { heuristicTag, tagSpan } from "../canonical.ts";

export function mapClaudeCodeSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans.map((s) => {
    const tagged =
      s.name === "claude_code.interaction" ? tagSpan(s, { kind: "turn" }) : tagSpan(s, heuristicTag(s));
    const tuid = tagged.attributes?.["tool_use_id"];
    if (typeof tuid === "string" && tagged.attributes?.["call_id"] === undefined) {
      const attributes: globalThis.Record<string, JsonValue> = { ...tagged.attributes, call_id: tuid };
      return { ...tagged, attributes };
    }
    return tagged;
  });
}
