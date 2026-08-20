import { defineExperiment } from "niceeval";
import { missingUsageAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Persist a deterministic result without token usage",
  agent: missingUsageAgent,
  evals: ["handoff"],
});
