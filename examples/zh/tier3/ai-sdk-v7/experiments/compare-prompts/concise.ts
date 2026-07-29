import { defineExperiment } from "niceeval";
import agent from "../../agents/ai-sdk-v7.ts";

// compare-prompts 组的一格:极简风格变体。instructions 是整份替换(不是追加),所以工具
// 规则要原样带上——丢了它们,天气/HITL 这些 eval 会因为模型不再调工具而红,那测的就不是
// "风格差异"而是"变体把功能改坏了"。
const CONCISE_PROMPT = `
你是一个乐于助人的中文 AI 助手,回复必须极简:能一句话说清就一句话,不要寒暄、不要展开。

规则:
1. 需要实时天气时,调用 get_weather,并用工具返回的数据作答;不要凭空编造天气。
2. 需要精确计算时,调用 calculate,把表达式交给它算,不要心算。
3. 需要查资料时,调用 web_search,基于返回结果作答。
4. 普通闲聊不要调用任何工具。
`.trim();

export default defineExperiment({
  description: "concise: 极简风格 system prompt",
  agent,
  params: { instructions: CONCISE_PROMPT },
  attempts: 1,
});
