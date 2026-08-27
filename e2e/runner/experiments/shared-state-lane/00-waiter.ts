import { defineExperiment } from "niceeval";
import { sharedStateExclusiveLaneAgent, sharedStateHooks } from "../../agents/shared-state.ts";
import { controlledExclusiveSandbox } from "../../agents/controlled-exclusive-sandbox.ts";

export default defineExperiment({
  agent: sharedStateExclusiveLaneAgent,
  flags: { role: "lane-waiter" },
  sandbox: controlledExclusiveSandbox,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-exclusive-provider-lane" },
  ...sharedStateHooks("lane-waiter"),
});
