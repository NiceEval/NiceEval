import { defineExperiment } from "niceeval";
import { noSetupAgent } from "../agents/timing.ts";

export default defineExperiment({
  description: "Agent teardown without a setup hook",
  agent: noSetupAgent,
  flags: { lifecycleReceipt: "timing-no-setup.ndjson" },
  evals: ["timing/no-setup"],
});
