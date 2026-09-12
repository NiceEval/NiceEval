import { defineExperiment } from "niceeval";
import { customTimeoutCancellation } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  description: "Custom application Attempt cancellation",
  application: customTimeoutCancellation,
  evals: ["custom-timeout-cancel"],
  timeoutMs: 500,
});
