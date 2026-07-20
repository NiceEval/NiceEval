import { defineExperiment } from "niceeval";
import { webAgent } from "../../adapter/adapter.ts";

// compare-models 组的一格:gpt-4o-mini。与 gpt-4o.ts 钉住一切、只差 model,
// 差异才干净归因到模型这一个轴。
export default defineExperiment({
  description: "AI 助手:gpt-4o-mini",
  agent: webAgent({ baseUrl: "https://example.com" }),
  model: "gpt-4o-mini",
  runs: 3,
  budget: 5,
});
