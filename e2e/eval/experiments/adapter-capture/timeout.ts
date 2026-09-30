import { defineExperiment } from "niceeval";
import { timeoutCapture } from "../../fixtures/adapter-capture/timeout.ts";

export default defineExperiment({
  timeoutMs: 120_000,
  adapter: timeoutCapture,
  evals: ["adapter-capture/timeout"],
});
