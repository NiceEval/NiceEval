import {
  aggregate as aggregateFromAnalysis,
  defineDimension,
  logicalSlots,
  type ClosedRows,
  type Dimension,
  type JsonValue,
  type LogicalSlot,
  type Measure,
  type MetricValue,
  type Sample,
} from "../../analysis/index.ts";
import type {
  ReportDimension,
} from "./types.ts";

/**
 * The only value visible to a Report grouping callback. It is a
 * defensive frozen projection of the selected Run context, never the Run
 * object itself.  In particular, it has no reader, path, Scope, attachment,
 * or AttemptHandle capability.
 */
export interface AggregationSubject {
  readonly experimentId: LogicalSlot["experimentId"];
  readonly evalId: LogicalSlot["evalId"];
  readonly run: Readonly<{
    readonly experiment?: Readonly<{
      readonly agent: string;
      readonly model?: string;
      readonly reasoningEffort?: string;
      readonly flags: Readonly<Record<string, JsonValue>>;
      readonly labels: Readonly<Record<string, string>>;
    }>;
  }>;
}

/** Safe, closed Run-context grouping callback. */
export type GroupFunction = (subject: AggregationSubject) => string;

/**
 * A native Analysis Dimension may appear beside GroupFunction.  The `any`
 * here only bridges Analysis's nominal descriptor brands at an object-record
 * boundary; the executor still validates Population agreement before I/O.
 */
export type ReportGroup = Dimension<any, any> | GroupFunction;
export type ReportGroupSet = Readonly<Record<string, ReportGroup>>;
export type ReportMeasureSet = Readonly<Record<string, Measure<any, any>>>;

type GroupOutput<Value> = Value extends Dimension<any, infer Output>
  ? Output
  : Value extends GroupFunction ? string
  : never;

type MeasureOutput<Value> = Value extends Measure<any, infer Output> ? Output : never;

/** The same closed row shape Analysis returns, with GroupFunction inference. */
export type ReportAggregateRow<By extends ReportGroupSet, Values extends ReportMeasureSet> = Readonly<
  { readonly key: string }
  & { readonly [Key in keyof By]: GroupOutput<By[Key]> }
  & { readonly [Key in keyof Values]: MetricValue<MeasureOutput<Values[Key]>> }
>;

export interface ReportAggregateRequest<
  By extends ReportGroupSet,
  Values extends ReportMeasureSet,
> {
  readonly by: By;
  readonly values: Values;
}

/**
 * Invalid Report facade input is a request error, not a manufactured
 * MetricValue.  Errors thrown by an individual GroupFunction occur inside
 * Analysis's Dimension evaluation and therefore become the usual
 * `input-invalid` Analysis issue on its closed row.
 */
export class ReportAggregateRequestError extends Error {
  readonly code = "report-aggregate-invalid";

  constructor(reason: string) {
    super(reason);
    this.name = "ReportAggregateRequestError";
  }
}

/** A non-string custom group result is an honest Analysis input problem. */
export class ReportGroupFunctionError extends Error {
  readonly code = "report-group-function-invalid";

  constructor(reason: string) {
    super(reason);
    this.name = "ReportGroupFunctionError";
  }
}

/** Safe built-in Dimension over a closed logical-Slot identity. */
export const experiment = defineDimension({
  id: "niceeval.report.experiment",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.experimentId,
});

/** Safe built-in Dimension over a closed logical-Slot identity. */
export const evalId = defineDimension({
  id: "niceeval.report.eval-id",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.evalId,
});

/** The selected Attempt locator, or null for an expected Slot without one. */
export const attempt = defineDimension({
  id: "niceeval.report.attempt",
  population: logicalSlots,
  value: (slot: LogicalSlot) =>
    slot.state === "included" && slot.attempt !== undefined ? slot.attempt.locator : null,
});

/** The selected Run's frozen declared agent configuration. */
export const agent = defineDimension({
  id: "niceeval.report.agent",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.run.context?.execution.agentId ?? null,
});

/** The selected Run's frozen declared model configuration. */
export const model = defineDimension({
  id: "niceeval.report.model",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.run.context?.execution.model ?? null,
});

/** The selected Run's frozen declared reasoning-effort configuration. */
export const reasoningEffort = defineDimension({
  id: "niceeval.report.reasoning-effort",
  population: logicalSlots,
  value: (slot: LogicalSlot) => slot.run.context?.execution.reasoningEffort ?? null,
});

const flagDimensions = new Map<string, ReportDimension>();
const labelDimensions = new Map<string, ReportDimension<string | null>>();
const groupDimensions = new WeakMap<GroupFunction, Dimension<LogicalSlot, string>>();
const subjects = new WeakMap<LogicalSlot, AggregationSubject>();
let nextGroupDimensionId = 0;

/**
 * A scalar frozen Run flag is a first-class Report grouping Dimension.
 * Arrays and objects have no faithful Dimension coordinate; callers can make
 * their own explicit string projection with GroupFunction instead.
 */
export function flag(name: string): ReportDimension {
  assertRunContextFieldName(name, "flag");
  const existing = flagDimensions.get(name);
  if (existing !== undefined) return existing;
  const dimension = defineDimension({
    id: "niceeval.report.flag:" + JSON.stringify(name),
    population: logicalSlots,
    value: (slot: LogicalSlot) =>
      scalarFlagValue(slot.run.context?.execution.flags[name], name),
  });
  flagDimensions.set(name, dimension);
  return dimension;
}

