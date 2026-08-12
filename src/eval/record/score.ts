import { Either, Schema } from "effect";
import {
  decodeJsonRecordAttachmentPayload,
  defineRecordAttachmentFamily,
  type RecordAttachmentPayloadSnapshot,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import {
  defineRecordAttachmentProjector,
  type RecordAttachmentProjector,
} from "../../projection/projector.ts";
import {
  ExactRecordAttachmentParseOptions,
  FiniteNonNegativeNumberV1Schema,
  makeNoBlobRecordAttachmentWriteV1,
  noRecordAttachmentBlobs,
  requireRecordAttachmentCapabilityV1,
  type FiniteNonNegativeNumberV1,
} from "./attachment.ts";
import {
  EvaluationAttemptFactsV1Schema,
  type EvaluationAttemptFactsV1,
} from "./sealed-assertion.ts";

export const SCORE_ATTACHMENT_NAME_V1 = "niceeval.score" as const;
export const SCORE_ATTACHMENT_SCHEMA_ID_V1 = "niceeval.score/v1" as const;

export const ScoreStateV1Schema = Schema.Literal(
  "complete",
  "partial",
  "unavailable",
);

export type ScoreStateV1 = Schema.Schema.Type<typeof ScoreStateV1Schema>;

/** These are the only reasons that can make a sealed score source incomplete. */
export const ScoreIncompleteReasonV1Schema = Schema.Literal(
  "execution-errored",
  "source-unavailable",
  "evaluation-errored",
  "not-applicable",
);

export type ScoreIncompleteReasonV1 = Schema.Schema.Type<
  typeof ScoreIncompleteReasonV1Schema
>;

export const ScoreIncompleteReasonsV1Schema = Schema.NonEmptyArray(
  ScoreIncompleteReasonV1Schema,
);

export type ScoreIncompleteReasonsV1 = Schema.Schema.Type<
  typeof ScoreIncompleteReasonsV1Schema
>;

/** A formal earned score: finite, non-negative, and never a percentage/max. */
export const EarnedScoreV1Schema = FiniteNonNegativeNumberV1Schema;
export type EarnedScoreV1 = FiniteNonNegativeNumberV1;

const ScoreCompletePayloadV1Schema = Schema.Struct({
  state: Schema.Literal("complete"),
  earned: EarnedScoreV1Schema,
});

const ScorePartialPayloadV1Schema = Schema.Struct({
  state: Schema.Literal("partial"),
  earned: EarnedScoreV1Schema,
  reasons: ScoreIncompleteReasonsV1Schema,
});

const ScoreUnavailablePayloadV1Schema = Schema.Struct({
  state: Schema.Literal("unavailable"),
  reasons: ScoreIncompleteReasonsV1Schema,
});

const ScorePayloadV1StructuralSchema = Schema.Union(
  ScoreCompletePayloadV1Schema,
  ScorePartialPayloadV1Schema,
  ScoreUnavailablePayloadV1Schema,
);

export type ScorePayloadV1 = Schema.Schema.Type<
  typeof ScorePayloadV1StructuralSchema
>;

export type ScorePayloadV1Encoded = Schema.Schema.Encoded<
  typeof ScorePayloadV1StructuralSchema
>;

export type ScorePayloadIssueV1 =
  | {
      readonly code: "score-incomplete-reason-duplicate";
      readonly reason: ScoreIncompleteReasonV1;
    }
  | {
      readonly code: "score-incomplete-reason-order-invalid";
      readonly index: number;
      readonly reason: ScoreIncompleteReasonV1;
    };

function scoreIncompleteReasonRank(reason: ScoreIncompleteReasonV1): number {
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

function incompleteReasonsOf(
  payload: ScorePayloadV1,
): readonly ScoreIncompleteReasonV1[] {
  return payload.state === "complete" ? [] : payload.reasons;
}

/** Ensures reason arrays preserve all causes exactly once in a stable order. */
export function validateScorePayloadV1(
  payload: ScorePayloadV1,
): readonly ScorePayloadIssueV1[] {
  const issues: ScorePayloadIssueV1[] = [];
  const seen = new Set<ScoreIncompleteReasonV1>();
  let previousRank: number | undefined;

  for (const [index, reason] of incompleteReasonsOf(payload).entries()) {
    const rank = scoreIncompleteReasonRank(reason);
    if (seen.has(reason)) {
      issues.push(
        Object.freeze({
          code: "score-incomplete-reason-duplicate" as const,
          reason,
        }),
      );
    } else if (previousRank !== undefined && previousRank >= rank) {
      issues.push(
        Object.freeze({
          code: "score-incomplete-reason-order-invalid" as const,
          index,
          reason,
        }),
      );
    }
    seen.add(reason);
    previousRank = rank;
  }

  return Object.freeze(issues);
}

/** Exact JSON schema for `niceeval.score/v1`. */
export const ScorePayloadV1Schema = ScorePayloadV1StructuralSchema.pipe(
  Schema.filter(
    (payload) => validateScorePayloadV1(payload).length === 0,
    {
      identifier: "ScorePayloadV1",
      description:
        "a complete, partial, or unavailable score with canonical incomplete reasons",
    },
  ),
);

/** The built-in Attempt Attachment definition owns exact decode and closure. */
export const scoreAttachmentDefinitionV1 = requireRecordAttachmentCapabilityV1(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: SCORE_ATTACHMENT_NAME_V1,
    schemaId: SCORE_ATTACHMENT_SCHEMA_ID_V1,
    schema: ScorePayloadV1Schema,
    blobRefs: noRecordAttachmentBlobs,
  }),
  "Score v1 RecordAttachment definition must be valid",
);

