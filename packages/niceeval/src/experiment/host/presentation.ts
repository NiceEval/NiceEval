import { evalLevelStats } from "../../shared/verdict.ts";
import type {
  CompletionStatus,
  InvocationCompletion,
  InvocationSummary,
  ReporterError,
  RunFeedbackState,
} from "../../runner/types.ts";

/**
 * Fold the one feedback reducer state into the Invocation completeness fact.
 * Renderers and CLI commands consume this result; none of them reclassifies
 * diagnostics independently.
 */
export function assembleInvocationCompletion(state: RunFeedbackState): InvocationCompletion {
  let unstarted = 0;
  let failFastSkipped = 0;
  let haltedSkipped = 0;
  let interrupted = false;
  const reporterErrors: ReporterError[] = [];

  for (const diagnostic of state.diagnostics) {
    const code = diagnostic.code ?? diagnostic.key.split(":", 1)[0];
    if (code === "interrupted") {
      interrupted = true;
    } else if (code === "budget-exhausted") {
      unstarted += diagnostic.count;
    } else if (code === "fail-fast") {
      unstarted += diagnostic.count;
      failFastSkipped += diagnostic.count;
    } else if (code === "dispatch-halted") {
      const halted = typeof diagnostic.data?.unstarted === "number"
        ? diagnostic.data.unstarted
        : 0;
      unstarted += halted;
      haltedSkipped += halted;
    } else if (code === "reporter-error" && diagnostic.data?.required === true) {
      reporterErrors.push(Object.freeze({
        reporter: typeof diagnostic.data.reporter === "string"
          ? diagnostic.data.reporter
          : diagnostic.key.slice("reporter-error:".length),
        required: true,
        message: diagnostic.message,
      }));
    }
  }

  if (interrupted) unstarted += state.queued;
  const earlyExitUnstarted = Math.max(
    0,
    state.earlyExitSkipped - failFastSkipped - haltedSkipped,
  );
  const status: CompletionStatus = interrupted
    ? "interrupted"
    : unstarted > 0 || reporterErrors.length > 0
      ? "incomplete"
      : "complete";
  return Object.freeze({
    status,
    unstarted,
    earlyExitUnstarted,
    reporterErrors: Object.freeze(reporterErrors),
  });
}

/** Fresh results and current Record readbacks share one Eval-level exit fold. */
export function foldInvocationEvalStats(
  summary: Pick<InvocationSummary, "results" | "reusedAttempts">,
) {
  const terminals = [
    ...summary.results.map((result) => Object.freeze({
      identity: `${result.experimentId ?? ""}|${result.id}`,
      verdict: result.verdict,
    })),
    ...summary.reusedAttempts.map((readback) => Object.freeze({
      identity: `${readback.target.experimentId}|${readback.target.evalId}`,
      verdict: readback.source.evaluationKind !== "score"
        ? readback.verdict
        : readback.score.state === "applicable" &&
            readback.score.attachment.state === "available" &&
            readback.score.attachment.value.state === "complete"
          ? "passed" as const
          : "errored" as const,
    })),
  ];
  return evalLevelStats(terminals, (terminal) => terminal.identity);
}
