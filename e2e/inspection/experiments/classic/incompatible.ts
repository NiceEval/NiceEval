import { defineExperiment } from "niceeval";
import { classicMemoryAgent } from "../../agents/classic.ts";

export default defineExperiment({
  description: "classic/incompatible: same author group with a deliberately different Eval population",
  agent: classicMemoryAgent(),
  model: "gpt-5.6-luna",
  evals: ["score"],
  flags: { memory: "incompatible" },
  labels: { line: "classic", memory: "incompatible" },
  // Two Attempts make Eval coverage observably different from Attempt samples.
  attempts: 2,
});
