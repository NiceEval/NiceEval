import { defineExperiment } from "niceeval";
import { x } from "../evaluation/adapter.js";

export default defineExperiment({
  description: "确定性 provider 经真实 HTTP 后端验证持久化与 AI 回复链路，不代表真实模型质量",
  adapter: x,
  flags: { provider: "fixture" },
  attempts: 1,
  evals: ["social-journey"],
});
