import { defineExperiment } from "niceeval";
import agent from "../agents/langgraph.ts";

// 单配置基线:不比较模型,用 .env 里的默认模型(deepseek-v4-flash,经 OpenAI 兼容端点)。
// docs/origin-integration.md 的验收清单里,多模型对比只点名了 ai-sdk-v7 / claude-sdk /
// pi-sdk 三个,这里不建 experiments/compare-models/。
export default defineExperiment({
  description: "langgraph:真实 LangGraph + DeepSeek 后端",
  agent,
  attempts: 1,
});
