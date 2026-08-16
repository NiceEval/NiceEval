import { defineExperiment } from "niceeval";
import { lifecycleSandbox, quickAgent } from "../../agents/deterministic.ts";

/** The independently sealed sibling in the SIGINT publication lifecycle case. */
export default defineExperiment({
  description: "complete sibling Run before the interrupted Run is stopped",
  agent: quickAgent,
  sandbox: lifecycleSandbox,
  evals: ["probe"],
});