export const scoreAttachmentFamilyV1 = requireRecordAttachmentCapabilityV1(
  defineRecordAttachmentFamily({
    current: scoreAttachmentDefinitionV1,
    migrations: [],
  }),
  "Score v1 RecordAttachment family must be valid",
);

export function decodeScorePayloadV1(input: unknown) {
  return decodeJsonRecordAttachmentPayload(scoreAttachmentDefinitionV1, input);
}

/**
 * Score reads the same sealed producer facts as Verdict but intentionally uses
 * only `result.score` plus execution status. Gate and skip do not rewrite an
 * earned contribution.
 */
export type ScoreFoldInputV1 = EvaluationAttemptFactsV1;
export const ScoreFoldInputV1Schema = EvaluationAttemptFactsV1Schema;

/** Backward-neutral name for callers that construct the Attachment before writing. */
export type ScoreBuildInputV1 = ScoreFoldInputV1;
export const ScoreBuildInputV1Schema = ScoreFoldInputV1Schema;

export type ScorePayloadBuildErrorV1 =
  | { readonly code: "score-fold-input-invalid" }
  | { readonly code: "score-earned-overflow" };

function canonicalIncompleteReasons(
  reasons: readonly ScoreIncompleteReasonV1[],
): readonly ScoreIncompleteReasonV1[] {
  return Object.freeze(
    [...new Set(reasons)].sort(
      (left, right) =>
        scoreIncompleteReasonRank(left) - scoreIncompleteReasonRank(right),
    ),
  );
}

function asNonEmptyReasons(
  reasons: readonly ScoreIncompleteReasonV1[],
): ScoreIncompleteReasonsV1 | undefined {
  const [first, ...rest] = reasons;
  return first === undefined ? undefined : Object.freeze([first, ...rest]);
}

/**
 * Produces Score state from sealed Score contributions. A gate failure is
 * absent by design; a non-score required Assertion can therefore make Verdict
 * errored while an already-complete Score stays complete.
 */
export function buildScorePayloadV1(
  input: ScoreFoldInputV1,
): Either.Either<ScorePayloadV1, ScorePayloadBuildErrorV1> {
  const decoded = Schema.decodeUnknownEither(
    ScoreFoldInputV1Schema,
    ExactRecordAttachmentParseOptions,
  )(input);
  if (Either.isLeft(decoded)) {
    return Either.left(
      Object.freeze({ code: "score-fold-input-invalid" as const }),
    );
  }

  let earned = 0;
  let hasAuditableContribution = false;
  const incompleteReasons: ScoreIncompleteReasonV1[] = [];

  for (const assertion of decoded.right.assertions) {
    const contribution = assertion.result.score;
    switch (contribution.state) {
      case "not-scored":
        break;
      case "earned":
        hasAuditableContribution = true;
        earned += contribution.earned;
        if (!Number.isFinite(earned)) {
          return Either.left(
            Object.freeze({ code: "score-earned-overflow" as const }),
          );
        }
        break;
      case "unavailable":
        if (assertion.required) {
          incompleteReasons.push(contribution.reason);
        }
        break;
    }
  }

  if (decoded.right.execution === "errored") {
    incompleteReasons.push("execution-errored");
  }

  const reasons = canonicalIncompleteReasons(incompleteReasons);
  if (reasons.length === 0) {
    return Either.right(
      Object.freeze({ state: "complete" as const, earned }),
    );
  }

  const nonEmptyReasons = asNonEmptyReasons(reasons);
  if (nonEmptyReasons === undefined) {
    throw new Error("A non-empty incomplete-reason list became empty");
  }

  return hasAuditableContribution
    ? Either.right(
        Object.freeze({
          state: "partial" as const,
          earned,
          reasons: nonEmptyReasons,
        }),
      )
    : Either.right(
        Object.freeze({
          state: "unavailable" as const,
          reasons: nonEmptyReasons,
        }),
  );
}

