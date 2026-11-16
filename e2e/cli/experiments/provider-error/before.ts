import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../../agents/deterministic.ts";

export default defineExperiment({
  adapter: deterministicAgent("before-error"),
  evals: ["greet/hello"],
  attempts: 2,
  before: () => {
    throw new Error("Experiment before failed: request req_before_123");
  },
});
