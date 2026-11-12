import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  adapter: deterministicAgent,
  evals: ["accept/accept-target"],
  flags: { aRevision: "before", padding: "x".repeat(700), zRevision: "before" },
});
