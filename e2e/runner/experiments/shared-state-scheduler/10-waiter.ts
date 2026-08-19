import { defineExperiment } from "niceeval";
import { sharedStateSchedulerAgent, sharedStateSchedulerHooks } from "../../agents/shared-state-scheduler.ts";

export default defineExperiment({
  agent: sharedStateSchedulerAgent,
  flags: { role: "waiter" },
  attempts: 3,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-scheduler" },
  ...sharedStateSchedulerHooks("waiter"),
});
