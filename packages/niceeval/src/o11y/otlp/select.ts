import type { ToolCall, TraceSpan, JsonValue } from "../../types.ts";

const IO_MAX = 4000;

function fullIoText(value: unknown): string {
  return (typeof value === "string" ? value : JSON.stringify(value)) ?? "";
}

/** Bounded I/O preview for the ExecutionTree projection. */
export function ioText(v: unknown): string {
  const s = fullIoText(v);
  return s.length > IO_MAX ? s.slice(0, IO_MAX) + `…(+${s.length - IO_MAX})` : s;
}

/**
 * 给工具执行 span 补上真实「入参/出参」:codex 等的 OTLP span 只带 tool_name/call_id,
 * 命令文本与输出在 stdout transcript(events)里 —— 按 call_id 把 deriveRunFacts 的
 * ToolCall.input/output join 到对应 span 的 attributes(io.input / io.output / io.tool)。
 * 没匹配上的 span 原样返回。
 */
export function enrichTraceWithIO(spans: TraceSpan[], toolCalls: readonly ToolCall[]): TraceSpan[] {
  const byCall = new Map<string, ToolCall>();
  for (const tc of toolCalls) byCall.set(tc.operationId, tc);
  if (byCall.size === 0) return spans;

  return spans.map((sp) => {
    const cid = sp.attributes?.call_id;
    const tc = typeof cid === "string" ? byCall.get(cid) : undefined;
    if (!tc) return sp;
    const attributes: globalThis.Record<string, JsonValue> = { ...sp.attributes };
    if (tc.originalName) attributes["io.tool"] = tc.originalName;
    if (tc.input !== undefined && tc.input !== null) attributes["io.input"] = fullIoText(tc.input);
    if (tc.output !== undefined && tc.output !== null) attributes["io.output"] = fullIoText(tc.output);
    if (tc.status) attributes["io.status"] = tc.status;
    return { ...sp, attributes };
  });
}
