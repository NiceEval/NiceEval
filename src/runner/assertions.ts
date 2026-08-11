import { randomBytes } from "node:crypto";

import { Effect, Either } from "effect";

import type {
  AssertionSealErrorV1,
  AssertionSealOptionsV1,
  AssertionsRuntimeV1,
  SealedAssertionEvaluationV1,
  SealedAssertionsRuntimeV1,
} from "../assertions/api.ts";
import {
  createAssertionsAttachmentProducerV1,
  type AssertionsAttachmentEntryInputV1,
} from "../assertions/record/attachment.ts";
import type { AssertionsProducerErrorV1 } from "../assertions/record/producer.ts";
import type { RecordAttachmentWrite } from "../record/attachment/index.ts";
import type { EvaluationRecordOriginAttemptInputV1 } from "../eval/record/evaluation-record.ts";
import type { SlotId } from "../record/model/identifiers.ts";
import {
  buildScorePayloadV1,
  type ScorePayloadBuildErrorV1,
  type ScorePayloadV1,
} from "../eval/record/score.ts";
import {
  buildVerdictPayloadV1,
  type VerdictPayloadV1,
} from "../eval/record/verdict.ts";
import type { EvaluationAttemptFactsV1 } from "../eval/record/sealed-assertion.ts";

/**
 * Evaluation's existing folds still accept this historical shape. Keeping the
 * type confined here prevents it from becoming an authoring or Runner model.
 */
function evaluationFoldInput(
  evaluation: SealedAssertionEvaluationV1,
): EvaluationAttemptFactsV1 {
  return evaluation as EvaluationAttemptFactsV1;
}

/**
 * The one Attempt-local result that is allowed to cross from authoring into
 * Evaluation. The sealed evaluation, Verdict, Score, and real Assertions attachment all
 * originate from one sealed declaration-order entry sequence.
 */
export interface SealedAttemptAssertionsV1 {
  readonly entries: SealedAssertionsRuntimeV1["entries"];
  readonly evaluation: SealedAssertionEvaluationV1;
  readonly assertions: RecordAttachmentWrite<"attempt", never, never>;
  readonly verdict: VerdictPayloadV1;
  readonly score?: ScorePayloadV1;
}

/** Typed producer boundary; Record coordination remains the owner of writes. */
export type AttemptAssertionsSealErrorV1 =
  | AssertionSealErrorV1
  | {
      readonly _tag: "AttemptAssertionsSealErrorV1";
      readonly code: "assertions-attachment-invalid";
      readonly issue: AssertionsProducerErrorV1;
    }
  | {
      readonly _tag: "AttemptAssertionsSealErrorV1";
      readonly code: "score-payload-invalid";
      readonly issue: ScorePayloadBuildErrorV1;
    };

function assertionEntryId(): string {
  return `ae_${randomBytes(10).toString("hex")}`;
}

function attachmentInvalid(
  issue: AssertionsProducerErrorV1,
): AttemptAssertionsSealErrorV1 {
  return Object.freeze({
    _tag: "AttemptAssertionsSealErrorV1" as const,
    code: "assertions-attachment-invalid" as const,
    issue,
  });
}

function scoreInvalid(
  issue: ScorePayloadBuildErrorV1,
): AttemptAssertionsSealErrorV1 {
  return Object.freeze({
    _tag: "AttemptAssertionsSealErrorV1" as const,
    code: "score-payload-invalid" as const,
    issue,
  });
}

function materializeSealedAssertions(
  sealed: SealedAssertionsRuntimeV1,
  evaluationKind: "pass" | "score",
): Either.Either<SealedAttemptAssertionsV1, AttemptAssertionsSealErrorV1> {
  const producer = createAssertionsAttachmentProducerV1<never, never>({
    entryIds: { next: assertionEntryId },
  });
  for (const entry of sealed.entries) {
    const appended = producer.append(
      entry as AssertionsAttachmentEntryInputV1<never, never>,
    );
    if (Either.isLeft(appended)) return Either.left(attachmentInvalid(appended.left));
  }
  const assertions = producer.seal();
  if (Either.isLeft(assertions)) return Either.left(attachmentInvalid(assertions.left));

  if (evaluationKind === "pass") {
    const evaluation = evaluationFoldInput(sealed.evaluation);
    return Either.right(Object.freeze({
      entries: sealed.entries,
      evaluation: sealed.evaluation,
      assertions: assertions.right,
      verdict: buildVerdictPayloadV1(evaluation),
    }));
  }

  const evaluation = evaluationFoldInput(sealed.evaluation);
  const score = buildScorePayloadV1(evaluation);
  if (Either.isLeft(score)) return Either.left(scoreInvalid(score.left));
  return Either.right(Object.freeze({
    entries: sealed.entries,
    evaluation: sealed.evaluation,
    assertions: assertions.right,
    verdict: buildVerdictPayloadV1(evaluation),
    score: score.right,
  }));
}

/**
 * Runs the only Assert-first closure at the Runner's Effect boundary. It does
 * not open a Record session or reproduce EvaluationRecordContract validation.
 */
export function sealAttemptAssertionsV1<Kind extends "pass" | "score">(
  runtime: AssertionsRuntimeV1<Kind>,
  options: AssertionSealOptionsV1,
): Effect.Effect<SealedAttemptAssertionsV1, AttemptAssertionsSealErrorV1> {
  return runtime.seal(options).pipe(
    Effect.flatMap((sealed) => {
      const materialized = materializeSealedAssertions(sealed, runtime.evaluationKind);
      return Either.isLeft(materialized)
        ? Effect.fail(materialized.left)
        : Effect.succeed(materialized.right);
    }),
  );
}

/**
 * The future invocation coordinator feeds this directly to the existing
 * EvaluationRecordContractV1. This adapter deliberately does no Record I/O.
 */
export function evaluationRecordOriginInputFromAssertionsV1(
  slotId: SlotId,
  sealed: SealedAttemptAssertionsV1,
): EvaluationRecordOriginAttemptInputV1 {
  return Object.freeze({
    slotId,
    // EvaluationRecordContractV1 still names this required compatibility
    // field `facts`. This is the sole legacy-name bridge; no Runner or
    // authoring API uses that model.
    facts: evaluationFoldInput(sealed.evaluation),
    assertions: sealed.assertions,
    verdict: sealed.verdict,
    ...(sealed.score === undefined ? {} : { score: sealed.score }),
  });
}
