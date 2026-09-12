import { defineExperiment } from "niceeval";
import { x } from "../evaluation/application.js";

export default defineExperiment({
  description: "确定性 provider 验证应用动作与评估接入，不代表真实模型质量",
  application: x,
  flags: { provider: "fixture" },
  attempts: 1,
  evals: ["social-journey"],
});
