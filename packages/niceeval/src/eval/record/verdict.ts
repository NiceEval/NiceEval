import { Schema } from "effect";
import type { AssertionsAttachment } from "../../record/family/assertions/definition.ts";
import { sealedAssertionResult } from "../../assertions/record/model.ts";
import type { AttemptOutcome } from "../../record/model/core.ts";
import { VERDICTS, type Verdict } from "../../shared/types.ts";
import {
  EvaluationAttemptFactsSchema,
  isGateFailed,
  isRequiredAssertionUnavailableOrErrored,
  type EvaluationAttemptFacts,
} from "./sealed-assertion.ts";

/**
 * A transient fold result. Verdict is derived from sealed Assertion facts and
 * Attempt outcome; it is deliberately not a Record Attachment family.
 */
export const VerdictStateSchema = Schema.Literals(VERDICTS);

export type VerdictState = Schema.toType<typeof VerdictStateSchema>["Type"];

export const VerdictPayloadSchema = Schema.Struct({
  state: VerdictStateSchema,
});

export type VerdictPayload = Schema.toType<typeof VerdictPayloadSchema>["Type"];
export type VerdictPayloadEncoded = Schema.Codec.Encoded<
  typeof VerdictPayloadSchema
>;

export type VerdictFoldInput = EvaluationAttemptFacts;
export const VerdictFoldInputSchema = EvaluationAttemptFactsSchema;

export function foldVerdict(input: VerdictFoldInput): VerdictState {
  if (
    input.execution === "errored"
    || input.assertions.some(isRequiredAssertionUnavailableOrErrored)
  ) {
    return "errored";
  }
  if (input.assertions.some(isGateFailed)) return "failed";
  return input.explicitlySkipped ? "skipped" : "passed";
}

/**
 * Folds the public Verdict from the immutable Attempt outcome and verified
 * Assertions payload.  This is the one adapter from Record's terminal Core
 * state into the verdict fold; consumers must not reproduce these rules.
 */
export function foldRecordedAttemptVerdict(input: {
  readonly outcome: AttemptOutcome;
  readonly assertions: AssertionsAttachment;
}): VerdictState {
  return foldVerdict({
    execution: input.outcome === "errored" || input.outcome === "interrupted"
      ? "errored"
      : "completed",
    explicitlySkipped: input.outcome === "cancelled",
    assertions: input.assertions.entries.map((entry: AssertionsAttachment["entries"][number]) => Object.freeze({
      // `unavailable` is a required gate's sealed representation. Entries
      // marked `not-gate` stay optional and cannot invent an execution error.
      required: entry.policy.requirement.state === "available" && entry.policy.requirement.value === "required",
      result: sealedAssertionResult(entry),
    })),
  });
}

export function buildVerdictPayload(
  input: VerdictFoldInput,
): VerdictPayload {
  return Object.freeze({ state: foldVerdict(input) });
}

export type VerdictCoherenceIssue = {
  readonly code: "verdict-fold-mismatch";
  readonly expected: VerdictState;
  readonly actual: VerdictState;
};

export function validateVerdictCoherence(input: {
  readonly payload: VerdictPayload;
  readonly fold: VerdictFoldInput;
}): readonly VerdictCoherenceIssue[] {
  const expected = foldVerdict(input.fold);
  return input.payload.state === expected
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          code: "verdict-fold-mismatch" as const,
          expected,
          actual: input.payload.state,
        }),
      ]);
}

/** Plain domain projection for callers that need NiceEval's public verdict. */
export function projectVerdictPayload(payload: VerdictPayload): Verdict {
  return payload.state;
}
