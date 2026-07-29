import { defineExperiment } from "niceeval";
import agent from "../agents/pi-sdk.ts";

// 单配置基线:不比较模型,用 .env 里的默认模型(deepseek-v4-flash)。
export default defineExperiment({
  description: "pi-sdk:真实 DeepSeek 后端(默认模型)",
  agent,
  attempts: 1,
});
