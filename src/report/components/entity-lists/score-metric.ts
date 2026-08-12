// Score-facing legacy component data consumes the report Calculation boundary,
// never a result-record evaluation shell. The Calculation owner is responsible
// for obtaining its value from the declared Score projection.

import { totalScore } from "../../model/calculation.ts";
import type { AttemptMetric } from "../../model/types.ts";

function requiredReduction(
  stage: "within an eval" | "across evals",
  reduce: (values: readonly number[]) => number | null,
): (values: readonly number[]) => number {
  return (values) => {
    const value = reduce(values);
    if (value === null) {
      throw new Error(`Score Calculation produced no value ${stage} despite receiving values.`);
    }
    return value;
  };
}

/**
 * The existing component-data shape still carries score cells. Keep their
 * aggregation policy behind the public Calculation boundary so callers do not
 * inspect an Attempt's retired evaluation payload directly.
 */
export const assessmentScoreMetric: AttemptMetric<"assessment-score"> = {
  name: "assessment-score",
  label: { en: "Score", "zh-CN": "得分" },
  description: "Score from the declared Score assessment projection.",
  better: "higher",
  bounds: { min: 0 },
  value: (attempt) => totalScore.value(attempt),
  perEval: requiredReduction("within an eval", totalScore.withinEval),
  acrossEvals: requiredReduction("across evals", totalScore.acrossEvals),
};
