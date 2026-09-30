import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  agent: deterministicAgent("short-error"),
  evals: ["short-error/score"],
  attempts: 3,
  maxConcurrency: 1,
});
