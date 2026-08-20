import { defineExperiment } from "niceeval";
import { sharedStateAgent, sharedStateHooks } from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "recovery-without-teardown-waiter" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-recovery-without-teardown" },
  ...sharedStateHooks("recovery-without-teardown-waiter"),
});
