import { defineExperiment } from "niceeval";
import { evalGroupAgent } from "../agents/eval-group.ts";
import { lifecycleSandbox } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Eval Groups share physical Sandboxes only within each Group",
  agent: evalGroupAgent,
  sandbox: lifecycleSandbox,
  evals: ["group-a", "group-b"],
  maxConcurrency: 2,
});
