import { defineExperiment } from "niceeval";
import {
  sharedStateHooks,
  sharedStateReuseAgent,
  sharedStateReuseSandbox,
} from "../agents/shared-state.ts";

export default defineExperiment({
  agent: sharedStateReuseAgent,
  flags: { role: "fresh-cleanup-fails" },
  sandbox: sharedStateReuseSandbox,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-fresh-cleanup" },
  ...sharedStateHooks("fresh-cleanup-fails"),
});
