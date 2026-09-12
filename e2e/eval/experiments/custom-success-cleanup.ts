import { defineExperiment } from "niceeval";
import { successfulSlowCleanup } from "../fixtures/custom-applications.ts";

export default defineExperiment({
  application: successfulSlowCleanup,
  evals: ["custom-success-cleanup"],
  attempts: 1,
  timeoutMs: 5_000,
});
