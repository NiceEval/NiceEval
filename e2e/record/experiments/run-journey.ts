import { defineExperiment } from "niceeval";
import { runJourneyAgent } from "../agents/run-journey.ts";

const barrierRoot = process.env.NICEEVAL_RUN_JOURNEY_BARRIER;

export default defineExperiment({
  description: "Run create, independent Attempt publication, and interruption",
  agent: runJourneyAgent,
  evals: ["run-journey"],
  attempts: 2,
  maxConcurrency: 1,
  ...(barrierRoot === undefined ? {} : { flags: { barrierRoot } }),
});
