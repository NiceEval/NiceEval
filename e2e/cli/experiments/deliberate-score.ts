import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "deliberate-score:验证计分制结束摘要",
  agent: deterministicAgent("cli-score"),
  model: "cli-deterministic-v1",
  evals: ["deliberate-score"],
});
