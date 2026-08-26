import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "main: 生成固定 Inspection 读取所需的已封口 Run",
  agent: deterministicAgent(),
  model: "inspection-fixture-v1",
  evals: ["inspection"],
});