/** Wraps an already validated durable Score payload in its Attempt Attachment. */
export function createScoreAttachmentWriteV1(
  payload: ScorePayloadV1,
): RecordAttachmentWrite<"attempt", never, never> {
  return makeNoBlobRecordAttachmentWriteV1(scoreAttachmentFamilyV1, payload);
}

/** Builds the real Attempt-owned Score write from sealed score contributions. */
export function buildScoreAttachmentWriteV1(
  input: ScoreFoldInputV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  ScorePayloadBuildErrorV1
> {
  const payload = buildScorePayloadV1(input);
  if (Either.isLeft(payload)) {
    return Either.left(payload.left);
  }
  return Either.right(createScoreAttachmentWriteV1(payload.right));
}

export type ScoreCoherenceIssueV1 =
  | {
      readonly code: "score-fold-input-invalid";
      readonly reason: ScorePayloadBuildErrorV1["code"];
    }
  | { readonly code: "score-payload-mismatch" };

function sameScorePayload(
  left: ScorePayloadV1,
  right: ScorePayloadV1,
): boolean {
  if (left.state !== right.state) return false;
  if (left.state === "complete") {
    return right.state === "complete" && left.earned === right.earned;
  }
  if (left.state === "partial") {
    return (
      right.state === "partial"
      && left.earned === right.earned
      && sameReasons(left.reasons, right.reasons)
    );
  }
  return right.state === "unavailable" && sameReasons(left.reasons, right.reasons);
}

function sameReasons(
  left: readonly ScoreIncompleteReasonV1[],
  right: readonly ScoreIncompleteReasonV1[],
): boolean {
  return left.length === right.length && left.every((reason, index) => reason === right[index]);
}

/** Confirms persisted score is exactly what the shared sealed facts produce. */
export function validateScoreCoherenceV1(input: {
  readonly payload: ScorePayloadV1;
  readonly fold: ScoreFoldInputV1;
}): readonly ScoreCoherenceIssueV1[] {
  const expected = buildScorePayloadV1(input.fold);
  if (Either.isLeft(expected)) {
    return Object.freeze([
      Object.freeze({
        code: "score-fold-input-invalid" as const,
        reason: expected.left.code,
      }),
    ]);
  }
  return sameScorePayload(input.payload, expected.right)
    ? []
    : Object.freeze([
        Object.freeze({ code: "score-payload-mismatch" as const }),
      ]);
}

/** A semantic reason why a Score is not a complete ranking value. */
export type ScoreIncompleteReason =
  | "execution-errored"
  | "source-unavailable"
  | "evaluation-errored"
  | "not-applicable";

export type ScoreIncompleteReasons = readonly [
  ScoreIncompleteReason,
  ...ScoreIncompleteReason[],
];

/** Score keeps partial and unavailable as ordinary, non-ranking values. */
export type Score =
  | { readonly state: "complete"; readonly earned: number; readonly comparable: true }
  | {
      readonly state: "partial";
      readonly earned: number;
      readonly reasons: ScoreIncompleteReasons;
      readonly comparable: false;
    }
  | {
      readonly state: "unavailable";
      readonly reasons: ScoreIncompleteReasons;
      readonly comparable: false;
    };

/** @internal The historical name remains for existing producer-only consumers. */
export type ScoreProjectionV1 = Score;

function scoreIncompleteReasons(
  reasons: readonly ScoreIncompleteReason[],
): ScoreIncompleteReasons {
  const [first, ...rest] = reasons;
  if (first === undefined) {
    throw new Error("A persisted incomplete Score must retain at least one reason");
  }
  return Object.freeze([first, ...rest]);
}

export function projectScorePayloadV1(
  payload: RecordAttachmentPayloadSnapshot<ScorePayloadV1>,
): Score {
  switch (payload.state) {
    case "complete":
      return Object.freeze({
        state: "complete" as const,
        earned: payload.earned,
        comparable: true as const,
      });
    case "partial":
      return Object.freeze({
        state: "partial" as const,
        earned: payload.earned,
        reasons: scoreIncompleteReasons(payload.reasons),
        comparable: false as const,
      });
    case "unavailable":
      return Object.freeze({
        state: "unavailable" as const,
        reasons: scoreIncompleteReasons(payload.reasons),
        comparable: false as const,
      });
  }
}

/** A typed, synchronous projection over an available Score Attachment. */
export function projectScoreAttachmentV1(
  value: RecordAttachmentValue<ScorePayloadV1>,
): Score {
  // Record has already exact-decoded and frozen every available payload.
  return projectScorePayloadV1(value.payload);
}

/** The public Score view for an Attempt-owned Attachment. */
export const scoreProjector: RecordAttachmentProjector<"attempt", Score> =
  defineRecordAttachmentProjector({
    attachment: scoreAttachmentFamilyV1,
    project: projectScoreAttachmentV1,
  });
