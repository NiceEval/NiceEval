// OpenClaw transcript / `agent --json` 解析器。OpenClaw 方言只住这里,不进 core
// (契约见 docs/feature/adapters/sdk/openclaw/README.md:字段事实以真实 CLI 与 transcript
// fixture 固定为准;fixture 未证明的形状这里只做防御式解析,认不出的行标 parseSuccess=false,
// 绝不从最终文本猜测工具轨迹)。
//
// 行为轨两个来源(collection.md 的通道优先级):
//   1. session transcript JSONL(~/.openclaw/agents/**/sessions/*.jsonl,pi-agent 系
//      消息格式:role/content parts,toolCall/toolResult 按 call ID 配对)→ parseOpenClawTranscript;
//   2. `openclaw agent --json` 的 stdout 结果封包(最终回复、session key、失败与 usage 摘要,
//      无完整工具轨迹)→ parseOpenClawRunJson,只在 transcript 拿不到时兜底。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";

/**
 * OpenClaw 特有工具别名(CLI 自己的 transcript 词汇,不会撞用户域名,裸动词可 opt-in)
 * + 通用裸动词基表。
 */
export const OPENCLAW_TOOL_ALIASES: Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  read: "file_read",
  write: "file_write",
  edit: "file_edit",
  process: "shell",
  browser: "web_fetch",
};

function normalizeToolName(name: string): ToolName {
  return normalizeShared(name, OPENCLAW_TOOL_ALIASES);
}

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function num(obj: unknown, ...keys: string[]): number {
  for (const k of keys) {
    const v = get(obj, k);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function coerceArgs(value: unknown): JsonValue {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return value;
    }
  }
  return (value ?? {}) as JsonValue;
}

/** content parts / 字符串 → 纯文本(text 类 part 拼接)。 */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (typeof b === "string") parts.push(b);
      else {
        const t = get(b, "text") ?? get(b, "content");
        if (typeof t === "string" && t) parts.push(t);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/**
 * OpenClaw session transcript(JSONL,pi-agent 系消息格式)→ 标准事件流 + 用量 + 压缩计数。
 * assistant 消息的 text / thinking / toolCall parts → message / thinking / action.called,
 * toolResult 消息按 toolCallId 配对成 action.result(isError → failed),消息级 usage 逐条
 * 累加,compaction 条目计入压缩次数。认不出 / 解析失败的行标 `parseSuccess: false` 并跳过,
 * 不猜测——transcript 不完整时负断言不可信(契约见 sdk/openclaw/README.md)。
 */
export function parseOpenClawTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUSD = 0;
  let requests = 0;
  let compactions = 0;
  let parseSuccess = true;

  if (!raw || !raw.trim()) {
    return { events, usage: { inputTokens: 0, outputTokens: 0 }, compactions: 0, parseSuccess: true };
  }

  let synth = 0;
  const nextSynthId = (): string => `oc_${++synth}`;

  const addUsage = (usage: unknown): void => {
    if (!usage || typeof usage !== "object") return;
    // pi 系简写(input/output/cacheRead/cacheWrite/cost.total)与 snake_case 变体都认。
    const input = num(usage, "input", "input_tokens", "inputTokens", "prompt_tokens");
    const output = num(usage, "output", "output_tokens", "outputTokens", "completion_tokens");
    const cacheRead = num(usage, "cacheRead", "cache_read_input_tokens", "cacheReadTokens");
    const cacheWrite = num(usage, "cacheWrite", "cache_creation_input_tokens", "cacheWriteTokens");
    const cost = num(usage, "cost") || num(get(usage, "cost"), "total");
    if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && cost === 0) return;
    inputTokens += input;
    outputTokens += output;
    cacheReadTokens += cacheRead;
    cacheWriteTokens += cacheWrite;
    costUSD += cost;
    requests += 1;
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      parseSuccess = false;
      continue;
    }

    try {
      // 会话条目可能带 { type: "message", message: {...} } 包装,也可能就是消息本体。
      const wrappedMessage = get(entry, "message");
      const entryType = get(entry, "type");
      const msg =
        wrappedMessage && typeof wrappedMessage === "object" ? wrappedMessage : entry;
      const role = get(msg, "role");

      if (entryType === "compaction" || entryType === "compact" || get(entry, "kind") === "compaction") {
        compactions += 1;
        events.push({ type: "compaction", reason: str(get(entry, "reason")) });
        continue;
      }
      if (entryType === "error" && role === undefined) {
        events.push({ type: "error", message: String(get(entry, "message") ?? get(entry, "error") ?? "error") });
        continue;
      }

      if (role === "assistant") {
        addUsage(get(msg, "usage"));
        const content = get(msg, "content");
        if (typeof content === "string") {
          if (content) events.push({ type: "message", role: "assistant", text: content });
          continue;
        }
        if (!Array.isArray(content)) continue;
        for (const part of content) {
          const partType = get(part, "type");
          if (partType === "text") {
            const text = str(get(part, "text"));
            if (text) events.push({ type: "message", role: "assistant", text });
          } else if (partType === "thinking" || partType === "reasoning") {
            const text = str(get(part, "thinking")) ?? str(get(part, "reasoning")) ?? str(get(part, "text"));
            if (text) events.push({ type: "thinking", text });
          } else if (partType === "toolCall" || partType === "tool_call" || partType === "tool-call" || partType === "toolUse") {
            const name = String(get(part, "name") ?? get(part, "toolName") ?? "unknown");
            const callId = str(get(part, "id")) ?? str(get(part, "toolCallId")) ?? str(get(part, "tool_call_id")) ?? nextSynthId();
            events.push({
              type: "action.called",
              callId,
              name,
              input: coerceArgs(get(part, "arguments") ?? get(part, "args") ?? get(part, "input")),
              tool: normalizeToolName(name),
            });
          }
        }
        continue;
      }

      if (role === "user") {
        const text = extractText(get(msg, "content") ?? get(msg, "text"));
        if (text) events.push({ type: "message", role: "user", text });
        continue;
      }

      if (role === "toolResult" || role === "tool") {
        const callId =
          str(get(msg, "toolCallId")) ?? str(get(msg, "tool_call_id")) ?? str(get(msg, "id")) ?? nextSynthId();
        const isError = get(msg, "isError") === true || get(msg, "is_error") === true;
        const output = get(msg, "output") ?? get(msg, "result") ?? get(msg, "content");
        events.push({
          type: "action.result",
          callId,
          output: (typeof output === "string" ? output : (extractText(output) || output)) as JsonValue,
          status: isError ? "failed" : "completed",
        });
        continue;
      }
      // 其它条目(system prompt、订阅元数据等):无对应 StreamEvent。
    } catch {
      parseSuccess = false;
    }
  }

  const usage: Usage = { inputTokens, outputTokens };
  if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens > 0) usage.cacheWriteTokens = cacheWriteTokens;
  if (requests > 0) usage.requests = requests;
  if (costUSD > 0) usage.costUSD = costUSD;

  return { events, usage, compactions, parseSuccess };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseOpenClaw(raw: string | undefined): StreamEvent[] {
  return parseOpenClawTranscript(raw).events;
}

