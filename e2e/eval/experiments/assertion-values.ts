import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Public value matchers and pass handles",
  agent: deterministicAgent,
  evals: ["assertion-values", "assertion-match-outcomes"],
});
