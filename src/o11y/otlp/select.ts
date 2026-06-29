// 从一坨 OTLP span 里挑「语义」span:agent 真正做的事(回合 / 模型调用 / 工具调用),
// 丢掉每-chunk / 每-item 的内部 instrument span 与建表/配置类 plumbing。
//
// 为什么要挑:像 codex 这种 Rust agent 的 OTLP 把内部 tracing 全导出来了 —— 一个 eval 上万条
// span(handle_responses/receiving/append_items…),直接落盘会把 summary.json 撑到几十 MB、
// view 渲染几万行。挑完只剩百来条有意义的,瀑布图才读得动。
//
// 判定已经是【纯通用】的了:span 早在本步之前经 mapper 归一到 canonical(每-agent mapper 给每条
// span 定了 SpanKind,见 otlp/mappers/),所以这里不再认任何 agent 的原生 span 名 —— 只看 kind:
// 留下 kind ≠ "other" 的(回合 / 模型 / 工具 / 子 agent),丢掉 "other"(plumbing / 每-chunk 噪声)。
// 兜底:某 agent 没 mapper、kind 全 "other" 时,回落到「按 span 名频率丢 firehose」。

import type { ToolCall, TraceSpan, JsonValue } from "../../types.ts";

/** 不大的 trace 整段保留(没有 firehose 要对付)。 */
const SMALL_TRACE = 150;
/** 单个 span 名在一次运行里出现这么多次,视为每-chunk/每-item 内部噪声(仅无-mapper 兜底路径用)。 */
const FIREHOSE_FREQ = 80;
/** 过滤后仍超这个数,再按耗时降序硬截断兜底。 */
const HARD_CAP = 1000;

/**
 * 选出要保留并落盘的 span。
 * 小 trace 原样返回;大 trace 按 canonical kind 过滤(kind ≠ "other" 留);
 * 没 mapper(kind 全 "other")则回落到 firehose 频率过滤;仍过多再按耗时硬截断。
 * 最后一律按起点排序,view 直接当瀑布图渲染。
 */
export function selectTraceSpans(spans: TraceSpan[]): TraceSpan[] {
  if (spans.length <= SMALL_TRACE) return spans.slice().sort((a, b) => a.startMs - b.startMs);

  // 主路径:按 canonical kind 留语义 span(agent 特定知识在 mapper 里,这里纯通用)。
  let kept = spans.filter((sp) => sp.kind && sp.kind !== "other");

  // 兜底:没 mapper / 全没识别(kind 全空或 "other")—— 退回按 span 名频率丢 firehose。
  if (kept.length === 0) {
    const freq: Record<string, number> = {};
    for (const sp of spans) freq[sp.name] = (freq[sp.name] ?? 0) + 1;
    kept = spans.filter((sp) => freq[sp.name] <= FIREHOSE_FREQ);
    if (kept.length === 0) kept = spans;
  }

  if (kept.length > HARD_CAP) {
    kept = kept
      .slice()
      .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, HARD_CAP);
  }
  return kept.sort((a, b) => a.startMs - b.startMs);
}

/** I/O 文本上限:文件内容/命令输出可能很大,截一下别把 trace 撑爆。 */
const IO_MAX = 4000;

function ioText(v: unknown): string {
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
  for (const tc of toolCalls) if (tc.callId) byCall.set(tc.callId, tc);
  if (byCall.size === 0) return spans;

  return spans.map((sp) => {
    const cid = sp.attributes?.call_id;
    const tc = typeof cid === "string" ? byCall.get(cid) : undefined;
    if (!tc) return sp;
    const attributes: Record<string, JsonValue> = { ...sp.attributes };
    if (tc.originalName) attributes["io.tool"] = tc.originalName;
    if (tc.input !== undefined && tc.input !== null) attributes["io.input"] = ioText(tc.input);
    if (tc.output !== undefined && tc.output !== null) attributes["io.output"] = ioText(tc.output);
    if (tc.status) attributes["io.status"] = tc.status;
    return { ...sp, attributes };
  });
}
