import { defineExperiment } from "fasteval";
import { webAgent } from "../../agents/web-agent.ts";

// compare-models 组的一格:gpt-4o-mini。与 gpt-4o.ts 钉住一切、只差 model,
// 差异才干净归因到模型这一个轴。
export default defineExperiment({
  description: "AI 助手:gpt-4o-mini",
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-4o-mini",
  runs: 3,
  earlyExit: true, // 3 次里通过一次就停
  budget: 5,
});
