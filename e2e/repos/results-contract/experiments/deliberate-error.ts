import { defineExperiment } from "niceeval";
import agent from "../agents/openai-compat.ts";

// Never calls the real gateway (deliberate-error.eval.ts throws before any send). Exists
// to produce a deterministic `errored` verdict for the JUnit `<error>` folding assertion,
// kept in its own Experiment so it never shares a JUnit file with deliberate-fail.
export default defineExperiment({
  description: "deterministic errored verdict — JUnit <error> folding",
  agent,
  evals: ["deliberate-error"],
});
