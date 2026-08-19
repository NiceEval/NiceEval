import {
  allLogicalSlots,
  attemptLatencyMs,
  attemptPassed,
  attemptTokens,
  defineMeasure,
  latestCompletedAttempt,
  logicalSlots,
  mean,
  oneValue,
  partial,
  ratio,
  retainContributingEvidence,
  type AnalysisIssue,
  type EvidenceRef,
  type JsonValue,
  type MeasureFormat,
  type MetricValue,
} from "../../analysis/index.ts";

/**
 * Analysis owns every metric's denominator, missingness, state, Evidence, and
 * provenance. These descriptors are the small Report catalog expressed with
 * current Analysis definitions.
 */
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

/** Mean recorded `eval.run` duration across the fixed logical-Slot denominator. */
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

/** Mean recorded input plus output token count across the fixed denominator. */
export const tokens = defineMeasure({
  id: "niceeval.report.tokens",
  population: logicalSlots,
  input: attemptTokens,
  withinAttempt: oneValue<number>(),
  withinSlot: latestCompletedAttempt<number>(),
  acrossSlots: mean(),
  denominator: allLogicalSlots(),
  missing: partial(),
  evidence: retainContributingEvidence(),
  unit: "tokens",
  better: "lower",
});

export { costUSD, totalCostUSD } from "../../analysis/index.ts";

/**
 * Presentation facts retain the original metric and every Analysis-owned
 * diagnostic channel.  They are safe for a component to inspect, but not a
 * replacement metric that can be re-aggregated.
 */
export interface MetricFacts<Value = number> {
  readonly value: Value | null;
  readonly state: MetricValue<Value>["state"];
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricValue<Value>["basis"];
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: MetricValue<Value>["better"];
  readonly bounds?: MetricValue<Value>["bounds"];
  readonly complete: boolean;
  readonly coverage: number | null;
  readonly metric: MetricValue<Value>;
}

/** Extract display facts without discarding the complete MetricValue. */
export function metricFacts<Value>(metric: MetricValue<Value>): MetricFacts<Value> {
  return Object.freeze({
    value: metric.value,
    state: metric.state,
    samples: metric.samples,
    total: metric.total,
    basis: metric.basis,
    issues: metric.issues,
    refs: metric.refs,
    ...(metric.unit === undefined ? {} : { unit: metric.unit }),
    ...(metric.format === undefined ? {} : { format: metric.format }),
    ...(metric.better === undefined ? {} : { better: metric.better }),
    ...(metric.bounds === undefined ? {} : { bounds: metric.bounds }),
    complete: metric.state === "available",
    coverage: metric.total === 0 ? null : metric.samples / metric.total,
    metric,
  });
}

/** The contributor/denominator fraction; null means the declared denominator is zero. */
export function metricCoverage(metric: MetricValue): number | null {
  return metric.total === 0 ? null : metric.samples / metric.total;
}

/** A numeric metric is usable only when Analysis closed a finite scalar. */
export function hasMetricValue(
  metric: MetricValue,
): metric is MetricValue<number> & { readonly value: number } {
  return metric.value !== null && typeof metric.value === "number" && Number.isFinite(metric.value);
}

/**
 * A closed business row may collect existing MetricValue diagnostics, but it
 * cannot manufacture one or alter its total, state, issues, refs, or value.
 */
