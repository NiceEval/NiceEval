import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "alternate: 为固定 View 提供第二个可选择实验",
  agent: deterministicAgent(),
  model: "inspection-fixture-v1",
  evals: ["inspection"],
});
