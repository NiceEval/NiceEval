import { defineExperiment } from "niceeval";
import { classicMemoryAgent } from "../../agents/classic.ts";

export default defineExperiment({
  description: "classic/memory-a: MemoryBench-like mid memory condition",
  agent: classicMemoryAgent(),
  model: "gpt-5.6-luna",
  evals: ["classic/", "source-snapshot"],
  flags: { memory: "memory-a" },
  labels: { line: "classic", memory: "memory-a" },
  attempts: 1,
  earlyExit: false,
});
