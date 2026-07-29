import { defineExperiment } from "niceeval";
import agent from "../agents/ai-sdk-v7.ts";

// 单配置基线:不比较模型,用请求体不传 model 时应用自己的默认值。
export default defineExperiment({
  description: "ai-sdk-v7:真实 AI SDK v7 后端(默认模型)",
  agent,
  attempts: 1,
});
