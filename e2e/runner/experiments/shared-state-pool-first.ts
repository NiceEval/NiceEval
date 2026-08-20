import { defineExperiment } from "niceeval";
import {
  sharedStateHooks,
  sharedStateReuseAgent,
  sharedStateReuseSandbox,
} from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateReuseAgent,
  flags: { role: "first" },
  sandbox: sharedStateReuseSandbox,
  sandboxReuse: true,
  attempts: 2,
  maxConcurrency: 1,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-pool" },
  ...sharedStateHooks("pool-first"),
});
