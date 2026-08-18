import { defineExperiment } from "niceeval";
import { ompAgent } from "niceeval/adapter";

export default defineExperiment({
  description: "OMP adapter 的目标兼容性闭环",
  agent: ompAgent(),
  model: "deepseek-v4-flash",
  evals: ["message"],
  attempts: 1,
});
