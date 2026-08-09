import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "accept and reanchor",
  agent: deterministicAgent,
  evals: ["accept/"],
});
