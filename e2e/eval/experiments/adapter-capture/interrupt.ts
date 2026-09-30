import { defineExperiment } from "niceeval";
import { interruptCapture } from "../../fixtures/adapter-capture/interrupt.ts";

export default defineExperiment({
  timeoutMs: 120_000,
  adapter: interruptCapture,
  evals: ["adapter-capture/interrupt"],
  attempts: 2,
  maxConcurrency: 1,
});
