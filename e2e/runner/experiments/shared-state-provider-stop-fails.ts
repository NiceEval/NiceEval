import { defineExperiment } from "niceeval";
import {
  sharedStateProviderStopAgent,
  sharedStateProviderStopHooks,
  sharedStateProviderStopSandbox,
} from "../agents/shared-state-provider-stop.ts";

export default defineExperiment({
  agent: sharedStateProviderStopAgent,
  flags: { role: "provider-stop-fails" },
  sandbox: sharedStateProviderStopSandbox,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-provider-stop" },
  ...sharedStateProviderStopHooks("provider-stop-fails"),
});
