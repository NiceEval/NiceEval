import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Public Agent QA history, scoped selectors, and complete model audit",
  agent: deterministicAgent,
  evals: ["assertion-agent-qa"],
});