/** `openclaw agent --json` 结果封包里抠出的摘要(无完整工具轨迹,只兜底)。 */
export interface OpenClawRunJson {
  /** 最终回复文本(result.text / payloads[].text / reply 变体)。 */
  text?: string;
  /** 本次 run 的 session key(首轮 capture、后续 resume 用)。 */
  sessionId?: string;
  /** 封包报告的用量;没报就省略,不编造。 */
  usage?: Usage;
  /** 封包自报失败(error 字段 / status=error|failed / success=false)。 */
  failed: boolean;
}

/**
 * `openclaw agent --json` 的 stdout → 结果摘要。整段 stdout 先按单个 JSON 文档解析
 * (含 pretty-print 多行),失败再逐行扫最后一个 JSON 对象(混了日志行的场景)。
 * 完全解析不出时返回空摘要(`failed: false`)——失败判定交给调用方的 exitCode。
 */
export function parseOpenClawRunJson(stdout: string | undefined): OpenClawRunJson {
  const doc = parseJsonDocument(stdout);
  if (!doc) return { failed: false };

  const result = get(doc, "result");
  const textFromPayloads = (payloads: unknown): string | undefined => {
    if (!Array.isArray(payloads)) return undefined;
    const texts = payloads.map((p) => str(get(p, "text"))).filter((t): t is string => !!t);
    return texts.length ? texts.join("\n") : undefined;
  };
  const text =
    str(get(result, "text")) ??
    textFromPayloads(get(result, "payloads")) ??
    textFromPayloads(get(doc, "payloads")) ??
    str(get(doc, "text")) ??
    str(get(doc, "reply")) ??
    str(get(doc, "message"));

  const sessionId =
    str(get(doc, "sessionId")) ??
    str(get(doc, "session_id")) ??
    str(get(doc, "sessionKey")) ??
    str(get(result, "sessionId")) ??
    str(get(result, "session_id"));

  const rawUsage = get(doc, "usage") ?? get(result, "usage") ?? get(get(doc, "meta"), "usage");
  let usage: Usage | undefined;
  if (rawUsage && typeof rawUsage === "object") {
    const input = num(rawUsage, "input", "input_tokens", "inputTokens", "prompt_tokens");
    const output = num(rawUsage, "output", "output_tokens", "outputTokens", "completion_tokens");
    if (input > 0 || output > 0) {
      usage = { inputTokens: input, outputTokens: output };
      const cacheRead = num(rawUsage, "cacheRead", "cache_read_input_tokens", "cacheReadTokens");
      if (cacheRead > 0) usage.cacheReadTokens = cacheRead;
      const cost = num(rawUsage, "cost") || num(get(rawUsage, "cost"), "total");
      if (cost > 0) usage.costUSD = cost;
    }
  }

  const status = get(doc, "status");
  const failed =
    get(doc, "error") != null ||
    get(doc, "success") === false ||
    (typeof status === "string" && /^(error|failed)$/i.test(status));

  return {
    ...(text !== undefined ? { text } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(usage !== undefined ? { usage } : {}),
    failed,
  };
}

function parseJsonDocument(stdout: string | undefined): Record<string, unknown> | undefined {
  if (!stdout || !stdout.trim()) return undefined;
  const trimmed = stdout.trim();
  try {
    const doc = JSON.parse(trimmed) as unknown;
    if (doc && typeof doc === "object" && !Array.isArray(doc)) return doc as Record<string, unknown>;
  } catch {
    // 混日志行:逐行找最后一个完整 JSON 对象
  }
  const lines = trimmed.split("\n").reverse();
  for (const line of lines) {
    const l = line.trim();
    if (!l.startsWith("{") || !l.endsWith("}")) continue;
    try {
      const doc = JSON.parse(l) as unknown;
      if (doc && typeof doc === "object") return doc as Record<string, unknown>;
    } catch {
      // 继续往上找
    }
  }
  return undefined;
}
