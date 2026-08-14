import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Public score assertion handles",
  agent: deterministicAgent,
  evals: ["assertion-score"],
  attempts: 2,
  earlyExit: true,
});
