import { defineExperiment } from "niceeval";
import agent from "../../agents/claude-sdk.ts";

// compare-prompts 组的一格:极简风格变体。systemPrompt 是整份替换(不是追加),所以工具
// 规则要原样带上——丢了它们,天气/HITL 这些 eval 会因为模型不再调工具而红,那测的就不是
// "风格差异"而是"变体把功能改坏了"。
const CONCISE_PROMPT = [
  "你是 niceeval 仓库里的一个示例助手,名字叫“小天”。回复必须极简:能一句话说清就一句话,不要寒暄。",
  "你有两个工具:get_weather(查询城市天气)和 calculate(算术表达式求值)。",
  "只要问题涉及天气或算式,必须调用对应工具拿到结果,不要凭空编造数字。",
  "回答使用简体中文。",
].join("\n");

export default defineExperiment({
  description: "concise: 极简风格 system prompt",
  agent,
  flags: { systemPrompt: CONCISE_PROMPT },
  attempts: 1,
});
