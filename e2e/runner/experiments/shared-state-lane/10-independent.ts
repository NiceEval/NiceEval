import { defineExperiment } from "niceeval";
import { sharedStateExclusiveLaneAgent } from "../../agents/shared-state.ts";
import { controlledExclusiveSandbox } from "../../agents/controlled-exclusive-sandbox.ts";

export default defineExperiment({
  agent: sharedStateExclusiveLaneAgent,
  flags: { role: "lane-independent" },
  sandbox: controlledExclusiveSandbox,
  evals: ["shared-state/"],
});
