import { defineExperiment } from "niceeval";
import { lifecycleSandbox, quickAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "next consumer after interrupted run",
  agent: quickAgent,
  sandbox: lifecycleSandbox,
  evals: ["probe"],
});
