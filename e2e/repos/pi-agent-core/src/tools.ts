// 三个真实工具,包成 pi(@earendil-works/pi-agent-core)的 AgentTool——参数 schema 用 typebox
// (从 @earendil-works/pi-ai 重新导出的 Type/Static,不是 zod),execute 签名是
// (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>。
//
// 三个工具分别撑起 e2e 的三种协议行为,互不重叠(见 ../evals/):
//   - get_weather:从不失败、不需要审批——工具执行归一 + 会话续接两条 eval 用它。
//   - calculate:从不需要审批,但可以真实失败(除以零)——usage/失败状态归一那条 eval 用它。
//   - send_alert:从不失败,但需要审批(server.ts 的 beforeToolCall 只拦它)——HITL 暂停恢复那条 eval 用它。
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";

export const WEATHER_TABLE: Record<string, { condition: string; tempC: number }> = {
  北京: { condition: "晴", tempC: 31 },
  上海: { condition: "多云", tempC: 29 },
  深圳: { condition: "雷阵雨", tempC: 33 },
  广州: { condition: "阵雨", tempC: 32 },
};

export function getWeather(city: string): { city: string; condition: string; tempC: number } {
  const known = WEATHER_TABLE[city];
  if (known) return { city, ...known };
  // 没收录的城市:按字符串哈希出一个确定性的假天气,保证同一个城市每次结果一致。
  let hash = 0;
  for (const ch of city) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const conditions = ["晴", "多云", "小雨", "阴"] as const;
  return { city, condition: conditions[hash % conditions.length]!, tempC: 15 + (hash % 20) };
}

/** 除以零算出 Infinity,Number.isFinite 挡下来真实抛错——不是靠字符白名单伪造的失败。 */
export function calculate(expression: string): number {
  if (!/^[0-9+\-*/(). \s]+$/.test(expression)) {
    throw new Error(`calculate 只支持数字和 + - * / ( ),收到不支持的表达式: ${expression}`);
  }
  // eslint-disable-next-line no-new-func -- 输入已用白名单正则校验过,不会跑到任意代码。
  const value = Function(`"use strict"; return (${expression});`)() as unknown;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`表达式 ${expression} 没算出一个有限数字`);
  }
  return value;
}

const weatherParams = Type.Object({
  city: Type.String({ description: "城市名,例如 北京" }),
});

export const getWeatherTool: AgentTool<typeof weatherParams> = {
  name: "get_weather",
  label: "查询天气",
  description: "查询城市当前天气(mock 数据,仅用于演示,不接真实天气 API)",
  parameters: weatherParams,
  execute: async (_toolCallId, params: Static<typeof weatherParams>) => {
    const data = getWeather(params.city);
    return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
  },
};

const calculateParams = Type.Object({
  expression: Type.String({ description: "算术表达式,例如 (3+4)*2" }),
});

export const calculateTool: AgentTool<typeof calculateParams> = {
  name: "calculate",
  label: "算术计算",
  description: "计算一个只含数字和 + - * / ( ) 的算术表达式",
  parameters: calculateParams,
  execute: async (_toolCallId, params: Static<typeof calculateParams>) => {
    const result = calculate(params.expression);
    const data = { expression: params.expression, result };
    return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
  },
};

const sendAlertParams = Type.Object({
  message: Type.String({ description: "要发送的告警文本" }),
});

/** 这个工具本身从不失败;server.ts 的 beforeToolCall 只拦这一个工具名,拿它演示 HITL。 */
export const sendAlertTool: AgentTool<typeof sendAlertParams> = {
  name: "send_alert",
  label: "发送告警",
  description: "向值班渠道发送一条告警通知(需要人工审批,mock 实现,不接真实通知服务)",
  parameters: sendAlertParams,
  execute: async (_toolCallId, params: Static<typeof sendAlertParams>) => {
    const data = { message: params.message, sentAt: new Date().toISOString() };
    return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
  },
};
