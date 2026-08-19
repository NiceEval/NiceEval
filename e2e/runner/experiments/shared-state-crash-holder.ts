import { defineExperiment } from "niceeval";
import { sharedStateAgent, sharedStateHooks } from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "crash-holder" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-crash" },
  ...sharedStateHooks("crash-holder"),
});
