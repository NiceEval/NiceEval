import { Schema } from "effect";

/**
 * Eval-only exact decoding options. Eval plans and calculations are transient:
 * Record v1 does not give them their own Attachment family.
 */
export const ExactEvaluationParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

/** A path-derived Eval or Experiment identity used only by planning code. */
export const EvaluationRecordIdentitySchema = Schema.String.pipe(
  Schema.filter(
    (value) => value.length > 0 && !value.includes("\u0000"),
    {
      identifier: "EvaluationRecordIdentity",
      description: "a non-empty identity string without NUL",
    },
  ),
);

/** Shared numeric boundary for transient score calculations. */
export const FiniteNonNegativeNumberSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.nonNegative(),
);

export type FiniteNonNegativeNumber = Schema.Schema.Type<
  typeof FiniteNonNegativeNumberSchema
>;
