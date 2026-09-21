import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  agent: deterministicAgent("interrupt-feedback"),
  evals: ["interrupt-feedback/wait"],
});
