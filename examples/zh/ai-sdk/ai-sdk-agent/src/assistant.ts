import { randomUUID } from "node:crypto";
import { createFastevalTrace, type FastevalSpan, type FastevalTrace } from "./fasteval-observability.ts";
import type { AgentEvent, AgentRequest, AgentResponse, JsonValue } from "./protocol.ts";

// 一个普通的 AI 助手:需要实时信息或精确计算时调用工具,不要凭空编造;给了图片就描述图片。
// 三个 mock 工具(确定性返回,免外部依赖):查天气、算数、网络搜索。

interface SessionState {
  id: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ToolRecorder {
  recordTool<T extends JsonValue>(name: string, input: JsonValue, run: () => T): T;
}

const sessions = new Map<string, SessionState>();

export function getSession(sessionId?: string): SessionState {
  const id = sessionId?.trim() || `assistant-${randomUUID()}`;
  const existing = sessions.get(id);
  if (existing) return existing;
  const next: SessionState = { id, messages: [] };
  sessions.set(id, next);
  return next;
}

// ───────────────────────── 工具实现(mock,确定性) ─────────────────────────

const weatherBank: Record<string, { tempC: number; condition: string }> = {
  北京: { tempC: 26, condition: "晴" },
  上海: { tempC: 29, condition: "多云" },
  广州: { tempC: 32, condition: "雷阵雨" },
  深圳: { tempC: 31, condition: "阴" },
  杭州: { tempC: 28, condition: "小雨" },
};

export function getWeather(input: { city: string }): { city: string; tempC: number; condition: string; summary: string } {
  const weather = weatherBank[input.city] ?? { tempC: 24, condition: "晴" };
  return {
    city: input.city,
    tempC: weather.tempC,
    condition: weather.condition,
    summary: `${input.city}当前${weather.condition}，气温 ${weather.tempC}°C。`,
  };
}

const MATH_CHARS = /^[\d+\-*/().\s]+$/;

export function calculate(input: { expression: string }): { expression: string; result: number } {
  const expr = input.expression.trim();
  if (!MATH_CHARS.test(expr)) throw new Error(`只支持四则运算表达式，收到：${input.expression}`);
  // 输入已被白名单限制为数字/运算符/括号,这里安全求值。
  const result = Function(`"use strict"; return (${expr});`)() as unknown;
  if (typeof result !== "number" || !Number.isFinite(result)) throw new Error(`无法计算：${input.expression}`);
  return { expression: expr, result };
}

export function webSearch(input: { query: string }): { query: string; results: Array<{ title: string; snippet: string }> } {
  return {
    query: input.query,
    results: [
      { title: `关于「${input.query}」的概览`, snippet: `这是与「${input.query}」最相关的一条摘要结果。` },
      { title: `「${input.query}」延伸阅读`, snippet: `进一步解释「${input.query}」的背景与常见问题。` },
    ],
  };
}

export function makeRecorder(events: AgentEvent[], trace?: FastevalTrace, parent?: FastevalSpan): ToolRecorder {
  return {
    recordTool(name, input, run) {
      const callId = `${name}-${randomUUID()}`;
      events.push({ type: "action.called", callId, name, input, tool: "unknown" });
      // tool span(第二路可观测):gen_ai.operation.name=execute_tool → fasteval 归到 "tool"。
      const toolSpan = trace?.span(`execute_tool ${name}`, {
        parent,
        attrs: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name, call_id: callId },
      });
      try {
        const output = run();
        events.push({ type: "action.result", callId, output, status: "completed" });
        toolSpan?.end();
        return output;
      } catch (error) {
        events.push({
          type: "action.result",
          callId,
          output: { error: error instanceof Error ? error.message : String(error) },
          status: "failed",
        });
        toolSpan?.end(undefined, { error: true });
        throw error;
      }
    },
  };
}

// ───────────────────────── mock 回合(免 API key 也能跑) ─────────────────────────

export async function handleMockTurn(request: AgentRequest): Promise<AgentResponse> {
  const session = getSession(request.sessionId);
  const events: AgentEvent[] = [];
  // 第二路可观测:mock 模式也把 turn / tool 发到 fasteval,免 API key 就能在 view 里看到瀑布图。
  const trace = createFastevalTrace(request.otelEndpoint);
  const turn = trace.span("assistant.turn", { attrs: { "turn.id": session.id, "assistant.mode": "mock" } });
  const tools = makeRecorder(events, trace, turn);
  const message = request.message;

  let reply: string;
  let lastAction = "chat";

  const hasImage = (request.files ?? []).some((f) => f.mimeType.startsWith("image/"));
  const city = matchCity(message);
  const expression = matchExpression(message);

  if (hasImage) {
    // 图片理解:mock 看不到真实像素,给一段与 evals/fixtures/sample.png 一致的固定描述。
    reply = "这是一张以蓝色为主、中间有一个白色方块的图片。";
    lastAction = "describe_image";
  } else if (/天气|weather|气温|下雨|温度/i.test(message) && city) {
    const result = tools.recordTool("get_weather", { city }, () => getWeather({ city }));
    reply = result.summary;
    lastAction = "get_weather";
  } else if (expression) {
    const result = tools.recordTool("calculate", { expression }, () => calculate({ expression }));
    reply = `${result.expression} = ${result.result}`;
    lastAction = "calculate";
  } else if (/搜索|查一下|查查|search|搜一下/i.test(message)) {
    const query = message.replace(/搜索|查一下|查查|search|搜一下|帮我|一下|：|:/gi, "").trim() || message;
    const result = tools.recordTool("web_search", { query }, () => webSearch({ query }));
    reply = `我查到了：${result.results[0]!.title} —— ${result.results[0]!.snippet}`;
    lastAction = "web_search";
  } else {
    reply = "你好，我是一个 AI 助手。可以帮你查天气、做计算、搜索信息、看图片，也可以直接聊聊。";
  }

  session.messages.push({ role: "user", content: message }, { role: "assistant", content: reply });
  events.push({ type: "message", role: "assistant", text: reply });

  turn.end({ "assistant.last_action": lastAction });
  await trace.flush();

  return {
    sessionId: session.id,
    reply,
    events,
    data: { lastAction },
    usage: { inputTokens: estimateTokens(message), outputTokens: estimateTokens(reply), requests: 1 },
  };
}

export function rememberAiTurn(session: SessionState, user: string, assistant: string): void {
  session.messages.push({ role: "user", content: user }, { role: "assistant", content: assistant });
}

export function sessionMessages(session: SessionState): Array<{ role: "user" | "assistant"; content: string }> {
  return session.messages.slice(-12);
}

function matchCity(message: string): string | undefined {
  return Object.keys(weatherBank).find((city) => message.includes(city));
}

/** 从消息里抠出四则运算表达式(数学字符的最长片段,且至少含一个数字和一个运算符)。 */
function matchExpression(message: string): string | undefined {
  const runs = message.match(/[\d+\-*/().\s]+/g);
  if (!runs) return undefined;
  const candidates = runs.map((r) => r.trim()).filter((r) => /\d/.test(r) && /[-+*/]/.test(r));
  return candidates.sort((a, b) => b.length - a.length)[0];
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 3));
}