/** A frozen selected-Run label is a first-class Report grouping Dimension. */
export function label(name: string): ReportDimension<string | null> {
  assertRunContextFieldName(name, "label");
  const existing = labelDimensions.get(name);
  if (existing !== undefined) return existing;
  const dimension = defineDimension({
    id: "niceeval.report.label:" + JSON.stringify(name),
    population: logicalSlots,
    value: (slot: LogicalSlot) => slot.run.context?.labels[name] ?? null,
  });
  labelDimensions.set(name, dimension);
  return dimension;
}

/**
 * Report aggregation creates only safe
 * Dimensions for GroupFunction and returns Analysis's original ClosedRows
 * object unchanged, so row identity, denominator, state, Evidence, and
 * provenance remain Analysis-owned.
 */
export function aggregate<By extends ReportGroupSet, Values extends ReportMeasureSet>(
  sample: Sample,
  request: ReportAggregateRequest<By, Values>,
): Promise<ClosedRows<ReportAggregateRow<By, Values>>>;
export function aggregate(
  sample: Sample,
  request: ReportAggregateRequest<ReportGroupSet, ReportMeasureSet>,
): Promise<ClosedRows<object>> {
  try {
    assertAggregateRequest(request);
    return aggregateFromAnalysis(sample, {
      by: analysisDimensionsFor(request.by),
      values: request.values,
    });
  } catch (error) {
    // Keep the public Promise boundary even when facade-only validation fails.
    return Promise.reject(error);
  }
}

function assertAggregateRequest(
  request: ReportAggregateRequest<ReportGroupSet, ReportMeasureSet>,
): void {
  if (!isPlainRecord(request) || !isPlainRecord(request.by) || !isPlainRecord(request.values)) {
    throw new ReportAggregateRequestError("aggregate requires plain by and values records");
  }
  const byNames = Object.keys(request.by);
  const valueNames = Object.keys(request.values);
  if (valueNames.length === 0) {
    throw new ReportAggregateRequestError("aggregate requires at least one Analysis Measure");
  }
  for (const name of [...byNames, ...valueNames]) {
    if (name === "key") {
      throw new ReportAggregateRequestError('aggregate reserves the row identity field "key"');
    }
  }
  for (const name of valueNames) {
    if (Object.hasOwn(request.by, name)) {
      throw new ReportAggregateRequestError(
        "aggregate field " + JSON.stringify(name) + " appears in both by and values",
      );
    }
  }
}

function analysisDimensionsFor(
  groups: ReportGroupSet,
): Readonly<Record<string, Dimension<any, any>>> {
  const dimensions: Record<string, Dimension<any, any>> = Object.create(null);
  for (const [name, group] of Object.entries(groups)) {
    dimensions[name] = typeof group === "function" ? dimensionForGroupFunction(group) : group;
  }
  return Object.freeze(dimensions);
}

function dimensionForGroupFunction(group: GroupFunction): Dimension<LogicalSlot, string> {
  const existing = groupDimensions.get(group);
  if (existing !== undefined) return existing;
  const dimension = defineDimension({
    id: "niceeval.report.group-function." + nextGroupDimensionId++,
    population: logicalSlots,
    value: (slot: LogicalSlot) => {
      const value = group(aggregationSubject(slot));
      if (typeof value !== "string") {
        throw new ReportGroupFunctionError("GroupFunction must return a string");
      }
      return value;
    },
  });
  groupDimensions.set(group, dimension);
  return dimension;
}

function aggregationSubject(slot: LogicalSlot): AggregationSubject {
  const cached = subjects.get(slot);
  if (cached !== undefined) return cached;
  const context = slot.run.context;
  const experimentContext = context === null
    ? undefined
    : Object.freeze({
      agent: context.execution.agentId,
      ...(context.execution.model === null ? {} : { model: context.execution.model }),
      ...(context.execution.reasoningEffort === null
        ? {}
        : { reasoningEffort: context.execution.reasoningEffort }),
      flags: closeJsonRecord(context.execution.flags),
      labels: closeStringRecord(context.labels),
    });
  const subject: AggregationSubject = Object.freeze({
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    run: Object.freeze(experimentContext === undefined ? {} : { experiment: experimentContext }),
  });
  subjects.set(slot, subject);
  return subject;
}

function assertRunContextFieldName(name: string, helper: "flag" | "label"): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new ReportAggregateRequestError(helper + " requires a non-empty RunContext field name");
  }
}

function scalarFlagValue(
  value: JsonValue | undefined,
  name: string,
): string | number | boolean | null {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") {
    return value ?? null;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new ReportGroupFunctionError(
      "flag(" + JSON.stringify(name) + ") has a non-finite numeric RunContext value",
    );
  }
  throw new ReportGroupFunctionError(
    "flag(" + JSON.stringify(name) + ") requires a scalar RunContext value",
  );
}

function closeJsonRecord(
  source: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  const closed: Record<string, JsonValue> = Object.create(null);
  for (const [key, value] of Object.entries(source)) closed[key] = closeJson(value);
  return Object.freeze(closed);
}

function closeStringRecord(
  source: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const closed: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") {
      throw new ReportGroupFunctionError("RunContext labels must be strings");
    }
    closed[key] = value;
  }
  return Object.freeze(closed);
}

function closeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ReportGroupFunctionError("RunContext flags must contain finite JSON numbers");
    }
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(closeJson));
  if (!isPlainRecord(value)) {
    throw new ReportGroupFunctionError("RunContext flags must be JSON-only values");
  }
  const closed: Record<string, JsonValue> = Object.create(null);
  for (const [key, entry] of Object.entries(value)) closed[key] = closeJson(entry as JsonValue);
  return Object.freeze(closed);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
