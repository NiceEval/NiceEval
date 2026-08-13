// OpenAI 两种响应形状(Chat Completions / Responses)的官方转换器 —— 写 send 指南「零映射」
// 表格里的 turnFromChatCompletion(res) / turnFromResponses(res)。和 turnFromAiSdk 同一先例:结构化
// *Like 类型,不依赖 openai 包,兼容任何声明自己走这两种协议形状的服务(不止 OpenAI 官方)。
//
// 两种形状对负断言的可信度不同:Chat Completions 可能只给最终消息，Responses.output
// 则完整列出本轮 function_call。下列六通道 EvidenceCoverage 常量把差异交给 core 的
// 三值逻辑；转换器在单轮缺 usage 时再据实降级该通道。

import type { EvidenceCoverage, JsonValue, StreamEvent, Turn, Usage } from "../types.ts";
import { unclassifiedToolActionsCoverage } from "../o11y/command-projection.ts";

const COMPLETE = Object.freeze({ status: "complete" as const });
const NO_DATA = Object.freeze({ status: "unavailable" as const, reason: "OpenAI response conversion does not populate Turn.data." });

export const chatCompletionEvidenceCoverage: EvidenceCoverage = Object.freeze({
  events: Object.freeze({
    status: "partial",
    reason: "Chat Completions may expose only the final response, not a server-side tool loop.",
  }),
  actions: Object.freeze({
    status: "partial",
    reason: "Chat Completions cannot prove that no hidden server-side tool action occurred.",
  }),
  messages: COMPLETE,
  usage: COMPLETE,
  status: COMPLETE,
  data: NO_DATA,
});

export const responsesEvidenceCoverage: EvidenceCoverage = Object.freeze({
  events: Object.freeze({
    status: "partial",
    reason: "Unknown Responses output item types are intentionally skipped by the protocol-neutral converter.",
  }),
  actions: Object.freeze({
    status: "partial",
    reason: "Unknown Responses output item types are intentionally skipped by the protocol-neutral converter.",
  }),
  messages: COMPLETE,
  usage: COMPLETE,
  status: COMPLETE,
  data: NO_DATA,
});

function turnCoverage(events: readonly StreamEvent[], usage: Usage | undefined): Turn["evidenceCoverage"] {
  const actionCoverage = unclassifiedToolActionsCoverage(events);
  if (usage) return actionCoverage;
  return {
    ...actionCoverage,
    usage: { status: "unavailable", reason: "This response did not include protocol usage." },
  };
}

