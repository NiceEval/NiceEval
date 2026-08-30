import { defineEval } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import {
  plannedDebugAction,
  recordSandboxActionDebugSideEffect,
} from "../../src/sandbox-action-debug.ts";

export default defineEval({
  description: "Second Sandbox action debug planning fixture",
  sandbox: sandboxLayer().before(plannedDebugAction("tie-eval-secondary", 100)),
  async test() {
    recordSandboxActionDebugSideEffect("secondary-eval-test");
  },
});
