import { defineExperiment } from "niceeval";
import { runnerAgent } from "../agents/live.ts";

export default defineExperiment({
  description: "carry and partial rerun",
  agent: runnerAgent,
  model: "gpt-5.6-luna",
  evals: ["simple/"],
});
