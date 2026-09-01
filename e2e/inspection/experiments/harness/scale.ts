import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../../agents/deterministic.ts";

export default defineExperiment({
  description: "harness/scale: keep the complete terminal Overview readable at benchmark scale",
  agent: deterministicAgent(),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  evals: ["overview-scale"],
  attempts: 10,
});
