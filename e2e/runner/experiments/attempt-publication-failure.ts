import { defineExperiment } from "niceeval";
import { attemptPublicationFailureAgent } from "../agents/timing.ts";

export default defineExperiment({
  description: "attempt publication failure",
  agent: attemptPublicationFailureAgent,
  evals: ["timing/basic"],
});
