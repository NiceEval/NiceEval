// 被测助手:系统提示 + 四个工具 + 一个 chat 函数。纯 AI SDK v7 工具循环,不接任何
// 观测或 eval 框架。
//
// send_email 带 `needsApproval: true`(AI SDK v7 的 tool approval):模型决定调它时
// SDK 会停下来等人批准,调用方需要把 approval response 塞回 messages 再召一次。
import { generateText, isStepCount, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { DEFAULT_MODEL, resolveModel } from "./models.ts";

export const SYSTEM_PROMPT = `
你是一个乐于助人的中文 AI 助手。

规则:
1. 需要实时天气时,调用 get_weather,并用工具返回的数据作答;不要凭空编造天气。
2. 需要精确计算时,调用 calculate,把表达式交给它算,不要心算。
3. 需要查资料时,调用 web_search,基于返回结果作答。
4. 用户要求发送邮件时,调用 send_email;邮件发出(或被拒绝)后如实告知用户结果。
5. 普通闲聊不要调用任何工具。回复保持中文、友好、简洁。
`.trim();

const weatherBank: Record<string, { tempC: number; condition: string }> = {
  北京: { tempC: 26, condition: "晴" },
  上海: { tempC: 29, condition: "多云" },
  广州: { tempC: 32, condition: "雷阵雨" },
  深圳: { tempC: 31, condition: "阴" },
  杭州: { tempC: 28, condition: "小雨" },
};

const MATH_CHARS = /^[\d+\-*/().\s]+$/;

export function buildTools(): ToolSet {
  return {
    get_weather: tool({
      description: "查询某个城市的当前天气。需要实时天气时调用。",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: async ({ city }) => {
        const weather = weatherBank[city] ?? { tempC: 24, condition: "晴" };
        return { city, ...weather, summary: `${city}当前${weather.condition},气温 ${weather.tempC}°C。` };
      },
    }),
    calculate: tool({
      description: "计算一个四则运算表达式(支持 + - * / 和括号)。需要精确计算时调用。",
      inputSchema: z.object({ expression: z.string().min(1) }),
      execute: async ({ expression }) => {
        const expr = expression.trim();
        if (!MATH_CHARS.test(expr)) throw new Error(`只支持四则运算表达式,收到:${expression}`);
        const result = Function(`"use strict"; return (${expr});`)() as unknown;
        if (typeof result !== "number" || !Number.isFinite(result)) throw new Error(`无法计算:${expression}`);
        return { expression: expr, result };
      },
    }),
    web_search: tool({
      description: "搜索网络获取资料摘要。需要查资料时调用。",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => ({
        query,
        results: [
          { title: `关于「${query}」的概览`, snippet: `这是与「${query}」最相关的一条摘要结果。` },
          { title: `「${query}」延伸阅读`, snippet: `进一步解释「${query}」的背景与常见问题。` },
        ],
      }),
    }),
    send_email: tool({
      description: "把一封邮件发送给指定收件人。用户要求发邮件时调用。",
      inputSchema: z.object({
        to: z.string().min(1).describe("收件人邮箱"),
        subject: z.string().min(1).describe("邮件主题"),
        body: z.string().min(1).describe("邮件正文"),
      }),
      // 对外发东西是高危动作:要求人工批准。模型决定调用后,本轮 generateText 会带着
      // tool-approval-request 停下,等下一轮把 tool-approval-response 塞回 messages。
      needsApproval: true,
      execute: async ({ to, subject }) => ({ delivered: true, to, subject, messageId: `msg-${to}` }),
    }),
  };
}

/** 应用怎么召模型:一个普通的 generateText 工具循环。 */
export async function chat(messages: ModelMessage[], modelId?: string) {
  return await generateText({
    model: resolveModel(modelId ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL),
    system: SYSTEM_PROMPT,
    messages,
    tools: buildTools(),
    stopWhen: isStepCount(5),
  });
}
