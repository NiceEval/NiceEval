import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { sandboxActionDebugAgent } from "../agents/sandbox-action-debug.ts";
import {
  builtinFingerprintAlpha,
  builtinFingerprintBeta,
  constructorFingerprintBeta,
  opaqueDebugBarrier,
  plannedDebugAction,
  prototypeFingerprintAlpha,
  prototypeFingerprintBeta,
  recordSandboxActionDebugSideEffect,
  sensitiveDebugCommand,
} from "../src/sandbox-action-debug.ts";

const sandbox = dockerSandbox({
  source: {
    type: "image",
    image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f",
  },
  resources: {
    readOnlyRootfs: true,
    tmpfs: { "/tmp/debug-plan": { sizeBytes: 1024 * 1024 } },
  },
})
  .before(plannedDebugAction("frequency-high", 40))
  .before(plannedDebugAction("dependency-root", 50))
  .before(prototypeFingerprintAlpha)
  .before(prototypeFingerprintBeta)
  .before(constructorFingerprintBeta)
  .before(builtinFingerprintAlpha)
  .before(builtinFingerprintBeta)
  .before(plannedDebugAction("tie-experiment-first", 100))
  .before(plannedDebugAction("tie-experiment-second", 100))
  .before(sensitiveDebugCommand)
  .before(opaqueDebugBarrier)
  .before(plannedDebugAction("opaque-suffix", 300, ["opaque-barrier"]));

export default defineExperiment({
  description: "Structured Sandbox action debug plan",
  agent: sandboxActionDebugAgent,
  sandbox,
  evals: ["sandbox-action-debug/plan"],
  setup() {
    recordSandboxActionDebugSideEffect("experiment-setup");
  },
  teardown() {
    recordSandboxActionDebugSideEffect("experiment-teardown");
  },
});
