import { defineExperiment } from "niceeval";
import { sharedStateAgent, sharedStateHooks } from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "second" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-cohort" },
  ...sharedStateHooks("second"),
});
