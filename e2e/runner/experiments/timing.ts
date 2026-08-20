import { defineExperiment } from "niceeval";
import { timingAgent } from "../agents/timing.ts";

export default defineExperiment({
  description: "generic runner timing",
  agent: timingAgent,
  evals: ["timing/basic"],
});
