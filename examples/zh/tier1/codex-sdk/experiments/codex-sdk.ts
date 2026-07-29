import { defineExperiment } from "niceeval";
import agent from "../agents/codex-sdk.ts";

// 单配置基线:这个示例只有一个 agent、不比较模型,用 .env 里的默认模型(gpt-5.4)。
export default defineExperiment({
  description: "codex-sdk:真实 Codex SDK 后端",
  agent,
  attempts: 1,
});
