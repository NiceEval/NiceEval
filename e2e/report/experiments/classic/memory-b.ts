import { defineExperiment } from "niceeval";
import { classicMemoryAgent } from "../../agents/classic.ts";

export default defineExperiment({
  description: "classic/memory-b: MemoryBench-like high memory condition",
  agent: classicMemoryAgent(),
  model: "gpt-5.6-luna",
  evals: ["classic/", "source-snapshot"],
  flags: { memory: "memory-b" },
  labels: { line: "classic", memory: "memory-b" },
  attempts: 1,
  earlyExit: false,
});
