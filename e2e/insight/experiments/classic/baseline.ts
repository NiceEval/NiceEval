import { defineExperiment } from "niceeval";
import { classicMemoryAgent } from "../../agents/classic.ts";

export default defineExperiment({
  description: "classic/baseline: MemoryBench-like no-memory condition",
  agent: classicMemoryAgent(),
  model: "gpt-5.6-luna",
  evals: ["classic/", "source-snapshot"],
  flags: { memory: "baseline" },
  labels: { line: "classic", memory: "baseline" },
  attempts: 1,
  earlyExit: false,
});
