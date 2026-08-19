import { defineExperiment } from "niceeval";
import { localSandbox } from "niceeval/sandbox";
import { deterministicSandboxAgent } from "../agents/sandbox.ts";

export default defineExperiment({
  description: "Public Sandbox assertion evidence",
  agent: deterministicSandboxAgent,
  // Every native test gives this Experiment its own copied project. localSandbox
  // therefore observes a real, writable, disposable workdir without Docker.
  sandbox: localSandbox({ dir: process.cwd() }),
  evals: ["assertion-sandbox", "workspace-diff-cap"],
});
