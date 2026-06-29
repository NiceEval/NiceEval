// codex 的 span mapper:原生 OTLP span → canonical GenAI semconv。
//
// codex(Rust)的 OTLP 把内部 tracing 全导出来,span 名是 codex 自家约定(codex.exec /
// run_sampling_request / exec_command …),不是 GenAI semconv。这里编码 codex 的名字约定,
// 把它们归一到 gen_ai.operation.name + SpanKind;不认得的回落通用 heuristic。
// 理想态:codex 在 config.toml 里直接发 GenAI 语义 → 这个 mapper 就近乎透传(走 heuristic 的
// 「已带 gen_ai.operation.name → 信任」分支)。在那之前,由本文件兜。

import type { TraceSpan } from "../../../types.ts";
import { OP_CHAT, OP_EXECUTE_TOOL, heuristicTag, tagSpan, type SpanTag } from "../canonical.ts";

function codexTag(span: TraceSpan): SpanTag {
  const ln = span.name.toLowerCase();
  const a = span.attributes ?? {};

  // 工具执行:带 tool_name/call_id,或 codex 的执行/补丁/路由 span 名。
  if ("tool_name" in a) return { op: OP_EXECUTE_TOOL, kind: "tool" };
  if (/(^|[._])(exec_command|apply_patch|write_stdin|handle_tool_call|dispatch_tool_call)/.test(ln)) {
    return { op: OP_EXECUTE_TOOL, kind: "tool" };
  }

  // 模型调用:codex 的采样 / 流式 span,或到模型后端的 HTTP(wire_api / responses)。
  if ("wire_api" in a) return { op: OP_CHAT, kind: "model" };
  if (/(^|[._])(run_sampling_request|try_run_sampling_request|stream_responses|receiving_stream)(\b|_|$)/.test(ln)) {
    return { op: OP_CHAT, kind: "model" };
  }

  // 回合 / 会话骨架:codex.exec(一次 exec 调用)、run_turn、turn.id 属性。GenAI 无对应操作 → 只给 kind。
  if ("turn.id" in a || Object.keys(a).some((k) => k.startsWith("codex.turn"))) return { kind: "turn" };
  if (/^(codex\.exec|run_turn|session_loop)$/.test(ln) || /session_task\.turn/.test(ln)) return { kind: "turn" };

  // codex 没专门命名的(handle_responses / append_items 等内部噪声)交给通用兜底 → 多半落 "other"。
  return heuristicTag(span);
}

export function mapCodexSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans.map((s) => tagSpan(s, codexTag(s)));
}
