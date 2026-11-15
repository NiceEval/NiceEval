import type { RunExecutionContext } from "../../record/model/run-context.ts";
import type { AgentRun } from "../types.ts";

/** Capture effective Experiment inputs after Plugin composition, without invoking hooks. */
export function experimentHooksForRun(run: AgentRun): NonNullable<RunExecutionContext["experimentHooks"]> {
  return {
    setup: run.setup === undefined ? "absent" : "opaque",
    teardown: run.teardown === undefined ? "absent" : "opaque",
  };
}
