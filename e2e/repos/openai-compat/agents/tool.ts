// 两个 Agent 共用的 get_weather 工具 schema——按各自协议的工具声明形状写一次,只用来让模型
// 判断"要不要调、调对不对"。不实现真实执行(不回传 tool 结果消息):三条 Eval 只观察模型
// 单轮的工具决策与文本决策,不需要完整的多轮工具循环。

/** Chat Completions 形状:`tools: [{ type: "function", function: {...} }]`。 */
export const WEATHER_TOOL_CHAT_COMPLETIONS = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name, e.g. Brooklyn" } },
      required: ["city"],
    },
  },
} as const;

/** Responses 形状:`tools: [{ type: "function", name, description, parameters }]`(不嵌套 function)。 */
export const WEATHER_TOOL_RESPONSES = {
  type: "function",
  name: "get_weather",
  description: "Get the current weather for a given city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string", description: "City name, e.g. Brooklyn" } },
    required: ["city"],
  },
} as const;
