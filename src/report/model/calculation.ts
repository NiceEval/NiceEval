import {
  aggregate as aggregateFromAnalysis,
  allLogicalSlots,
  attemptLatencyMs,
  attemptPassed,
  attemptTokens,
  defineDimension,
  defineMeasure,
  latestCompletedAttempt,
  logicalSlots,
  mean,
  oneValue,
  partial,
  ratio,
  retainContributingEvidence,
  type AnalysisIssue,
  type ClosedRows,
  type Dimension,
  type EvidenceRef,
  type JsonValue,
  type LogicalSlot,
  type Measure,
  type MeasureFormat,
  type MetricValue,
  type Sample,
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

/** The selected Attempt locator, or null for a logical Slot without an Attempt. */
export const attempt = defineDimension({
  id: "niceeval.report.attempt",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.state === "included" && slot.attempt !== undefined
    ? slot.attempt.locator
    : null,
});

/** The sealed Run's declared agent configuration. */
export const agent = defineDimension({
  id: "niceeval.report.agent",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.run.context?.execution.agentId ?? null,
});

/** The sealed Run's declared model configuration. */
export const model = defineDimension({
  id: "niceeval.report.model",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.run.context?.execution.model ?? null,
});

/** The sealed Run's declared model reasoning-effort configuration. */
export const reasoningEffort = defineDimension({
  id: "niceeval.report.reasoning-effort",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.run.context?.execution.reasoningEffort ?? null,
});

/** A scalar, sealed Run flag is a first-class Report grouping Dimension. */
export function flag(name: string): ReportDimension {
  assertRunContextFieldName(name, "flag");
  const existing = flagDimensions.get(name);
  if (existing !== undefined) return existing;
  const dimension = defineDimension({
    id: `niceeval.report.flag:${JSON.stringify(name)}`,
    population: logicalSlots,
    value: (slot: LogicalSlot) => scalarFlagValue(slot.run.context?.execution.flags[name], name),
  });
  flagDimensions.set(name, dimension);
  return dimension;
}

/** A sealed Run label is a first-class Report grouping Dimension. */
export function label(name: string): ReportDimension<string | null> {
  assertRunContextFieldName(name, "label");
  const existing = labelDimensions.get(name);
  if (existing !== undefined) return existing;
  const dimension = defineDimension({
    id: `niceeval.report.label:${JSON.stringify(name)}`,
    population: logicalSlots,
    value: (slot: LogicalSlot) => slot.run.context?.labels[name] ?? null,
  });
  labelDimensions.set(name, dimension);
  return dimension;
}

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

export type ReportDimension<Value extends string | number | boolean | null = string | number | boolean | null> =
  Dimension<LogicalSlot, Value>;
export type ReportMeasure<Value = number> = Measure<LogicalSlot, Value>;

/** Mean recorded input plus output tokens per selected logical Slot. */
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

/**
 * The v0.12 grouping callback receives only the closed, selected Run and
 * logical Slot identity. It cannot read a Record, recover an ID into a reader,
 * or inspect any lazy Attachment.
 */
export interface AggregationSubject {
  readonly experimentId: LogicalSlot["experimentId"];
  readonly evalId: LogicalSlot["evalId"];
  readonly run: {
    readonly runId: LogicalSlot["runId"];
    readonly startedAt: LogicalSlot["run"]["startedAt"];
    readonly completedAt: LogicalSlot["run"]["completedAt"];
    readonly experiment?: {
      readonly agent: string;
      readonly model?: string;
      readonly reasoningEffort?: string;
      readonly flags: Readonly<Record<string, JsonValue>>;
      readonly labels: Readonly<Record<string, string>>;
    };
  };
}

/** Compatibility grouping over the closed Analysis projection. */
export type GroupFunction = (subject: AggregationSubject) => string;

// The Report boundary combines independently branded Analysis dimensions.
// `any` intentionally erases only those nominal brands; Analysis validates
// population compatibility before any facts are read.
type ReportGroup = Dimension<any, any> | GroupFunction;
type ReportGroupSet = Readonly<Record<string, ReportGroup>>;
type ReportMeasureSet = Readonly<Record<string, Measure<any, any>>>;

type GroupOutput<Value> = Value extends Dimension<any, infer Output>
  ? Output
  : Value extends GroupFunction ? string
  : never;
type MeasureOutput<Value> = Value extends Measure<any, infer Output> ? Output : never;

/** Aggregate row typing for native Dimensions and v0.12 GroupFunctions alike. */
export type ReportAggregateRow<By extends ReportGroupSet, Values extends ReportMeasureSet> = Readonly<
  { readonly key: string }
  & { readonly [Key in keyof By]: GroupOutput<By[Key]> }
  & { readonly [Key in keyof Values]: MetricValue<MeasureOutput<Values[Key]>> }
>;

const groupDimensions = new WeakMap<GroupFunction, Dimension<LogicalSlot, string>>();
let nextGroupDimensionId = 0;
const flagDimensions = new Map<string, ReportDimension>();
const labelDimensions = new Map<string, ReportDimension<string | null>>();

/**
 * Report keeps its v0.12 callback spelling, but delegates the actual grouping
 * and every Measure to the single Analysis aggregate implementation.
 */
export function aggregate<By extends ReportGroupSet, Values extends ReportMeasureSet>(
  sample: Sample,
  request: { readonly by: By; readonly values: Values },
): Promise<ClosedRows<ReportAggregateRow<By, Values>>>;
export function aggregate(
  sample: Sample,
  request: { readonly by: ReportGroupSet; readonly values: ReportMeasureSet },
): Promise<ClosedRows<object>> {
  return aggregateFromAnalysis(sample, {
    by: analysisDimensionsFor(request.by),
    values: request.values,
  });
}

function analysisDimensionsFor(groups: ReportGroupSet): Readonly<Record<string, Dimension<any, any>>> {
  const dimensions: Record<string, Dimension<any, any>> = Object.create(null) as Record<
    string,
    Dimension<any, any>
  >;
  for (const [name, group] of Object.entries(groups)) {
    dimensions[name] = typeof group === "function" ? dimensionForGroupFunction(group) : group;
  }
  return Object.freeze(dimensions);
}

function dimensionForGroupFunction(group: GroupFunction): Dimension<LogicalSlot, string> {
  const existing = groupDimensions.get(group);
  if (existing !== undefined) return existing;
  const dimension = defineDimension({
    id: `niceeval.report.group-function.${nextGroupDimensionId++}`,
    population: logicalSlots,
    value: (slot: LogicalSlot) => {
      const value = group(aggregationSubject(slot));
      if (typeof value !== "string") throw new TypeError("GroupFunction must return a string");
      return value;
    },
  });
  groupDimensions.set(group, dimension);
  return dimension;
}

function aggregationSubject(slot: LogicalSlot): AggregationSubject {
  const context = slot.run.context;
  const experiment = context === null
    ? undefined
    : Object.freeze({
      agent: context.execution.agentId,
      ...(context.execution.model === null ? {} : { model: context.execution.model }),
      ...(context.execution.reasoningEffort === null
        ? {}
        : { reasoningEffort: context.execution.reasoningEffort }),
      flags: context.execution.flags,
      labels: context.labels,
    });
  return Object.freeze({
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    run: Object.freeze({
      runId: slot.run.runId,
      startedAt: slot.run.startedAt,
      completedAt: slot.run.completedAt,
      ...(experiment === undefined ? {} : { experiment }),
    }),
  });
}

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
 * A closed Evidence row may combine existing MetricValues, but it never makes
 * a new one or rewrites a metric's own denominator, state, issues, or refs.
 */
export interface EvidenceRow {
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

/** Keeps the "at least one existing MetricValue" diagnostic at the callsite. */
declare const evidenceRowMetricDiagnostic: unique symbol;
type MetricFieldKeys<Fields extends object> = {
  [Key in keyof Fields]-?: Fields[Key] extends MetricValue ? Key : never;
}[keyof Fields];
type EvidenceRowInput<Fields extends object> = [MetricFieldKeys<Fields>] extends [never]
  ? { readonly [evidenceRowMetricDiagnostic]: "evidenceRow requires at least one MetricValue field" }
  : unknown;

/** Structural guard for a MetricValue that Analysis has already closed. */
export function isMetricValue(value: unknown): value is MetricValue {
  if (!isPlainObject(value)) return false;
  const metric = value as Partial<MetricValue>;
  if (
    (metric.value !== null && (typeof metric.value !== "number" || !Number.isFinite(metric.value))) ||
    !["available", "partial", "empty", "unsupported", "failed"].includes(metric.state as string) ||
    !isMetricCount(metric.samples) || !isMetricCount(metric.total) || metric.samples > metric.total ||
    !["attempt", "eval", "run", "pair", "slot"].includes(metric.basis as string) ||
    !Array.isArray(metric.issues) || !metric.issues.every(isAnalysisIssue) ||
    !Array.isArray(metric.refs) || !metric.refs.every(isEvidenceRef) ||
    (metric.unit !== undefined && typeof metric.unit !== "string") ||
    (metric.format !== undefined && !isMeasureFormat(metric.format)) ||
    (metric.better !== undefined && !["higher", "lower", "neutral"].includes(metric.better)) ||
    (metric.bounds !== undefined && !isMetricBounds(metric.bounds))
  ) return false;
  return true;
}

/**
 * Collects the evidence carried by one or more existing MetricValues for an
 * ordinary business row. It rejects a row without metrics rather than letting
 * callers manufacture Evidence from display scalars.
 */
export function evidenceRow<const Fields extends object>(
  fields: Fields & EvidenceRowInput<Fields>,
): Readonly<Fields & EvidenceRow> {
  if (!isPlainObject(fields)) throw new TypeError("evidenceRow requires a plain object");
  if (Object.hasOwn(fields, "issues") || Object.hasOwn(fields, "refs")) {
    throw new TypeError("evidenceRow reserves the issues and refs fields");
  }
  const metrics = Object.values(fields).filter(isMetricValue);
  if (metrics.length === 0) throw new TypeError("evidenceRow requires at least one existing MetricValue field");
  const refs = dedupeEvidenceRefs(metrics.flatMap((metric) => metric.refs));
  const issues = dedupeAnalysisIssues(metrics.flatMap((metric) => metric.issues));
  return Object.freeze({ ...fields, issues, refs }) as Readonly<Fields & EvidenceRow>;
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

function assertRunContextFieldName(name: string, helper: "flag" | "label"): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError(`${helper} requires a non-empty RunContext field name`);
  }
}

function scalarFlagValue(value: JsonValue | undefined, name: string): string | number | boolean | null {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`flag(${JSON.stringify(name)}) has a non-finite numeric value`);
  }
  throw new TypeError(`flag(${JSON.stringify(name)}) requires a scalar RunContext flag`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isMetricCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAnalysisIssue(value: unknown): value is AnalysisIssue {
  return isPlainObject(value) && typeof value.code === "string" && typeof value.message === "string" &&
    Array.isArray(value.refs) && value.refs.every(isEvidenceRef);
}

function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (!isPlainObject(value) || !isPlainObject(value.identity)) return false;
  return value.identity.kind === "attempt" && typeof value.identity.locator === "string";
}

