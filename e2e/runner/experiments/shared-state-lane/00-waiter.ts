import { defineExperiment } from "niceeval";
import { localSandbox } from "niceeval/sandbox";
import { sharedStateExclusiveLaneAgent, sharedStateHooks } from "../../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateExclusiveLaneAgent,
  flags: { role: "lane-waiter" },
  sandbox: localSandbox({ dir: process.cwd() }),
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-exclusive-provider-lane" },
  ...sharedStateHooks("lane-waiter"),
});
