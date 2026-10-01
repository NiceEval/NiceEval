import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Score completeness is independent of Verdict in Insight results",
  agent: deterministicAgent(),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  evals: ["verdict-scores"],
});
