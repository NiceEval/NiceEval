// OpenAI 两种响应形状(Chat Completions / Responses)的官方转换器 —— 写 send 指南「零映射」
// 表格里的 fromChatCompletion(res) / fromResponses(res)。和 fromAiSdk 同一先例:结构化
// *Like 类型,不依赖 openai 包,兼容任何声明自己走这两种协议形状的服务(不止 OpenAI 官方)。
//
// 两种形状对负断言的可信度不同(见 docs-site/zh/how-to/write-send.mdx):
//   · Chat Completions 不承诺「响应 = 完整过程」(应用可能在服务端跑完工具循环,只把最终
//     答案给你),所以 notCalledTool 这类负断言只能当「没看到」,不能当「确实没发生」。
//   · Responses 的协议契约里 output 数组记录了模型这一轮决定做的全部事(包括每个
//     function_call),负断言可信。
// niceeval 目前没有「事件完整性证明」这个跨事件流的元数据字段,所以这条差异只体现在
// 文档提示里,两个转换器产出的 Turn 形状本身相同。

import type { JsonValue, StreamEvent, Turn, Usage } from "../types.ts";

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
}

export interface ChatCompletionLike {
  choices: { message: ChatCompletionMessageLike }[];
  usage?: ChatCompletionUsageLike;
}

function chatCompletionUsage(usage: ChatCompletionUsageLike | undefined): Usage | undefined {
  if (!usage) return undefined;
  const u: Usage = { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
  if (usage.prompt_tokens_details?.cached_tokens) u.cacheReadTokens = usage.prompt_tokens_details.cached_tokens;
  return u;
}

/**
 * Chat Completions 形状的响应 → `Turn`。零映射:`res.choices[0].message` 的
 * `tool_calls` / `content` 直接变成 `action.called` / `message`,`usage` 顺手带上。
 */
export function fromChatCompletion(res: ChatCompletionLike): Turn {
  const message = res.choices[0]?.message;
  const events: StreamEvent[] = [];
  for (const call of message?.tool_calls ?? []) {
    events.push({
      type: "action.called",
      callId: call.id,
      name: call.function.name,
      input: parseArgs(call.function.arguments),
    });
  }
  if (message?.content) events.push({ type: "message", role: "assistant", text: message.content });
  return { events, status: "completed", usage: chatCompletionUsage(res.usage) };
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
}

export interface ResponseLike {
  output: ResponseOutputItemLike[];
  usage?: ResponseUsageLike;
}

function responsesUsage(usage: ResponseUsageLike | undefined): Usage | undefined {
  if (!usage) return undefined;
  const u: Usage = { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 };
  if (usage.input_tokens_details?.cached_tokens) u.cacheReadTokens = usage.input_tokens_details.cached_tokens;
  return u;
}

/**
 * Responses 形状的响应 → `Turn`。零映射:`res.output` 逐项翻译——
 * `message`(`content` 里的 `output_text`)变成 `message`,`function_call` 变成 `action.called`。
 */
export function fromResponses(res: ResponseLike): Turn {
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
        type: "action.called",
        callId: item.call_id,
        name: item.name,
        input: parseArgs(item.arguments),
      });
    }
  }
  return { events, status: "completed", usage: responsesUsage(res.usage) };
}
