import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

const barrierRoot = process.env.NICEEVAL_CONCURRENCY_BARRIER;

export default defineExperiment({
  description: "concurrent invocation deduplication",
  agent: deterministicAgent,
  evals: ["concurrent/"],
  ...(barrierRoot === undefined ? {} : { flags: { barrierRoot } }),
});
