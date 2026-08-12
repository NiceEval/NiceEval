import { Schema } from "effect";
import { SealedAssertionResultV1Schema as AssertionsSealedAssertionResultV1Schema } from "../../assertions/record/codec.ts";
import type {
  EarnedScoreContributionV1,
  GateDispositionV1,
  NoScoreContributionV1,
  ScoreContributionV1,
  SealedAssertionResultV1,
  UnavailableScoreContributionV1,
} from "../../assertions/record/model.ts";

/**
 * Eval folds consume the Assertions owner's sealed-result contract directly.
 * They deliberately do not re-own the Assertions Attachment or its blob
 * closure; `required` below is Eval producer policy only.
 */
export {
  AssertionsSealedAssertionResultV1Schema as SealedAssertionResultV1Schema,
};

export type {
  EarnedScoreContributionV1,
  GateDispositionV1,
  NoScoreContributionV1,
  ScoreContributionV1,
  SealedAssertionResultV1,
  UnavailableScoreContributionV1,
};

/**
 * `required` is producer policy, not a field added to the Assertions
 * Attachment. It determines whether an otherwise-local unavailable result
 * raises the Attempt Verdict to errored.
 */
export const SealedAssertionForEvaluationV1Schema = Schema.Struct({
  required: Schema.Boolean,
  result: AssertionsSealedAssertionResultV1Schema,
});

export type SealedAssertionForEvaluationV1 = Schema.Schema.Type<
  typeof SealedAssertionForEvaluationV1Schema
>;

/** All producer facts shared by the independent Verdict and Score folds. */
export const EvaluationAttemptFactsV1Schema = Schema.Struct({
  execution: Schema.Literal("completed", "errored"),
  explicitlySkipped: Schema.Boolean,
  assertions: Schema.Array(SealedAssertionForEvaluationV1Schema),
});

export type EvaluationAttemptFactsV1 = Schema.Schema.Type<
  typeof EvaluationAttemptFactsV1Schema
>;

export function isRequiredAssertionUnavailableOrErroredV1(
  assertion: SealedAssertionForEvaluationV1,
): boolean {
  return assertion.required && (
    assertion.result.state === "unavailable"
    || assertion.result.state === "errored"
  );
}

export function isGateFailedV1(
  assertion: SealedAssertionForEvaluationV1,
): boolean {
  return assertion.result.gate === "failed";
}
