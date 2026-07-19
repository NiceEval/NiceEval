import { defineExperiment } from "niceeval";
import agent from "../agents/langgraph.ts";

// 单配置基线:不比较模型,用 .env 里的默认模型(经 OpenAI 兼容端点)。
export default defineExperiment({
  description: "langgraph: fromLangGraphEvents() 官方转换器 + 真实模型",
  agent,
  runs: 1,
});
