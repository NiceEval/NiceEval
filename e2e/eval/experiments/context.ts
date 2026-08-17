import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Context scopes through a deterministic direct Agent",
  agent: deterministicAgent,
  model: "eval-deterministic",
  evals: ["context-scopes"],
});
