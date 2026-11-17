import { defineExperiment } from "niceeval";
import { deterministicSandboxAgent } from "../agents/sandbox.ts";
import { readLimitedSandbox } from "./assertion-sandbox.ts";

export default defineExperiment({
  adapter: deterministicSandboxAgent,
  sandbox: readLimitedSandbox,
  evals: ["assertion-command-evidence"],
});