/** function tool `arguments` 是 JSON 字符串;解析失败时原样保留,不吞输入。 */
function parseArgs(raw: string | undefined): JsonValue {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

// ───────────────────────── Chat Completions ─────────────────────────

export interface ChatCompletionFunctionToolCallLike {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCompletionCustomToolCallLike {
  id: string;
  type: "custom";
  custom: { name: string; input: string };
}

/** Extensible fallback; unknown future tool-call variants are ignored. */
export interface ChatCompletionUnknownToolCallLike {
  id?: string;
  type: string;
}

export type ChatCompletionToolCallLike =
  | ChatCompletionFunctionToolCallLike
  | ChatCompletionCustomToolCallLike
  | ChatCompletionUnknownToolCallLike;

export interface ChatCompletionMessageLike {
  role?: string;
  content?: string | null;
  tool_calls?: readonly ChatCompletionToolCallLike[];
}

export interface ChatCompletionUsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  /** 推理模型(o-series 等)经 Chat Completions 端点也会带回这项,拆自 completion_tokens。 */
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface ChatCompletionLike {
  choices: { message: ChatCompletionMessageLike }[];
  usage?: ChatCompletionUsageLike;
}

function chatCompletionUsage(usage: ChatCompletionUsageLike | undefined): Usage | undefined {
  if (!usage) return undefined;
  // prompt_tokens 含缓存命中,cached_tokens 是其子集;落互斥桶前扣掉
  // (docs/feature/adapters/sdk/openai-compat/cost.md)
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const u: Usage = {
    inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    outputTokens: usage.completion_tokens ?? 0,
  };
  if (cached) u.cacheReadTokens = cached;
  if (usage.completion_tokens_details?.reasoning_tokens) u.reasoningTokens = usage.completion_tokens_details.reasoning_tokens;
  return u;
}

/**
 * Chat Completions 形状的响应 → `Turn`。零映射:`res.choices[0].message` 的
 * `tool_calls` / `content` 直接变成 `operation.started` / `message`,`usage` 顺手带上。
 */
export function turnFromChatCompletion(res: ChatCompletionLike): Turn {
  const message = res.choices[0]?.message;
  const events: StreamEvent[] = [];
  for (const call of message?.tool_calls ?? []) {
    if (call.type === "function" && "function" in call) {
      events.push({
        type: "operation.started",
        operationId: call.id,
        operation: { kind: "tool", name: call.function.name, input: parseArgs(call.function.arguments) },
      });
    } else if (call.type === "custom" && "custom" in call) {
      events.push({
        type: "operation.started",
        operationId: call.id,
        operation: { kind: "tool", name: call.custom.name, input: call.custom.input },
      });
    }
  }
  if (message?.content) events.push({ type: "message", role: "assistant", text: message.content });
  const usage = chatCompletionUsage(res.usage);
  const evidenceCoverage = turnCoverage(events, usage);
  return { events, status: "completed", usage, ...(evidenceCoverage === undefined ? {} : { evidenceCoverage }) };
}

// ───────────────────────── Responses ─────────────────────────

export interface ResponseOutputTextLike {
  type: "output_text";
  text: string;
}

export interface ResponseMessageItemLike {
  type: "message";
  content?: readonly unknown[];
}

export interface ResponseFunctionCallItemLike {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export type ResponseOutputItemLike = ResponseMessageItemLike | ResponseFunctionCallItemLike;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessageItem(item: unknown): item is ResponseMessageItemLike {
  return isRecord(item) && item.type === "message";
}

function isFunctionCallItem(item: unknown): item is ResponseFunctionCallItemLike {
  return (
    isRecord(item) &&
    item.type === "function_call" &&
    typeof item.call_id === "string" &&
    typeof item.name === "string" &&
    typeof item.arguments === "string"
  );
}

export interface ResponseUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  /** 推理模型经 Responses 端点带回的思考 token 拆分,拆自 output_tokens。 */
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface ResponseLike {
  /** Full official Responses output union; recognized items are narrowed at runtime. */
  output: readonly unknown[];
  usage?: ResponseUsageLike;
}

function responsesUsage(usage: ResponseUsageLike | undefined): Usage | undefined {
  if (!usage) return undefined;
  // input_tokens 含缓存命中,cached_tokens 是其子集;落互斥桶前扣掉
  // (docs/feature/adapters/sdk/openai-compat/cost.md)
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const u: Usage = {
    inputTokens: Math.max(0, (usage.input_tokens ?? 0) - cached),
    outputTokens: usage.output_tokens ?? 0,
  };
  if (cached) u.cacheReadTokens = cached;
  if (usage.output_tokens_details?.reasoning_tokens) u.reasoningTokens = usage.output_tokens_details.reasoning_tokens;
  return u;
}

/**
 * Responses 形状的响应 → `Turn`。零映射:`res.output` 逐项翻译——
 * `message`(`content` 里的 `output_text`)变成 `message`,`function_call` 变成 `operation.started`。
 */
export function turnFromResponses(res: ResponseLike): Turn {
  const events: StreamEvent[] = [];
  for (const item of res.output ?? []) {
    if (isMessageItem(item)) {
      const text = (item.content ?? [])
        .filter(
          (content): content is ResponseOutputTextLike =>
            isRecord(content) && content.type === "output_text" && typeof content.text === "string",
        )
        .map((c) => c.text)
        .join("");
      if (text) events.push({ type: "message", role: "assistant", text });
    } else if (isFunctionCallItem(item)) {
      events.push({
        type: "operation.started",
        operationId: item.call_id,
        operation: { kind: "tool", name: item.name, input: parseArgs(item.arguments) },
      });
    }
  }
  const usage = responsesUsage(res.usage);
  const evidenceCoverage = turnCoverage(events, usage);
  return { events, status: "completed", usage, ...(evidenceCoverage === undefined ? {} : { evidenceCoverage }) };
}
