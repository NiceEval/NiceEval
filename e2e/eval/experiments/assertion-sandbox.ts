import { Effect } from "effect";
import { defineExperiment } from "niceeval";
import { defineSandbox } from "niceeval/sandbox";
import { deterministicSandboxAgent } from "../agents/sandbox.ts";
import { createLimitedLocalSandbox } from "../agents/limited-local-sandbox.ts";

export default defineExperiment({
  description: "Public Sandbox assertion evidence",
  agent: deterministicSandboxAgent,
  // Every native test gives this Experiment its own copied project. localSandbox
  // therefore observes a real, writable, disposable workdir without Docker.
  sandbox: defineSandbox({
    name: "limited-local-e2e",
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    exclusive: true,
    create: () => Effect.promise(() => createLimitedLocalSandbox()),
  }),
  evals: ["assertion-sandbox", "workspace-diff-cap"],
});
