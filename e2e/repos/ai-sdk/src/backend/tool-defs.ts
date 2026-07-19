// AI SDK tool definitions shared by all three entry points. `calculate` carries
// `needsApproval: true` — the one HITL surface this repo exercises across transports.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { calculate, getWeather } from "./tools.ts";

export const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则：
1. 需要实时天气时，调用 get_weather，并用工具返回的数据作答；不要凭空编造天气。
2. 需要精确计算时，调用 calculate，把表达式交给它算，不要心算。
3. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

export function buildTools(): ToolSet {
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: async (input: { city: string }) => getWeather(input),
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({ expression: z.string().min(1) }),
      // HITL surface: the SDK pauses the tool loop and emits a tool-approval-request;
      // execute only runs after the caller resolves it (approve/deny).
      needsApproval: true,
      execute: async (input: { expression: string }) => calculate(input),
    }),
  };
}
