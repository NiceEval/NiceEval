import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "carry and partial rerun",
  agent: deterministicAgent,
  evals: ["simple/"],
});
