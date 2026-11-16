import { defineExperiment } from "niceeval";
import { sharedStateHooks, sharedStateReuseAgent, sharedStateReuseSandbox } from "../agents/shared-state.ts";

export default defineExperiment({
  adapter: sharedStateReuseAgent,
  flags: { role: "second" },
  sandbox: sharedStateReuseSandbox,
  sandboxReuse: true,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-pool" },
  ...sharedStateHooks("pool-second"),
});
