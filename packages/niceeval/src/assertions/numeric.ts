import { Effect } from "effect";

import type {
  AssertionCriterion,
  BooleanAssertionEvaluation,
  BooleanAssertionRegistration,
  CapturedAssertionSnapshot,
} from "./api.ts";
import { matchedAssertionEvaluation, mismatchedAssertionEvaluation, unavailableAssertionEvaluation } from "./api.ts";
import { evaluateNumericComparison, numericComparisonOf, type BooleanMatch, type NumericMaterial } from "./match.ts";

export type NumericCriterionSubject =
  | { readonly kind: "explicit-value" }
  | {
      readonly kind: "scope-metric";
      readonly metric: "tokens";
      readonly scope: "turn" | "session" | "attempt";
      readonly unit: "tokens";
    }
  | {
      readonly kind: "scope-metric";
      readonly metric: "cost";
      readonly scope: "turn" | "session" | "attempt";
      readonly unit: "usd";
    }
  | {
      readonly kind: "collection-cardinality";
      readonly collection: "tool-calls";
      readonly scope: "turn" | "session" | "attempt";
    };

function numericCriterion(
  match: BooleanMatch<number, number, "value">,
  subject: NumericCriterionSubject,
): AssertionCriterion {
  const comparison = numericComparisonOf(match);
  if (comparison === undefined) {
    throw new TypeError("numeric assertion registration requires a managed numeric matcher");
  }
  return {
    kind: "value-match" as const,
    numeric: {
      ...comparison,
      subject,
    },
  };
}

/**
 * Private registration primitive shared by explicit values and scope metrics.
 * It owns criterion encoding input and the sole numeric material evaluator.
 */
export function numericBooleanRegistration<Refined>(input: {
  readonly match: BooleanMatch<number, number, "value">;
  readonly criterionSubject: NumericCriterionSubject;
  readonly material: NumericMaterial<import("./quantity.ts").Unit | undefined>;
  readonly captured: CapturedAssertionSnapshot;
  readonly matchedValue: (value: number) => Refined;
}): BooleanAssertionRegistration<Refined> {
  const comparison = numericComparisonOf(input.match);
  if (comparison === undefined) {
    throw new TypeError("numeric assertion registration requires a managed numeric matcher");
  }
  return {
    criterion: numericCriterion(input.match, input.criterionSubject),
    subject: input.captured.material,
    coverage: input.captured.coverage,
    limitations: input.captured.limitations,
    evaluate: () =>
      Effect.sync((): BooleanAssertionEvaluation<Refined> => {
        const result = evaluateNumericComparison(input.material, comparison);
        if (result.state === "matched") {
          return matchedAssertionEvaluation(input.matchedValue(result.value));
        }
        if (result.state === "mismatched") {
          return mismatchedAssertionEvaluation(result.diagnostic);
        }
        return unavailableAssertionEvaluation("source-unavailable", result.diagnostic);
      }),
    terminalEvidence: () => [],
    interruptedMatcherArtifact: undefined,
    terminalCriterion: () => numericCriterion(input.match, input.criterionSubject),
    terminalReceipt: () => undefined,
    evidence: [],
  };
}
