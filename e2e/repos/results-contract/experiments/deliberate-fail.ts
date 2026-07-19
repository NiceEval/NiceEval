import { defineExperiment } from "niceeval";
import agent from "../agents/openai-compat.ts";

// Never calls the real gateway (deliberate-fail.eval.ts doesn't send). Exists to produce
// a deterministic `failed` verdict for the JUnit `<failure>` folding assertion.
export default defineExperiment({
  description: "deterministic failed verdict — JUnit <failure> folding",
  agent,
  evals: ["deliberate-fail"],
});
