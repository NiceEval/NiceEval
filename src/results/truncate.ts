// 落盘大值截断(见 docs/feature/record/architecture.md「大值截断」)。
// 运行时全量,落盘截断:落点唯一在 snap.writeAttempt(writer.ts)——不在 adapter、不在 OTLP
// 解析、不在事件归一化里做。适用范围:events.json 的事件字段与 trace.json 的 span 属性里的
// 任意字符串值。没有 flag、没有配置项;截断永远不影响判决(落盘是证据,不是评分输入)。

import type { FailedCommandEvidence, StreamEvent, TraceSpan, Truncation } from "../types.ts";

/** 每个字符串值的落盘上限(UTF-8 字节)。 */
export const ARTIFACT_VALUE_MAX_BYTES = 256 * 1024;

const encoder = new TextEncoder();

/** 截断到 maxBytes(按 UTF-8 字符边界回退,不切断多字节字符),末尾追加人可读 marker。 */
function truncateString(value: string, originalBytes: number): string {
  // 按字节预算切:先按「字节数 ≥ 字符数」粗切,再逐步回退到不超预算的字符边界。
  let sliceLen = Math.min(value.length, ARTIFACT_VALUE_MAX_BYTES);
  let head = value.slice(0, sliceLen);
  while (encoder.encode(head).length > ARTIFACT_VALUE_MAX_BYTES && sliceLen > 0) {
    // 超出量 ÷ 4(UTF-8 最长 4 字节)是安全的最小回退步长;循环兜底处理边界。
    sliceLen -= Math.max(1, Math.ceil((encoder.encode(head).length - ARTIFACT_VALUE_MAX_BYTES) / 4));
    head = value.slice(0, sliceLen);
  }
  const kept = encoder.encode(head).length;
  return `${head}\n[niceeval] truncated ${originalBytes} → ${kept} bytes`;
}

/**
 * 深度遍历一个 JSON 值,截断其中超限的字符串;返回(可能新建的)值与收集到的截断记录。
 * `path` 用点分段(数组下标同样入段),事件里从字段名起、span 属性里从 attribute key 起。
 */
function truncateJsonValue(value: unknown, path: string, out: Truncation[]): unknown {
  if (typeof value === "string") {
    const bytes = encoder.encode(value).length;
    if (bytes <= ARTIFACT_VALUE_MAX_BYTES) return value;
    out.push({ path, originalBytes: bytes });
    return truncateString(value, bytes);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v, i) => {
      const r = truncateJsonValue(v, `${path}.${i}`, out);
      if (r !== v) changed = true;
      return r;
    });
    return changed ? next : value;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = truncateJsonValue(v, path ? `${path}.${k}` : k, out);
      if (r !== v) changed = true;
      next[k] = r;
    }
    return changed ? next : value;
  }
  return value;
}

/** events.json 落盘前的截断:逐事件处理全部字符串字段,超限的加结构化 `truncated` 标记。 */
export function truncateEvents(events: readonly StreamEvent[]): StreamEvent[] {
  return events.map((event) => {
    const out: Truncation[] = [];
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(event)) {
      if (k === "type" || k === "truncated") {
        next[k] = v;
        continue;
      }
      const r = truncateJsonValue(v, k, out);
      if (r !== v) changed = true;
      next[k] = r;
    }
    if (!changed) return event;
    return { ...next, truncated: [...(event.truncated ?? []), ...out] } as StreamEvent;
  });
}

/** trace.json 落盘前的截断:span 属性里的任意字符串值(name 一并覆盖——可携带动态内容)。 */
export function truncateSpans(spans: readonly TraceSpan[]): TraceSpan[] {
  return spans.map((span) => {
    const out: Truncation[] = [];
    const attributes = span.attributes
      ? (truncateJsonValue(span.attributes, "", out) as TraceSpan["attributes"])
      : span.attributes;
    if (out.length === 0) return span;
    return { ...span, attributes, truncated: [...(span.truncated ?? []), ...out] };
  });
}

/** commands.json 落盘前的截断:每条证据的 stdout / stderr 逐值截断,`truncated[].path` 固定
 *  是 "stdout" 或 "stderr"(见 docs/feature/record/architecture.md「commandsjson」）。 */
export function truncateCommands(commands: readonly FailedCommandEvidence[]): FailedCommandEvidence[] {
  return commands.map((cmd) => {
    const out: Truncation[] = [];
    const stdout = truncateJsonValue(cmd.stdout, "stdout", out) as string;
    const stderr = truncateJsonValue(cmd.stderr, "stderr", out) as string;
    if (out.length === 0) return cmd;
    return { ...cmd, stdout, stderr, truncated: [...(cmd.truncated ?? []), ...out] };
  });
}
