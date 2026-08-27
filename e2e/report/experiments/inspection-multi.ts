import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "inspection-multi: 验证 Overview 先按 Eval 求 Attempt 均分，再跨 Eval 求和",
  agent: deterministicAgent(),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  evals: ["inspection", "overview-secondary"],
  attempts: 2,
});
