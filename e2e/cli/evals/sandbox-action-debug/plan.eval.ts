import { defineEval } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import {
  plannedDebugAction,
  recordSandboxActionDebugSideEffect,
} from "../../src/sandbox-action-debug.ts";

export default defineEval({
  description: "Sandbox action debug planning fixture",
  sandbox: sandboxLayer().before(plannedDebugAction("tie-eval", 100)),
  async test() {
    recordSandboxActionDebugSideEffect("eval-test");
  },
});
