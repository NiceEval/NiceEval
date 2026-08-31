import { defineExperiment } from "niceeval";
import { completionPersistenceFailureAgent } from "../agents/timing.ts";

export default defineExperiment({
  description: "attempt publication failure",
  agent: completionPersistenceFailureAgent,
  evals: ["timing/basic"],
});
