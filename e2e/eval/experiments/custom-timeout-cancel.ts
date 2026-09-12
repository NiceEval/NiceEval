import { defineExperiment } from "niceeval";
import { customTimeoutCancellation } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Custom Adapter Attempt cancellation",
  adapter: customTimeoutCancellation,
  evals: ["custom-timeout-cancel"],
  timeoutMs: 500,
});
