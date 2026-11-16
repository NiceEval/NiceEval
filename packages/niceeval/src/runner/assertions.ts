import { Effect, Result } from "effect";

import type {
  AssertionSealError,
  AssertionSealOptions,
  AssertionsRuntime,
  SealedAssertionEvaluation,
  SealedAttemptAssertions,
} from "../assertions/api.ts";
import type { AgentWorkspaceDiff } from "../assertions/workspace-diff.ts";
import { buildScorePayload, type ScorePayloadBuildError } from "../eval/record/score.ts";
import { foldVerdict } from "../eval/record/verdict.ts";
import type { EvaluationAttemptFacts } from "../eval/record/sealed-assertion.ts";
import { encodeAssertionResult } from "../assertions/record/attachment.ts";

/** Encode internal Assertion facts once at the canonical Eval fold boundary. */
export function assertionEvaluationFacts(evaluation: SealedAssertionEvaluation): EvaluationAttemptFacts {
  return {
    execution: evaluation.execution,
    explicitlySkipped: evaluation.explicitlySkipped,
    assertions: evaluation.assertions.map((assertion) => ({
      required: assertion.required,
      result: encodeAssertionResult(assertion.result),
    })),
  };
}

/**
 * Seals Assert-first's immutable runtime result. Durable attachment encoding
 * is intentionally deferred to the Evaluation Record adapter.
 */
export function sealAttemptAssertions<Kind extends "pass" | "score">(
  runtime: AssertionsRuntime<Kind>,
  options: AssertionSealOptions,
  workspaceDiff?: AgentWorkspaceDiff,
): Effect.Effect<SealedAttemptAssertions, AssertionSealError | ScorePayloadBuildError> {
  return runtime.seal(options).pipe(
    Effect.flatMap((sealed) => {
      const facts = assertionEvaluationFacts(sealed.evaluation);
      const score = runtime.evaluationKind === "score" ? buildScorePayload(facts) : undefined;
      if (score !== undefined && Result.isFailure(score)) return Effect.fail(score.failure);
      return Effect.succeed({
        entries: sealed.entries,
        evaluation: sealed.evaluation,
        workspaceDiff,
        verdict: { state: foldVerdict(facts) },
        score: score?.success,
      });
    }),
  );
}
