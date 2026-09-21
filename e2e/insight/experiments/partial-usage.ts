import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "partial-usage: expose a partial token subtotal in Insight",
  agent: deterministicAgent({ partialUsage: true }),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  evals: ["inspection"],
});
