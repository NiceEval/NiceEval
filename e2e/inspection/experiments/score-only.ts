import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "score-only: 验证纯 Score 结果不被展示为通过率",
  agent: deterministicAgent(),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  evals: ["score", "overview/secondary", "score-error"],
});
