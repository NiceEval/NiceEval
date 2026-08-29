import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../../agents/deterministic.ts";

export default defineExperiment({
  description: "harness/canary: exercise grouped terminal inspection output",
  agent: deterministicAgent(),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  evals: ["inspection"],
});
