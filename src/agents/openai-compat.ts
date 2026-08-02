// OpenAI 两种响应形状(Chat Completions / Responses)的官方转换器 —— 写 send 指南「零映射」
// 表格里的 turnFromChatCompletion(res) / turnFromResponses(res)。和 turnFromAiSdk 同一先例:结构化
// *Like 类型,不依赖 openai 包,兼容任何声明自己走这两种协议形状的服务(不止 OpenAI 官方)。
//
// 两种形状对负断言的可信度不同:Chat Completions 可能只给最终消息，Responses.output
// 则完整列出本轮 function_call。下列六通道 EvidenceCoverage 常量把差异交给 core 的
// 三值逻辑；转换器在单轮缺 usage 时再据实降级该通道。

import type { EvidenceCoverage, JsonValue, StreamEvent, Turn, Usage } from "../types.ts";

const COMPLETE = Object.freeze({ status: "complete" as const });
const NO_DATA = Object.freeze({ status: "unavailable" as const, reason: "OpenAI response conversion does not populate Turn.data." });
const SYNTHETIC_STATUS = Object.freeze({
  status: "partial" as const,
  reason: "The converter maps a returned response to completed and does not observe the full request lifecycle.",
});

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
  status: SYNTHETIC_STATUS,
  data: NO_DATA,
});

export const responsesEvidenceCoverage: EvidenceCoverage = Object.freeze({
  events: Object.freeze({
    status: "partial",
    reason: "Unknown Responses output item types are intentionally skipped by the protocol-neutral converter.",
  }),
  actions: COMPLETE,
  messages: COMPLETE,
  usage: COMPLETE,
  status: SYNTHETIC_STATUS,
  data: NO_DATA,
});

function missingUsageCoverage(usage: Usage | undefined): Turn["evidenceCoverage"] {
  return usage
    ? undefined
    : { usage: { status: "unavailable", reason: "This response did not include protocol usage." } };
}

/** tool_calls / function_call 的 `arguments` 恒为 JSON 字符串;解析失败(极少见)原样退回字符串,不吞异常。 */
function parseArgs(raw: string | undefined): JsonValue {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

// ───────────────────────── Chat Completions ─────────────────────────

export interface ChatCompletionToolCallLike {
  id: string;
  function: { name: string; arguments: string };
}

export interface ChatCompletionMessageLike {
  role?: string;
  content?: string | null;
  tool_calls?: ChatCompletionToolCallLike[];
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
    events.push({
      type: "operation.started",
      operationId: call.id,
      operation: { kind: "tool", name: call.function.name, input: parseArgs(call.function.arguments) },
    });
  }
  if (message?.content) events.push({ type: "message", role: "assistant", text: message.content });
  const usage = chatCompletionUsage(res.usage);
  return { events, status: "completed", usage, evidenceCoverage: missingUsageCoverage(usage) };
}

// ───────────────────────── Responses ─────────────────────────

export interface ResponseOutputTextLike {
  type: "output_text";
  text: string;
}

export interface ResponseMessageItemLike {
  type: "message";
  content?: ResponseOutputTextLike[];
}

export interface ResponseFunctionCallItemLike {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

/** 其余 output item 类型(reasoning、内建工具调用……)按需扩展;认不出的原样跳过。 */
export interface ResponseOtherItemLike {
  type: string;
  [key: string]: unknown;
}

export type ResponseOutputItemLike = ResponseMessageItemLike | ResponseFunctionCallItemLike | ResponseOtherItemLike;

function isMessageItem(item: ResponseOutputItemLike): item is ResponseMessageItemLike {
  return item.type === "message";
}

function isFunctionCallItem(item: ResponseOutputItemLike): item is ResponseFunctionCallItemLike {
  return item.type === "function_call";
}

export interface ResponseUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  /** 推理模型经 Responses 端点带回的思考 token 拆分,拆自 output_tokens。 */
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface ResponseLike {
  output: ResponseOutputItemLike[];
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
        .filter((c): c is ResponseOutputTextLike => c.type === "output_text")
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
  return { events, status: "completed", usage, evidenceCoverage: missingUsageCoverage(usage) };
}
