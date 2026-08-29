import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../../agents/deterministic.ts";

export default defineExperiment({
  description: "harness/alternate: exercise a second Experiment in the same terminal group",
  agent: deterministicAgent(),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  evals: ["inspection"],
});
