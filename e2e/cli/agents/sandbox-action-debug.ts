import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { sandboxLayer } from "niceeval/sandbox";
import {
  plannedDebugAction,
  recordSandboxActionDebugSideEffect,
  sandboxActionDebugAgentProbe,
} from "../src/sandbox-action-debug.ts";

const evidenceCoverage = {
  ...completeEvidenceCoverage,
  usage: {
    status: "unavailable",
    reason: "deterministic debug fixture does not report token usage",
  } as const,
};

export const sandboxActionDebugAgent = defineSandboxAgent({
  name: "cli-sandbox-action-debug",
  evidenceCoverage,
  sandbox: sandboxLayer()
    .before(plannedDebugAction("agent-frequency-first", 5))
    .before(plannedDebugAction("tie-agent", 100)),
  ensure: {
    identity: {
      agent: "cli-sandbox-action-debug",
      version: "1",
      revision: "1",
    },
    probe: sandboxActionDebugAgentProbe,
  },
  setup() {
    recordSandboxActionDebugSideEffect("agent-setup");
  },
  async send() {
    recordSandboxActionDebugSideEffect("agent-send");
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "debug fixture must not run" }],
    };
  },
  teardown() {
    recordSandboxActionDebugSideEffect("agent-teardown");
  },
});
