import { Effect } from "effect";

import type {
  AssertionScore,
  AssertionScoreIncompleteReason,
  AssertionSealError,
  AssertionSealOptions,
  AssertionVerdict,
  AssertionsRuntime,
  SealedAssertionEvaluation,
  SealedAttemptAssertions,
} from "../assertions/api.ts";
import type { AgentWorkspaceDiff } from "../assertions/workspace-diff.ts";

function verdictFor(
  evaluation: SealedAssertionEvaluation,
  evaluationKind: "pass" | "score",
): AssertionVerdict {
  if (
    evaluation.execution === "errored"
    || evaluation.assertions.some(
      (assertion) =>
        assertion.required
        && (evaluationKind === "pass" || assertion.result.score.state !== "not-scored")
        && (assertion.result.state === "unavailable" || assertion.result.state === "errored"),
    )
  ) {
    return Object.freeze({ state: "errored" as const });
  }
  if (evaluationKind === "pass" && evaluation.assertions.some((assertion) => assertion.result.gate === "failed")) {
    return Object.freeze({ state: "failed" as const });
  }
  return Object.freeze({
    state: evaluation.explicitlySkipped ? "skipped" as const : "passed" as const,
  });
}

function incompleteReasonRank(reason: AssertionScoreIncompleteReason): number {
  switch (reason) {
    case "execution-errored":
      return 0;
    case "source-unavailable":
      return 1;
    case "evaluation-errored":
      return 2;
    case "not-applicable":
      return 3;
  }
}

function scoreFor(
  evaluation: SealedAssertionEvaluation,
): AssertionScore {
  let earned = 0;
  let hasAuditableContribution = false;
  const incompleteReasons: AssertionScoreIncompleteReason[] = [];

  for (const assertion of evaluation.assertions) {
    const contribution = assertion.result.score;
    switch (contribution.state) {
      case "not-scored":
        break;
      case "earned":
        hasAuditableContribution = true;
        earned += contribution.earned;
        if (!Number.isFinite(earned)) {
          throw new Error("Assert-first score earned total overflowed");
        }
        break;
      case "unavailable":
        if (assertion.required) incompleteReasons.push(contribution.reason);
        break;
    }
  }

  if (evaluation.execution === "errored") {
    incompleteReasons.push("execution-errored");
  }

  const reasons = Object.freeze(
    [...new Set(incompleteReasons)].sort(
      (left, right) => incompleteReasonRank(left) - incompleteReasonRank(right),
    ),
  );
  if (reasons.length === 0) {
    return Object.freeze({ state: "complete" as const, earned });
  }
  return hasAuditableContribution
    ? Object.freeze({ state: "partial" as const, earned, reasons })
    : Object.freeze({ state: "unavailable" as const, reasons });
}

/**
 * Seals Assert-first's immutable runtime result. Durable attachment encoding
 * is intentionally deferred to the Evaluation Record adapter.
 */
export function sealAttemptAssertions<Kind extends "pass" | "score">(
  runtime: AssertionsRuntime<Kind>,
  options: AssertionSealOptions,
  workspaceDiff?: AgentWorkspaceDiff,
): Effect.Effect<SealedAttemptAssertions, AssertionSealError> {
  return runtime.seal(options).pipe(
    Effect.map((sealed) => Object.freeze({
      entries: sealed.entries,
      evaluation: sealed.evaluation,
      ...(workspaceDiff === undefined ? {} : { workspaceDiff }),
      verdict: verdictFor(sealed.evaluation, runtime.evaluationKind),
      ...(runtime.evaluationKind === "score" ? { score: scoreFor(sealed.evaluation) } : {}),
    })),
  );
}
