import { defineExperiment } from "niceeval";
import { boundaryAgent } from "../evals/assertion-agent-history-boundaries.eval.ts";

export default defineExperiment({
  description: "Agent QA coverage, observed failures, and session-prefix operation joining",
  agent: boundaryAgent,
  evals: ["assertion-agent-history-boundaries"],
});
