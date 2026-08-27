import { defineExperiment } from "niceeval";
import { deterministicSandboxAgent } from "../agents/sandbox.ts";
import { readLimitedSandbox } from "./assertion-sandbox.ts";

export default defineExperiment({
  description: "ACTIVE detail control-sequence redaction owner",
  agent: deterministicSandboxAgent,
  sandbox: readLimitedSandbox,
  model: "eval-active-progress-redaction",
  evals: ["active-progress-redaction"],
});
