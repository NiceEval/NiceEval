import { defineEvalGroup } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import {
  plannedDebugAction,
} from "../../src/sandbox-action-debug.ts";
import plan from "./plan.eval.ts";
import secondary from "./secondary.eval.ts";

export default defineEvalGroup({
  evals: [plan, secondary],
  onUnavailable: "stop-group",
  sandbox: sandboxLayer()
    .before(plannedDebugAction("frequency-low", 10))
    .before(plannedDebugAction("dag-fast-dependent", 1, ["dependency-root"]))
    .before(plannedDebugAction("tie-eval-group", 100)),
});
