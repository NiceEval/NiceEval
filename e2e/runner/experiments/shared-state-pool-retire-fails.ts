import { defineExperiment } from "niceeval";
import {
  sharedStateHooks,
  sharedStateReuseAgent,
  sharedStateReuseSandbox,
} from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateReuseAgent,
  flags: { role: "retire-fails" },
  sandbox: sharedStateReuseSandbox,
  sandboxReuse: true,
  maxConcurrency: 1,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-pool-retire" },
  ...sharedStateHooks("pool-retire-fails"),
});
