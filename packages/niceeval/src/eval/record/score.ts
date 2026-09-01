import { Result, Schema } from "effect";
import {
  ExactEvaluationParseOptions,
  FiniteNonNegativeNumberSchema,
  type FiniteNonNegativeNumber,
} from "./attachment.ts";
import {
  EvaluationAttemptFactsSchema,
  recordedAttemptFacts,
  type EvaluationAttemptFacts,
} from "./sealed-assertion.ts";
import type { AssertionsAttachment } from "../../record/family/assertions/definition.ts";
import type { AttemptOutcome } from "../../record/model/core.ts";

/** Score is an Analysis calculation, not an independently persisted family. */
export const ScoreStateSchema = Schema.Literals([
  "complete",
  "partial",
  "unavailable",
]);
export type ScoreState = Schema.toType<typeof ScoreStateSchema>["Type"];

export const ScoreIncompleteReasonSchema = Schema.Literals([
  "execution-errored",
  "source-unavailable",
  "evaluation-errored",
  "not-applicable",
]);
export type ScoreIncompleteReason = Schema.toType<typeof ScoreIncompleteReasonSchema>["Type"];
export const ScoreIncompleteReasonsSchema = Schema.NonEmptyArray(
  ScoreIncompleteReasonSchema,
);
export type ScoreIncompleteReasons = Schema.toType<typeof ScoreIncompleteReasonsSchema>["Type"];

export const EarnedScoreSchema = FiniteNonNegativeNumberSchema;
export type EarnedScore = FiniteNonNegativeNumber;

const ScorePayloadStructuralSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("complete"), earned: EarnedScoreSchema }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    earned: EarnedScoreSchema,
    reasons: ScoreIncompleteReasonsSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reasons: ScoreIncompleteReasonsSchema,
  }),
]);

export type ScorePayload = Schema.toType<typeof ScorePayloadStructuralSchema>["Type"];
export type ScorePayloadEncoded = Schema.Codec.Encoded<
  typeof ScorePayloadStructuralSchema
>;

export type ScorePayloadIssue =
  | { readonly code: "score-incomplete-reason-duplicate"; readonly reason: ScoreIncompleteReason }
  | {
      readonly code: "score-incomplete-reason-order-invalid";
      readonly index: number;
      readonly reason: ScoreIncompleteReason;
    };

function scoreIncompleteReasonRank(reason: ScoreIncompleteReason): number {
  switch (reason) {
    case "execution-errored": return 0;
    case "source-unavailable": return 1;
    case "evaluation-errored": return 2;
    case "not-applicable": return 3;
  }
}

function incompleteReasonsOf(payload: ScorePayload): readonly ScoreIncompleteReason[] {
  return payload.state === "complete" ? [] : payload.reasons;
}

export function validateScorePayload(
  payload: ScorePayload,
): readonly ScorePayloadIssue[] {
  const issues: ScorePayloadIssue[] = [];
  const seen = new Set<ScoreIncompleteReason>();
  let previousRank: number | undefined;
  for (const [index, reason] of incompleteReasonsOf(payload).entries()) {
    const rank = scoreIncompleteReasonRank(reason);
    if (seen.has(reason)) {
      issues.push(Object.freeze({ code: "score-incomplete-reason-duplicate" as const, reason }));
    } else if (previousRank !== undefined && previousRank >= rank) {
      issues.push(Object.freeze({ code: "score-incomplete-reason-order-invalid" as const, index, reason }));
    }
    seen.add(reason);
    previousRank = rank;
  }
  return Object.freeze(issues);
}

export const ScorePayloadSchema = ScorePayloadStructuralSchema.pipe(
  Schema.refine((payload): payload is typeof payload => validateScorePayload(payload).length === 0, {
    identifier: "ScoreCalculation",
    description: "a canonical transient score calculation",
  }),
);

export type ScoreFoldInput = EvaluationAttemptFacts;
export const ScoreFoldInputSchema = EvaluationAttemptFactsSchema;
export type ScoreBuildInput = ScoreFoldInput;
export const ScoreBuildInputSchema = ScoreFoldInputSchema;

export type ScorePayloadBuildError =
  | { readonly code: "score-fold-input-invalid" }
  | { readonly code: "score-earned-overflow" };

function canonicalIncompleteReasons(
  reasons: readonly ScoreIncompleteReason[],
): readonly ScoreIncompleteReason[] {
  return Object.freeze([...new Set(reasons)].sort(
    (left, right) => scoreIncompleteReasonRank(left) - scoreIncompleteReasonRank(right),
  ));
}

function asNonEmptyReasons(
  reasons: readonly ScoreIncompleteReason[],
): ScoreIncompleteReasons | undefined {
  const [first, ...rest] = reasons;
  return first === undefined ? undefined : Object.freeze([first, ...rest]);
}

