import { defineExperiment } from "niceeval";
import { runnerAgent } from "../agents/live.ts";

export default defineExperiment({
  description: "history identity deduplication",
  agent: runnerAgent,
  model: "gpt-5.6-luna",
  evals: ["suite/"],
});
