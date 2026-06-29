// Canonical trace schema = OpenTelemetry GenAI 语义约定。
//
// 「定义我们的 OTel」不是发明 fasteval 私有 schema —— 我们控制不了 agent 的 instrumentation,
// 造私有约定也强迫不了 codex(Rust)/ claude 原生发它。所以 canonical 目标就是 OTel 官方的
// GenAI semconv(https://opentelemetry.io/docs/specs/semconv/gen-ai/):一个公认标准,
// codex 已部分遵循、bub 插件可配置直接发。
//
// 核心是 gen_ai.operation.name 把 span 分成几类语义角色(SpanKind),view/select 只认 SpanKind、
// 不读原生 span 名 —— 于是不同 agent 的瀑布图天然对齐、可叠加对比。每个 agent 一个薄 mapper
// (otlp/mappers/<agent>.ts)把原生 span 归一到这套;本文件提供它们共用的常量 / 助手 / 通用兜底。

import type { JsonValue, SpanKind, TraceSpan } from "../../types.ts";

// ───────────────────────── GenAI semconv 键 / 操作名 ─────────────────────────

/** gen_ai.operation.name —— canonical 的核心:span 干的是哪类活。 */
export const GENAI_OP = "gen_ai.operation.name";

export const OP_CHAT = "chat";
export const OP_TEXT_COMPLETION = "text_completion";
export const OP_EMBEDDINGS = "embeddings";
export const OP_EXECUTE_TOOL = "execute_tool";
export const OP_INVOKE_AGENT = "invoke_agent";
export const OP_CREATE_AGENT = "create_agent";

/** gen_ai.operation.name → fasteval SpanKind(view 着色 / 分组的唯一依据)。 */
export function kindFromOperation(op: string | undefined): SpanKind {
  switch (op) {
    case OP_CHAT:
    case OP_TEXT_COMPLETION:
    case OP_EMBEDDINGS:
      return "model";
    case OP_EXECUTE_TOOL:
      return "tool";
    case OP_INVOKE_AGENT:
    case OP_CREATE_AGENT:
      return "agent";
    default:
      return "other";
  }
}

// ───────────────────────── 给 span 打 canonical 标 ─────────────────────────

/** mapper 每条 span 归一后的判定:认出的标准操作(可空)+ 语义角色。 */
export interface SpanTag {
  /** 标准 GenAI 操作名;turn 骨架这类 GenAI 没对应操作的留空,只给 kind。 */
  op?: string;
  /** 语义角色。给了 op 时一般 = kindFromOperation(op);turn 骨架直接给 "turn"。 */
  kind: SpanKind;
}

/**
 * 把判定写回 span:有标准 op 时写入 gen_ai.operation.name(供下游如 extractUsageFromSpans 用),
 * 并定 kind。**raw name / 既有 attributes 一律保留**,只增不改,供 view 下钻。
 */
export function tagSpan(span: TraceSpan, tag: SpanTag): TraceSpan {
  if (!tag.op) return { ...span, kind: tag.kind };
  const attributes: Record<string, JsonValue> = { ...span.attributes, [GENAI_OP]: tag.op };
  return { ...span, kind: tag.kind, attributes };
}

// ───────────────────────── 通用兜底 mapper(heuristic) ─────────────────────────
//
// 给【没有专属 mapper 的 agent】兜底:按 GenAI 语义信号 + 常见动词名猜操作。
// 有专属 mapper 的(codex/bub)在自己文件里编码本 agent 的名字约定,只在不认得时回落到这里。

/**
 * 按通用信号判定一条 span 的 canonical 角色:
 *   · 已带 gen_ai.operation.name —— 直接信任(上游已按标准发);
 *   · 工具执行 —— 带 tool_name 属性,或名字是执行/路由动词;
 *   · 模型调用 —— 带 gen_ai.* / 到模型的 HTTP / 采样·流式名;
 *   · 回合·会话骨架 —— turn.id 属性,或回合/会话动词名;
 *   · 都不沾 —— "other"(view 折叠)。
 */
export function heuristicTag(span: TraceSpan): SpanTag {
  const ln = span.name.toLowerCase();
  const a = span.attributes ?? {};
  const keys = Object.keys(a);

  // 上游已按 GenAI 标准发了操作名 —— 直接信任。
  const existing = a[GENAI_OP];
  if (typeof existing === "string") return { op: existing, kind: kindFromOperation(existing) };

  // 工具执行。
  if ("tool_name" in a) return { op: OP_EXECUTE_TOOL, kind: "tool" };
  if (/(^|[._])(exec_command|apply_patch|write_stdin|execute_tool|run_command|handle_tool_call|dispatch_tool_call)/.test(ln)) {
    return { op: OP_EXECUTE_TOOL, kind: "tool" };
  }

  // 模型调用。
  if (keys.some((k) => k.startsWith("gen_ai.request") || k.startsWith("gen_ai.response"))) return { op: OP_CHAT, kind: "model" };
  if ("wire_api" in a || ("http.method" in a && "api.path" in a)) return { op: OP_CHAT, kind: "model" };
  if (/(^|[._])(run_sampling_request|try_run_sampling_request|stream_responses|receiving_stream|model_client|chat|completion)(\b|_|$)/.test(ln)) {
    return { op: OP_CHAT, kind: "model" };
  }

  // 子 agent 调用。
  if (/(^|[._])create_agent(\b|_|$)/.test(ln)) return { op: OP_CREATE_AGENT, kind: "agent" };
  if (/(^|[._])invoke_agent(\b|_|$)/.test(ln)) return { op: OP_INVOKE_AGENT, kind: "agent" };

  // 回合 / 会话骨架(GenAI 无对应操作 → 只给 kind)。
  if ("turn.id" in a || keys.some((k) => k.startsWith("codex.turn"))) return { kind: "turn" };
  if (/^(codex\.exec|session_loop|run_turn)$/.test(ln) || /session_task\.turn|agent\.step/.test(ln)) return { kind: "turn" };

  return { kind: "other" };
}

/** 通用 mapper:逐 span 套 heuristicTag。无专属 mapper 的 agent 走它。 */
export function mapGenericSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans.map((s) => tagSpan(s, heuristicTag(s)));
}