export interface EvidenceRow {
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

declare const evidenceRowMetricDiagnostic: unique symbol;

type MetricFieldKeys<Fields extends object> = {
  [Key in keyof Fields]-?: Fields[Key] extends MetricValue ? Key : never;
}[keyof Fields];

type EvidenceRowInput<Fields extends object> = [MetricFieldKeys<Fields>] extends [never]
  ? { readonly [evidenceRowMetricDiagnostic]: "evidenceRow requires at least one MetricValue field" }
  : unknown;

/**
 * Structural validation for an already-closed Analysis MetricValue.  It is a
 * display-boundary guard, not a constructor: Report never exports
 * `metricValue()`.
 */
export function isMetricValue(value: unknown): value is MetricValue {
  if (!isPlainRecord(value)) return false;
  const metric = value as Partial<MetricValue>;
  if (
    (metric.value !== null && (typeof metric.value !== "number" || !Number.isFinite(metric.value))) ||
    !isMetricState(metric.state) ||
    !isMetricCount(metric.samples) ||
    !isMetricCount(metric.total) ||
    metric.samples > metric.total ||
    !isMetricBasis(metric.basis) ||
    !Array.isArray(metric.issues) ||
    !metric.issues.every(isAnalysisIssue) ||
    !Array.isArray(metric.refs) ||
    !metric.refs.every(isEvidenceRef) ||
    (metric.unit !== undefined && typeof metric.unit !== "string") ||
    (metric.format !== undefined && !isMeasureFormat(metric.format)) ||
    (metric.better !== undefined && !["higher", "lower", "neutral"].includes(metric.better)) ||
    (metric.bounds !== undefined && !isMetricBounds(metric.bounds))
  ) {
    return false;
  }
  switch (metric.state) {
    case "available":
      return typeof metric.value === "number" && metric.total > 0 && metric.samples === metric.total;
    case "partial":
      return metric.total > 0 && metric.samples < metric.total;
    case "empty":
      return metric.value === null && metric.samples === metric.total;
    case "migration-required":
      return metric.value === null && metric.samples === 0;
    case "unsupported":
      return metric.value === null && metric.samples === 0;
    // Cost projections can be structurally sound while no USD contribution
    // is reportable. Analysis owns that distinction and may retain the full
    // logical-Slot denominator; Report only accepts the already-closed cell.
    case "unavailable":
      return metric.value === null && metric.samples === 0;
    case "failed":
      return metric.value === null;
  }
}

/**
 * Copies an ordinary presentation row while deterministically retaining the
 * existing Analysis diagnostics from all its metric fields.
 */
export function evidenceRow<const Fields extends object>(
  fields: Fields & EvidenceRowInput<Fields>,
): Readonly<Fields & EvidenceRow> {
  if (!isPlainRecord(fields)) throw new TypeError("evidenceRow requires a plain object");
  if (Object.hasOwn(fields, "issues") || Object.hasOwn(fields, "refs")) {
    throw new TypeError("evidenceRow reserves the issues and refs fields");
  }
  const metrics = Object.values(fields).filter(isMetricValue);
  if (metrics.length === 0) {
    throw new TypeError("evidenceRow requires at least one existing MetricValue field");
  }
  return Object.freeze({
    ...fields,
    issues: dedupeAnalysisIssues(metrics.flatMap((metric) => metric.issues)),
    refs: dedupeEvidenceRefs(metrics.flatMap((metric) => metric.refs)),
  }) as Readonly<Fields & EvidenceRow>;
}

/**
 * Sorting changes only display order.  Unlike Analysis-issued ClosedRows, the
 * result is an ordinary frozen array and deliberately has no closed-row
 * identity or aggregate metadata.
 */
export function sortRowsByMetric<Row extends object>(
  rows: readonly Row[],
  field: keyof Row,
  direction: "asc" | "desc" = "desc",
): readonly Row[] {
  const ordered = [...rows].sort((left, right) => {
    const leftValue = numericMetricValue(left[field]);
    const rightValue = numericMetricValue(right[field]);
    const difference = leftValue - rightValue;
    return direction === "asc" ? difference : -difference;
  });
  return Object.freeze(ordered);
}

function numericMetricValue(value: unknown): number {
  return isMetricValue(value) && value.value !== null ? value.value : Number.NEGATIVE_INFINITY;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isMetricCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMetricState(value: unknown): value is MetricValue["state"] {
  return value === "available" || value === "partial" || value === "empty" || value === "migration-required" ||
    value === "unsupported" || value === "unavailable" || value === "failed";
}

function isMetricBasis(value: unknown): value is MetricValue["basis"] {
  return value === "attempt" || value === "eval" || value === "run" ||
    value === "pair" || value === "slot";
}

function isAnalysisIssue(value: unknown): value is AnalysisIssue {
  return isPlainRecord(value) && typeof value.code === "string" && typeof value.message === "string" &&
    Array.isArray(value.refs) && value.refs.every(isEvidenceRef);
}

function isEvidenceRef(value: unknown): value is EvidenceRef {
  return isPlainRecord(value) && isPlainRecord(value.identity) &&
    value.identity.kind === "attempt" && typeof value.identity.locator === "string";
}

function isMeasureFormat(value: unknown): value is MeasureFormat {
  return typeof value === "string" ||
    (isPlainRecord(value) && typeof value.kind === "string" &&
      (value.options === undefined || isJsonValue(value.options)));
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || value === null || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : isPlainRecord(value) && Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isMetricBounds(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (
    (value.min !== undefined && (typeof value.min !== "number" || !Number.isFinite(value.min))) ||
    (value.max !== undefined && (typeof value.max !== "number" || !Number.isFinite(value.max)))
  ) {
    return false;
  }
  return value.min === undefined || value.max === undefined || value.min <= value.max;
}

function dedupeEvidenceRefs(refs: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const unique = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    const key = ref.identity.kind + "\u0000" + ref.identity.locator;
    if (!unique.has(key)) {
      unique.set(key, Object.freeze({
        identity: Object.freeze({ kind: ref.identity.kind, locator: ref.identity.locator }),
      }));
    }
  }
  return Object.freeze(
    [...unique.entries()]
      .sort(([left], [right]) => compareCanonicalCodeUnits(left, right))
      .map(([, ref]) => ref),
  );
}

function dedupeAnalysisIssues(issues: readonly AnalysisIssue[]): readonly AnalysisIssue[] {
  const unique = new Map<string, AnalysisIssue>();
  for (const issue of issues) {
    const refs = dedupeEvidenceRefs(issue.refs);
    const key = issue.code + "\u0000" + issue.message + "\u0000" +
      refs.map((ref) => ref.identity.locator).join("\u0001");
    if (!unique.has(key)) {
      unique.set(key, Object.freeze({ code: issue.code, message: issue.message, refs }));
    }
  }
  return Object.freeze(
    [...unique.entries()]
      .sort(([left], [right]) => compareCanonicalCodeUnits(left, right))
      .map(([, issue]) => issue),
  );
}

function compareCanonicalCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
