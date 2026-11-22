import type { ToolCall, TraceSpan, JsonValue } from "../../types.ts";

/**
 * I/O 文本上限:文件内容/命令输出可能很大,截一下别把 trace 撑爆。导出给
 * `execution-tree.ts` 复用——ExecutionTree 的 action 节点给合并上去的 span 补同一份
 * io.* attributes,必须和这里同一个截断预算,不能另立一个数字。
 */
export const IO_MAX = 4000;

export function ioText(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return "";
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
    if (tc.input !== undefined && tc.input !== null) attributes["io.input"] = ioText(tc.input);
    if (tc.output !== undefined && tc.output !== null) attributes["io.output"] = ioText(tc.output);
    if (tc.status) attributes["io.status"] = tc.status;
    return { ...sp, attributes };
  });
}
