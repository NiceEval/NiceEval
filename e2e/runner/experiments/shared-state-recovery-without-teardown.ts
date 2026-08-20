import { defineExperiment } from "niceeval";
import { sharedStateAgent } from "../agents/shared-state.ts";

/** Deliberately lacks teardown: explicit recovery must reject it before claiming its lease. */
export default defineExperiment({
  agent: sharedStateAgent,
  flags: { role: "recovery-without-teardown" },
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-recovery-without-teardown" },
});
