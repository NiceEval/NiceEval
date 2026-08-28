import { defineExperiment } from "niceeval";
import { setupFailureAgent } from "../agents/timing.ts";

export default defineExperiment({
  description: "Agent teardown after setup failure",
  agent: setupFailureAgent,
  flags: { lifecycleReceipt: "timing-setup-failure.ndjson" },
  evals: ["timing/setup-failure"],
});
