import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "score-feedback:完整零分、failed gate 与 partial 的人读展示",
  agent: deterministicAgent("cli-score-feedback"),
  model: "cli-deterministic-v1",
  evals: ["score-feedback"],
});
