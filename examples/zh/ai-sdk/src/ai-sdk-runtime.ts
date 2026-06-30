import { randomUUID } from "node:crypto";
import { generateText, streamText, stepCountIs, tool, convertToModelMessages, type ModelMessage, type UIMessage, type ToolSet } from "ai";
import { z } from "zod/v4";
import type { AgentEvent, AgentRequest, AgentResponse, AgentUsage, JsonValue, RequestFile } from "./protocol.ts";
import { createFastevalTrace } from "./fasteval-observability.ts";
import { calculate, getSession, getWeather, rememberAiTurn, sessionMessages, webSearch } from "./assistant.ts";
import { modelSupportsVision, resolveModel } from "./models.ts";

const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则：
1. 需要实时天气时，调用 get_weather，并用工具返回的数据作答；不要凭空编造天气。
2. 需要精确计算时，调用 calculate，把表达式交给它算，不要心算。
3. 需要查资料时，调用 web_search，基于返回结果作答。
4. 用户发来图片（消息里带图片）时，直接描述图片内容，不需要调用工具。
5. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

function buildTools(
  record: <T extends JsonValue>(name: string, input: JsonValue, run: () => T) => T,
): ToolSet {
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: async (input: { city: string }) => record("get_weather", { city: input.city }, () => getWeather(input)),
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({ expression: z.string().min(1) }),
      execute: async (input: { expression: string }) =>
        record("calculate", { expression: input.expression }, () => calculate(input)),
    }),
    web_search: tool({
      description: "搜索网络获取资料摘要。需要查资料时调用。",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async (input: { query: string }) => record("web_search", { query: input.query }, () => webSearch(input)),
    }),
  };
}

// 无副作用版本的工具集，供 streamChat (UI 流式端点) 使用。
function buildSimpleTools(): ToolSet {
  const noop = <T extends JsonValue>(_name: string, _input: JsonValue, run: () => T): T => run();
  return buildTools(noop);
}

function makeRecorder(events: AgentEvent[]) {
  return function record<T extends JsonValue>(name: string, input: JsonValue, run: () => T): T {
    const callId = `${name}-${randomUUID()}`;
    events.push({ type: "action.called", callId, name, input, tool: "unknown" });
    try {
      const output = run();
      events.push({ type: "action.result", callId, output, status: "completed" });
      return output;
    } catch (error) {
      events.push({
        type: "action.result",
        callId,
        output: { error: error instanceof Error ? error.message : String(error) },
        status: "failed",
      });
      throw error;
    }
  };
}

/**
 * UI 流式端点：接受 useChat 发来的 UIMessage[] 数组，转换后直接 pipe 到客户端。
 * 图片由客户端以 FileUIPart（data URL）形式嵌入消息，convertToModelMessages 负责转换。
 */
export async function streamChat(
  rawMessages: unknown[],
  modelId?: string,
  signal?: AbortSignal,
) {
  const resolvedModel = resolveModel(modelId ?? process.env.AGENT_MODEL ?? "deepseek-v4-flash");

  // useChat 发来的是 UIMessage[]（有 parts/id），需转成 ModelMessage[]。
  const rawConverted = await convertToModelMessages(rawMessages as UIMessage[]);
  const messages = modelSupportsVision(modelId ?? "")
    ? rawConverted
    : stripImageParts(rawConverted);

  return streamText({
    model: resolvedModel,
    system: SYSTEM_PROMPT,
    messages,
    tools: buildSimpleTools(),
    stopWhen: stepCountIs(5),
    abortSignal: signal,
  });
}

/** eval adapter 用：等完整结果，返回 AgentResponse JSON。 */
export async function handleAiSdkTurn(request: AgentRequest, signal?: AbortSignal): Promise<AgentResponse> {
  const session = getSession(request.sessionId);
  const events: AgentEvent[] = [];
  const modelId = request.model ?? process.env.AGENT_MODEL ?? "deepseek-v4-flash";
  const model = resolveModel(modelId);

  const trace = createFastevalTrace(request.otelEndpoint);
  const turn = trace.span("assistant.turn", { attrs: { "turn.id": session.id } });
  const modelSpan = trace.span(`chat ${modelId}`, {
    parent: turn,
    attrs: { "gen_ai.operation.name": "chat", "gen_ai.request.model": modelId },
  });

  const rawMessages = [...sessionMessages(session), userMessage(request.message, request.files)];
  const messages = modelSupportsVision(modelId) ? rawMessages : stripImageParts(rawMessages);

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools: buildTools(makeRecorder(events)),
      stopWhen: stepCountIs(5),
      abortSignal: signal,
    });
  } catch (error) {
    modelSpan.end(undefined, { error: true });
    turn.end(undefined, { error: true });
    await trace.flush();
    throw error;
  }

  const usage = normalizeUsage(result);
  modelSpan.end(usageAttrs(usage));

  const reply = result.text.trim() || "我已经处理了这一步。";
  rememberAiTurn(session, request.message, reply);
  events.push({ type: "message", role: "assistant", text: reply });

  const lastAction = events.findLast((e) => e.type === "action.called")?.name ?? "chat";
  turn.end({ "assistant.last_action": lastAction });
  await trace.flush();

  return { sessionId: session.id, reply, events, data: { lastAction }, usage };
}

function userMessage(message: string, files?: RequestFile[]): ModelMessage {
  const images = (files ?? []).filter((f) => f.mimeType.startsWith("image/"));
  if (images.length === 0) return { role: "user", content: message };
  return {
    role: "user",
    content: [
      { type: "text", text: message || "请描述这张图片。" },
      ...images.map((f) => ({ type: "image" as const, image: `data:${f.mimeType};base64,${f.dataBase64}` })),
    ],
  };
}

function usageAttrs(usage: AgentUsage | undefined): Record<string, number> {
  if (!usage) return {};
  return {
    "gen_ai.usage.input_tokens": usage.inputTokens,
    "gen_ai.usage.output_tokens": usage.outputTokens,
  };
}

function stripImageParts(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
    type Part = { type?: string };
    const before = msg.content as Part[];
    const filtered = before.filter((p) => p.type !== "image" && p.type !== "file");
    if (filtered.length === before.length) return msg;
    // Always append the note — if we only keep user text without it, the model
    // sees "图片里面是什么" with no image and hallucinates a description.
    (filtered as unknown[]).push({ type: "text", text: "[注意：用户发送了图片，但当前模型不支持图像输入，请告知用户换用支持视觉的模型]" });
    return { ...msg, content: filtered } as ModelMessage;
  });
}

function normalizeUsage(result: unknown): AgentUsage | undefined {
  const rec = asRecord(result);
  if (!rec) return undefined;
  const usage = asRecord(rec.usage) ?? asRecord(rec.totalUsage) ?? rec;
  const inputTokens = numberField(usage.inputTokens) ?? numberField(usage.promptTokens) ?? 0;
  const outputTokens = numberField(usage.outputTokens) ?? numberField(usage.completionTokens) ?? 0;
  if (!inputTokens && !outputTokens) return undefined;
  return { inputTokens, outputTokens, requests: 1 };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
