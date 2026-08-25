import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Judge measurement 使用受控 provider 并保留 artifact",
  agent: deterministicAgent,
  evals: ["assertion-judge-fake"],
});
