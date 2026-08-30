import { Effect, Result } from "effect";

import type {
  AssertionSealError,
  AssertionSealOptions,
  AssertionsRuntime,
  SealedAttemptAssertions,
} from "../assertions/api.ts";
import type { AgentWorkspaceDiff } from "../assertions/workspace-diff.ts";
import { buildScorePayload, type ScorePayloadBuildError } from "../eval/record/score.ts";
import { foldVerdict } from "../eval/record/verdict.ts";

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
      const score = runtime.evaluationKind === "score" ? buildScorePayload(sealed.evaluation) : undefined;
      if (score !== undefined && Result.isFailure(score)) return Effect.fail(score.failure);
      return Effect.succeed(Object.freeze({
        entries: sealed.entries,
        evaluation: sealed.evaluation,
        ...(workspaceDiff === undefined ? {} : { workspaceDiff }),
        verdict: Object.freeze({ state: foldVerdict(sealed.evaluation) }),
        ...(score === undefined ? {} : { score: score.success }),
      }));
    }),
  );
}
