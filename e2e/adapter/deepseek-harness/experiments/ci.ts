import { defineExperiment } from "niceeval";
import { deepSeekHarnessAgent } from "niceeval/adapter";

export default defineExperiment({
  description: "DeepSeek Harness adapter 的目标兼容性闭环",
  agent: deepSeekHarnessAgent(),
  model: "deepseek-v4-flash",
  evals: ["message"],
  attempts: 1,
});
