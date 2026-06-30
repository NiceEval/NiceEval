import { randomUUID } from "node:crypto";
import { generateText, stepCountIs, tool, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod/v4";
import type { AgentEvent, AgentRequest, AgentResponse, AgentUsage, JsonValue, RequestFile } from "./protocol.ts";
import { createFastevalTrace } from "./fasteval-observability.ts";
import { calculate, getSession, getWeather, rememberAiTurn, sessionMessages, webSearch } from "./assistant.ts";

const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则：
1. 需要实时天气时，调用 get_weather，并用工具返回的数据作答；不要凭空编造天气。
2. 需要精确计算时，调用 calculate，把表达式交给它算，不要心算。
3. 需要查资料时，调用 web_search，基于返回结果作答。
4. 用户发来图片（消息里带图片）时，直接描述图片内容，不需要调用工具。
5. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

export async function handleAiSdkTurn(request: AgentRequest, signal?: AbortSignal): Promise<AgentResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required when AGENT_MODE=ai.");

  const session = getSession(request.sessionId);
  const events: AgentEvent[] = [];
  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  const modelId = request.model ?? process.env.AGENT_MODEL ?? "gpt-4o-mini";
  const model = openai.chat(modelId);

  // 第二路可观测:把本轮发到 fasteval 的 OTLP 接收器(没传 endpoint 就 no-op)。
  const trace = createFastevalTrace(request.otelEndpoint);
  const turn = trace.span("assistant.turn", { attrs: { "turn.id": session.id, "assistant.mode": "ai" } });

  const tools = makeAiTools({
    events,
    record(name, input, run) {
      const callId = `${name}-${randomUUID()}`;
      events.push({ type: "action.called", callId, name, input, tool: "unknown" });
      // tool span:gen_ai.operation.name=execute_tool → fasteval 归到 "tool";call_id 让它
      // 把 transcript 里的入参/出参 join 回 span。
      const toolSpan = trace.span(`execute_tool ${name}`, {
        parent: turn,
        attrs: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name, call_id: callId },
      });
      try {
        const output = run();
        events.push({ type: "action.result", callId, output, status: "completed" });
        toolSpan.end();
        return output;
      } catch (error) {
        events.push({
          type: "action.result",
          callId,
          output: { error: error instanceof Error ? error.message : String(error) },
          status: "failed",
        });
        toolSpan.end(undefined, { error: true });
        throw error;
      }
    },
  });

  // model span:gen_ai.operation.name=chat → fasteval 归到 "model"。
  const modelSpan = trace.span(`chat ${modelId}`, {
    parent: turn,
    attrs: { "gen_ai.operation.name": "chat", "gen_ai.request.model": modelId, "gen_ai.system": "openai" },
  });
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      messages: [...sessionMessages(session), userMessage(request.message, request.files)],
      tools,
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

  const lastAction = events.findLast((event) => event.type === "action.called")?.name ?? "chat";
  turn.end({ "assistant.last_action": lastAction });
  await trace.flush();

  return {
    sessionId: session.id,
    reply,
    events,
    data: { lastAction },
    usage,
  };
}

/** 把消息组装成 user message:带图片附件时拆成 text + image part(多模态,base64 data URL),否则纯文本。 */
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

/** 把 token 用量挂到 model span(GenAI semconv 键),供瀑布图下钻;不参与计费。 */
function usageAttrs(usage: AgentUsage | undefined): Record<string, number> {
  if (!usage) return {};
  return {
    "gen_ai.usage.input_tokens": usage.inputTokens,
    "gen_ai.usage.output_tokens": usage.outputTokens,
  };
}

function makeAiTools({
  record,
}: {
  events: AgentEvent[];
  record<T extends JsonValue>(name: string, input: JsonValue, run: () => T): T;
}): ToolSet {
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({
        city: z.string().min(1).describe("城市名，例如 北京、上海。"),
      }),
      execute: async (input: { city: string }) => record("get_weather", { city: input.city }, () => getWeather(input)),
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({
        expression: z.string().min(1).describe("四则运算表达式，例如 (12 + 8) * 3。"),
      }),
      execute: async (input: { expression: string }) =>
        record("calculate", { expression: input.expression }, () => calculate(input)),
    }),
    web_search: tool({
      description: "搜索网络获取资料摘要。需要查资料时调用。",
      inputSchema: z.object({
        query: z.string().min(1).describe("搜索关键词。"),
      }),
      execute: async (input: { query: string }) => record("web_search", { query: input.query }, () => webSearch(input)),
    }),
  };
}

function normalizeUsage(result: unknown): AgentUsage | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  const usage = asRecord(record.usage) ?? asRecord(record.totalUsage);
  if (!usage) return undefined;

  const inputTokens = numberField(usage.inputTokens) ?? numberField(usage.promptTokens) ?? 0;
  const outputTokens = numberField(usage.outputTokens) ?? numberField(usage.completionTokens) ?? 0;
  return { inputTokens, outputTokens, requests: 1 };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
