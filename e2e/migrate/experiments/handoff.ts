import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Persisted Record handoff bootstrap",
  agent: deterministicAgent,
  evals: ["handoff"],
});
