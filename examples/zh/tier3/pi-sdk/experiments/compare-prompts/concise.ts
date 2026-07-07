import { defineExperiment } from "niceeval";
import agent from "../../agents/pi-sdk.ts";

// compare-prompts 组的一格:极简风格变体。systemPrompt 是整份替换(不是追加),工具规则
// 必须至少和默认 prompt 一样硬——第一版只写"需要时调用工具",模型在"极简"的暗示下直接
// 心算了算式、跳过 calculate,HITL 停轮没发生,hitl-deny 直接 errored。A/B 想对照的是
// 风格,不能顺带把工具纪律改松,所以这里把"必须调用、不要心算"写死。
const CONCISE_PROMPT =
  "你是一个能查天气、能做算术的助理。涉及算式必须调用 calculate,涉及天气必须调用 get_weather,不要心算、不要瞎编数字。回复必须极简:能一句话说清就一句话,不要寒暄。";

export default defineExperiment({
  description: "concise: 极简风格 system prompt",
  agent,
  flags: { systemPrompt: CONCISE_PROMPT },
  runs: 1,
});
