import { defineExperiment } from "niceeval";
import { quickAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "next consumer after interrupted run",
  agent: quickAgent,
  evals: ["probe"],
});
