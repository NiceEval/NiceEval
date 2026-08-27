import { Effect } from "effect";
import { defineExperiment } from "niceeval";
import { defineSandbox } from "niceeval/sandbox";
import { deterministicSandboxAgent } from "../agents/sandbox.ts";
import { createReadLimitedSandbox } from "../agents/read-limited-sandbox.ts";

export const readLimitedSandbox = defineSandbox({
  name: "read-limited-e2e",
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  exclusive: true,
  create: () => Effect.promise(() => createReadLimitedSandbox()),
});

export default defineExperiment({
  description: "Public Sandbox assertion evidence",
  agent: deterministicSandboxAgent,
  // Every native test gives this test-only Provider its own copied project and
  // fixed HOME/CODEX_HOME/TMPDIR below that copy.
  sandbox: readLimitedSandbox,
  evals: ["assertion-sandbox", "workspace-diff-cap"],
});
