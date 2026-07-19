// Plain execute functions, deliberately transport-agnostic: the same two functions back
// the tool defs used by the HTTP server, the in-process agent, and the zero-mapping agent,
// so a passing Eval on one entry point is directly comparable to the same Eval on another.

const weatherBank: Record<string, { tempC: number; condition: string }> = {
  北京: { tempC: 26, condition: "晴" },
  上海: { tempC: 29, condition: "多云" },
  广州: { tempC: 32, condition: "雷阵雨" },
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
  const result = Function(`"use strict"; return (${expr});`)() as unknown;
  if (typeof result !== "number" || !Number.isFinite(result)) throw new Error(`无法计算：${input.expression}`);
  return { expression: expr, result };
}