function isMeasureFormat(value: unknown): value is MeasureFormat {
  return typeof value === "string" || (isPlainObject(value) && typeof value.kind === "string");
}

function isMetricBounds(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (value.min === undefined || (typeof value.min === "number" && Number.isFinite(value.min))) &&
    (value.max === undefined || (typeof value.max === "number" && Number.isFinite(value.max)));
}

function dedupeEvidenceRefs(refs: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const unique = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    const key = `${ref.identity.kind}\u0000${ref.identity.locator}`;
    if (!unique.has(key)) {
      unique.set(key, Object.freeze({ identity: Object.freeze({ ...ref.identity }) }));
    }
  }
  return Object.freeze([...unique.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, ref]) => ref));
}

function dedupeAnalysisIssues(issues: readonly AnalysisIssue[]): readonly AnalysisIssue[] {
  const unique = new Map<string, AnalysisIssue>();
  for (const issue of issues) {
    const refs = dedupeEvidenceRefs(issue.refs);
    const key = `${issue.code}\u0000${issue.message}\u0000${refs.map((ref) => ref.identity.locator).join("\u0001")}`;
    if (!unique.has(key)) unique.set(key, Object.freeze({ code: issue.code, message: issue.message, refs }));
  }
  return Object.freeze([...unique.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, issue]) => issue));
}
