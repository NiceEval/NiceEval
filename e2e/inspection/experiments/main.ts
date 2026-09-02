import { defineExperiment } from "niceeval";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "main: 生成固定 Inspection 读取所需的已封口 Run",
  agent: deterministicAgent(),
  sandbox: deterministicSandbox,
  model: "inspection-fixture-v1",
  flags: { privateExecutionFlag: "not-reportable" },
  labels: { memory: "origin" },
  evals: ["inspection"],
});
