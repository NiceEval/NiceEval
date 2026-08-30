import { Schema } from "effect";
import { SealedAssertionResultSchema as AssertionsSealedAssertionResultSchema } from "../../assertions/record/codec.ts";
import type {
  EarnedScoreContribution,
  GateDisposition,
  NoScoreContribution,
  ScoreContribution,
  SealedAssertionResult,
  UnavailableScoreContribution,
} from "../../assertions/record/model.ts";
import { sealedAssertionResult } from "../../assertions/record/model.ts";
import type { AssertionsAttachment } from "../../record/family/assertions/definition.ts";
import type { AttemptOutcome } from "../../record/model/core.ts";

/**
 * Eval folds consume the Assertions owner's sealed-result contract directly.
 * They deliberately do not re-own the Assertions Attachment or its blob
 * closure; `required` below is Eval producer policy only.
 */
export {
  AssertionsSealedAssertionResultSchema as SealedAssertionResultSchema,
};

export type {
  EarnedScoreContribution,
  GateDisposition,
  NoScoreContribution,
  ScoreContribution,
  SealedAssertionResult,
  UnavailableScoreContribution,
};

/**
 * `required` is producer policy, not a field added to the Assertions
 * Attachment. It determines whether an otherwise-local unavailable result
 * raises the Attempt Verdict to errored.
 */
export const SealedAssertionForEvaluationSchema = Schema.Struct({
  required: Schema.Boolean,
  result: AssertionsSealedAssertionResultSchema,
});

export type SealedAssertionForEvaluation = Schema.toType<typeof SealedAssertionForEvaluationSchema>["Type"];

/** All producer facts shared by the independent Verdict and Score folds. */
export const EvaluationAttemptFactsSchema = Schema.Struct({
  execution: Schema.Literals(["completed", "errored"]),
  explicitlySkipped: Schema.Boolean,
  assertions: Schema.Array(SealedAssertionForEvaluationSchema),
});

export type EvaluationAttemptFacts = Schema.toType<typeof EvaluationAttemptFactsSchema>["Type"];

/** The sole Record/Core adapter shared by the canonical Verdict and Score folds. */
export function recordedAttemptFacts(input: {
  readonly outcome: AttemptOutcome;
  readonly assertions: AssertionsAttachment;
}): EvaluationAttemptFacts {
  return Object.freeze({
    execution: input.outcome === "errored" || input.outcome === "interrupted"
      ? "errored" as const
      : "completed" as const,
    explicitlySkipped: input.outcome === "cancelled",
    assertions: Object.freeze(input.assertions.entries.map((entry) => Object.freeze({
      required: entry.policy.requirement.state === "available" && entry.policy.requirement.value === "required",
      result: sealedAssertionResult(entry),
    }))),
  });
}

export function isRequiredAssertionUnavailableOrErrored(
  assertion: SealedAssertionForEvaluation,
): boolean {
  return assertion.required && (
    assertion.result.state === "unavailable"
    || assertion.result.state === "errored"
  );
}

export function isGateFailed(
  assertion: SealedAssertionForEvaluation,
): boolean {
  return assertion.result.gate === "failed";
}
