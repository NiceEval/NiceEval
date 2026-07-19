// 两个演示工具的纯逻辑实现,包成 Claude Agent SDK `tool()` 形状导出。
// 天气数据是确定性模拟数据,不发起真实网络请求——这只是"假天气",跟真实的 query() 调用
// (本仓库不允许的"假 AI")无关。
// 工具调用的输入输出不需要在这里旁路记录:SDK 的 message stream 里 assistant 消息的
// tool_use 块和 user 消息的 tool_result 块本身就带全了,server.ts 原样转发即可。
//
// 故意不提供第三个工具(如 search):evals/weather-tool.eval.ts 用一个真正"未挂载"的工具名
// (mcp__demo-tools__search)做 notCalledTool 反例——它不是"这轮没调用"的偶然事实,而是这个
// MCP server 上根本不存在这个工具,负断言在结构上必然成立,不依赖模型这一次的具体决策。

import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

// city 描述特意写成英文 "e.g. Brooklyn"——与 e2e/repos/cli-contract 的 openai-compat get_weather
// 工具定义用同一句措辞,验证过对 DeepSeek 兼容端点能稳定换回字面 "Brooklyn" 作为工具入参,
// 而不是被翻译或改写成别的字符串。
const WEATHER_TABLE: Record<string, { condition: string; tempC: number }> = {
  Brooklyn: { condition: "Sunny", tempC: 22 },
  "New York": { condition: "Cloudy", tempC: 18 },
  "San Francisco": { condition: "Foggy", tempC: 15 },
  London: { condition: "Rainy", tempC: 12 },
  Tokyo: { condition: "Clear", tempC: 26 },
};

function getWeather(city: string): { city: string; condition: string; tempC: number } {
  const hit = WEATHER_TABLE[city];
  if (hit) return { city, ...hit };
  // 没收录的城市:用城市名派生一个确定性但看起来合理的读数,不发起真实网络请求。
  let hash = 0;
  for (const ch of city) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 997;
  const conditions = ["Sunny", "Cloudy", "Overcast", "Light rain"] as const;
  return { city, condition: conditions[hash % conditions.length]!, tempC: 10 + (hash % 20) };
}

/** 只接受数字、括号和 + - * / 的小型递归下降求值器——不用 eval/Function,避免任意代码执行。 */
function calculate(expression: string): number {
  const trimmed = expression.trim();
  if (trimmed.length === 0) throw new Error("expression must not be empty");
  if (!/^[\d+\-*/().\s]+$/.test(trimmed)) {
    throw new Error(`expression may only contain digits, + - * / ( ): ${expression}`);
  }

  let i = 0;
  const peek = (): string | undefined => trimmed[i];
  const skipSpace = (): void => {
    while (trimmed[i] === " ") i++;
  };

  function parseExpr(): number {
    skipSpace();
    let value = parseTerm();
    for (;;) {
      skipSpace();
      const op = peek();
      if (op !== "+" && op !== "-") break;
      i++;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    skipSpace();
    let value = parseFactor();
    for (;;) {
      skipSpace();
      const op = peek();
      if (op !== "*" && op !== "/") break;
      i++;
      const rhs = parseFactor();
      if (op === "/" && rhs === 0) throw new Error("division by zero");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseFactor(): number {
    skipSpace();
    if (peek() === "+") {
      i++;
      return parseFactor();
    }
    if (peek() === "-") {
      i++;
      return -parseFactor();
    }
    if (peek() === "(") {
      i++;
      const value = parseExpr();
      skipSpace();
      if (peek() !== ")") throw new Error("mismatched parentheses");
      i++;
      return value;
    }
    const start = i;
    while (i < trimmed.length && /[\d.]/.test(trimmed[i]!)) i++;
    if (start === i) throw new Error(`failed to parse expression at position ${i}`);
    return Number(trimmed.slice(start, i));
  }

  const result = parseExpr();
  skipSpace();
  if (i !== trimmed.length) throw new Error(`failed to parse expression at position ${i}`);
  if (!Number.isFinite(result)) throw new Error("result is not a finite number");
  return result;
}

export const demoTools = [
  tool(
    "get_weather",
    "Get the current weather for a given city (deterministic demo data, no real network call).",
    { city: z.string().describe("City name, e.g. Brooklyn") },
    async ({ city }) => {
      const result = getWeather(city);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  ),
  tool(
    "calculate",
    "Evaluate an arithmetic expression containing only digits, + - * / and parentheses.",
    { expression: z.string().describe("Arithmetic expression, e.g. (3 + 4) * 2") },
    async ({ expression }) => {
      try {
        const result = calculate(expression);
        return { content: [{ type: "text" as const, text: String(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `calculation error: ${message}` }], isError: true };
      }
    },
  ),
];
