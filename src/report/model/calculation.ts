import {
  aggregate,
  allLogicalSlots,
  attemptLatencyMs,
  attemptPassed,
  defineDimension,
  defineMeasure,
  latestCompletedAttempt,
  logicalSlots,
  mean,
  oneValue,
  partial,
  ratio,
  retainContributingEvidence,
  type Dimension,
  type LogicalSlot,
  type Measure,
  type MetricValue,
} from "../../analysis/index.ts";
import {
  closedRowsMetadata,
  isClosedRows,
  makeClosedRows,
} from "../../analysis/contracts.ts";

/**
 * Report's small compatibility catalog is still made of Analysis definitions.
 * It does not read a Record or expose a second calculation runtime.
 */
export const experiment = defineDimension({
  id: "niceeval.report.experiment",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.experimentId,
});

export const evalId = defineDimension({
  id: "niceeval.report.eval-id",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.evalId,
});

/** The current Sample intentionally does not reveal producer identifiers. */
export const agent = unavailableDimension("agent");
/** The current Sample intentionally does not reveal producer identifiers. */
export const model = unavailableDimension("model");

/** Analysis-owned pass/fail ratio with the fixed logical-slot denominator. */
export const passRate = defineMeasure({
  id: "niceeval.report.pass-rate",
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
});

/** Analysis-owned mean `eval.run` duration, in milliseconds. */
export const durationMs = defineMeasure({
  id: "niceeval.report.duration-ms",
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
});

/** Authors use the one Analysis aggregate operation; this is not a Report fork. */
export { aggregate };

export type ReportDimension<Value extends string | number | boolean | null = string | number | boolean | null> =
  Dimension<LogicalSlot, Value>;
export type ReportMeasure<Value = number> = Measure<LogicalSlot, Value>;

/**
 * Presentation-safe facts about an Analysis-owned MetricValue.  These helpers
 * never aggregate, filter a denominator, or create a replacement metric.
 */
export interface MetricFacts {
  readonly value: number | null;
  readonly state: MetricValue["state"];
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricValue["basis"];
  readonly complete: boolean;
  readonly coverage: number | null;
  readonly metric: MetricValue;
}

/** Extracts display facts while retaining the original closed MetricValue. */
export function metricFacts(metric: MetricValue): MetricFacts {
  return Object.freeze({
    value: metric.value,
    state: metric.state,
    samples: metric.samples,
    total: metric.total,
    basis: metric.basis,
    complete: metric.state === "available",
    coverage: metric.total === 0 ? null : metric.samples / metric.total,
    metric,
  });
}

/** The contributor/denominator fraction; null means the declared denominator is zero. */
export function metricCoverage(metric: MetricValue): number | null {
  return metric.total === 0 ? null : metric.samples / metric.total;
}

/** A metric is numerically usable only when Analysis closed a finite number. */
export function hasMetricValue(metric: MetricValue): metric is MetricValue<number> & { readonly value: number } {
  return metric.value !== null && Number.isFinite(metric.value);
}

/**
 * Sorts a visible copy of already closed rows.  It deliberately returns the
 * original cells so their total, state, issues, and refs cannot be altered.
 */
export function sortRowsByMetric<Row extends object>(
  rows: readonly Row[],
  field: keyof Row,
  direction: "asc" | "desc" = "desc",
): readonly Row[] {
  const ordered = [...rows].sort((left, right) => {
    const leftMetric = metricAt(left[field]);
    const rightMetric = metricAt(right[field]);
    const leftValue = leftMetric?.value ?? Number.NEGATIVE_INFINITY;
    const rightValue = rightMetric?.value ?? Number.NEGATIVE_INFINITY;
    const difference = leftValue - rightValue;
    return direction === "asc" ? difference : -difference;
  });
  if (!isClosedRows(rows)) return Object.freeze(ordered);
  const metadata = closedRowsMetadata(rows);
  return metadata === undefined
    ? Object.freeze(ordered)
    : makeClosedRows<Row>({
      rows: ordered,
      identity: metadata.identity,
      issues: metadata.issues,
      refs: metadata.refs,
    });
}

function metricAt(value: unknown): MetricValue | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const metric = value as Partial<MetricValue>;
  return typeof metric.samples === "number" && typeof metric.total === "number" &&
      (typeof metric.value === "number" || metric.value === null) && typeof metric.state === "string"
    ? value as MetricValue
    : undefined;
}

function unavailableDimension(name: string): Dimension<LogicalSlot, null> {
  return defineDimension({
    id: `niceeval.report.${name}`,
    population: logicalSlots,
    value: () => null,
  });
}
