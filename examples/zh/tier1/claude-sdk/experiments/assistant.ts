import { defineExperiment } from "niceeval";
import agent from "../agents/claude-sdk.ts";

// 单配置基线:不比较模型,用 .env 里的默认模型。
export default defineExperiment({
  description: "claude-sdk:真实 Claude Agent SDK 后端(默认模型)",
  agent,
  attempts: 1,
});
