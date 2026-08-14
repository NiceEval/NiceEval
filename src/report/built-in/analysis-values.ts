import {
  aggregate,
  allLogicalSlots,
  attemptLatencyMs,
  attemptPassed,
  attemptToolFailure,
  defineMeasure,
  latestCompletedAttempt,
  logicalSlots,
  mean,
  oneValue,
  partial,
  ratio,
  retainContributingEvidence,
  type ClosedRows,
  type MetricValue,
  type Sample,
} from "../../analysis/index.ts";

/**
 * NiceEval's built-in, closed statistical vocabulary. These are Measures, not
 * Report-side calculations: denominator, missingness, and evidence ownership
 * remain in Analysis.
 */
const builtInMeasures = Object.freeze({
  passRate: defineMeasure({
    id: "niceeval.builtin.pass-rate",
    population: logicalSlots,
    input: attemptPassed,
    withinAttempt: oneValue<boolean>(),
    withinSlot: latestCompletedAttempt<boolean>(),
    acrossSlots: ratio(),
    denominator: allLogicalSlots(),
    missing: partial(),
    evidence: retainContributingEvidence(),
    unit: "ratio",
    format: "percent",
    better: "higher",
  }),
  meanLatencyMs: defineMeasure({
    id: "niceeval.builtin.mean-latency-ms",
    population: logicalSlots,
    input: attemptLatencyMs,
    withinAttempt: oneValue<number>(),
    withinSlot: latestCompletedAttempt<number>(),
    acrossSlots: mean(),
    denominator: allLogicalSlots(),
    missing: partial(),
    evidence: retainContributingEvidence(),
    unit: "ms",
    better: "lower",
  }),
  toolFailureRate: defineMeasure({
    id: "niceeval.builtin.tool-failure-rate",
    population: logicalSlots,
    input: attemptToolFailure,
    withinAttempt: oneValue<boolean>(),
    withinSlot: latestCompletedAttempt<boolean>(),
    acrossSlots: ratio(),
    denominator: allLogicalSlots(),
    missing: partial(),
    evidence: retainContributingEvidence(),
    unit: "ratio",
    format: "percent",
    better: "lower",
  }),
});

export interface BuiltInSummaryRow {
  readonly key: string;
  readonly passRate: MetricValue<number>;
  readonly meanLatencyMs: MetricValue<number>;
  readonly toolFailureRate: MetricValue<number>;
}

export type BuiltInSummaryRows = ClosedRows<BuiltInSummaryRow>;

/** One aggregate row retains MetricValue state, denominator, issues, and refs. */
export function loadBuiltInSummaryRows(sample: Sample): Promise<BuiltInSummaryRows> {
  return aggregate(sample, {
    by: {},
    values: builtInMeasures,
  });
}