/** Folds sealed Assertion facts without producing a durable Record write. */
export function buildScorePayload(
  input: ScoreFoldInput,
): Result.Result<ScorePayload, ScorePayloadBuildError> {
  const decoded = Schema.decodeUnknownResult(
    Schema.toType(ScoreFoldInputSchema),
    ExactEvaluationParseOptions,
  )(input);
  if (Result.isFailure(decoded)) {
    return Result.fail(Object.freeze({ code: "score-fold-input-invalid" as const }));
  }

  let earned = 0;
  let hasAuditableContribution = false;
  const incompleteReasons: ScoreIncompleteReason[] = [];
  for (const assertion of decoded.success.assertions) {
    switch (assertion.result.score.state) {
      case "not-scored": break;
      case "earned":
        hasAuditableContribution = true;
        earned += assertion.result.score.earned;
        if (!Number.isFinite(earned)) {
          return Result.fail(Object.freeze({ code: "score-earned-overflow" as const }));
        }
        break;
      case "unavailable":
        if (assertion.required) incompleteReasons.push(assertion.result.score.reason);
        break;
    }
  }
  if (decoded.success.execution === "errored") incompleteReasons.push("execution-errored");
  const reasons = canonicalIncompleteReasons(incompleteReasons);
  if (reasons.length === 0) return Result.succeed(Object.freeze({ state: "complete" as const, earned }));
  const nonEmptyReasons = asNonEmptyReasons(reasons);
  if (nonEmptyReasons === undefined) throw new Error("Non-empty score reasons became empty");
  return hasAuditableContribution
    ? Result.succeed(Object.freeze({ state: "partial" as const, earned, reasons: nonEmptyReasons }))
    : Result.succeed(Object.freeze({ state: "unavailable" as const, reasons: nonEmptyReasons }));
}

/** Folds Score from the same immutable Record/Core facts as Verdict. */
export function foldRecordedAttemptScore(input: {
  readonly outcome: AttemptOutcome;
  readonly assertions: AssertionsAttachment;
}): Result.Result<ScorePayload, ScorePayloadBuildError> {
  return buildScorePayload(recordedAttemptFacts(input));
}

export type ScoreCoherenceIssue =
  | { readonly code: "score-fold-input-invalid"; readonly reason: ScorePayloadBuildError["code"] }
  | { readonly code: "score-payload-mismatch" };

function sameReasons(left: readonly ScoreIncompleteReason[], right: readonly ScoreIncompleteReason[]): boolean {
  return left.length === right.length && left.every((reason, index) => reason === right[index]);
}

function sameScorePayload(left: ScorePayload, right: ScorePayload): boolean {
  if (left.state !== right.state) return false;
  if (left.state === "complete") return right.state === "complete" && left.earned === right.earned;
  if (left.state === "partial") return right.state === "partial" && left.earned === right.earned && sameReasons(left.reasons, right.reasons);
  return right.state === "unavailable" && sameReasons(left.reasons, right.reasons);
}

export function validateScoreCoherence(input: {
  readonly payload: ScorePayload;
  readonly fold: ScoreFoldInput;
}): readonly ScoreCoherenceIssue[] {
  const expected = buildScorePayload(input.fold);
  if (Result.isFailure(expected)) {
    return Object.freeze([Object.freeze({ code: "score-fold-input-invalid" as const, reason: expected.failure.code })]);
  }
  return sameScorePayload(input.payload, expected.success)
    ? Object.freeze([])
    : Object.freeze([Object.freeze({ code: "score-payload-mismatch" as const })]);
}

export type Score =
  | { readonly state: "complete"; readonly earned: number; readonly comparable: true }
  | { readonly state: "partial"; readonly earned: number; readonly reasons: ScoreIncompleteReasons; readonly comparable: false }
  | { readonly state: "unavailable"; readonly reasons: ScoreIncompleteReasons; readonly comparable: false };
export type ScoreProjection = Score;

function scoreIncompleteReasons(reasons: readonly ScoreIncompleteReason[]): ScoreIncompleteReasons {
  const [first, ...rest] = reasons;
  if (first === undefined) throw new Error("An incomplete score needs a reason");
  return Object.freeze([first, ...rest]);
}

export function projectScorePayload(payload: ScorePayload): Score {
  switch (payload.state) {
    case "complete": return Object.freeze({ state: "complete" as const, earned: payload.earned, comparable: true as const });
    case "partial": return Object.freeze({ state: "partial" as const, earned: payload.earned, reasons: scoreIncompleteReasons(payload.reasons), comparable: false as const });
    case "unavailable": return Object.freeze({ state: "unavailable" as const, reasons: scoreIncompleteReasons(payload.reasons), comparable: false as const });
  }
}
