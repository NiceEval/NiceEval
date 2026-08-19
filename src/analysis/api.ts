import { Effect } from "effect";
import { parseAttemptLocator, type AttemptLocator } from "../attempt-locator.ts";
import {
  attemptEvidenceDomainBinding,
  attemptObservabilityDomainBinding,
  fileChangesDomainBinding,
  sandboxHistoryDomainBinding,
  sourceNavigationDomainBinding,
  sourcesDomainBinding,
  type BuiltinDomainViewBinding,
  type FixedFamilyBinding,
  type FixedFamilyOwnerRequirement,
} from "./bindings.ts";
import type {
  BuiltinDomainDetail,
  BuiltinDomainViewKind,
} from "./domain-view.ts";
import {
  allLogicalSlots,
  analysisInputState,
  denominatorState,
  dimensionState,
  measureState,
  populationIdentity,
  populationMembersState,
  producerPolicyIsRequired,
  reductionState,
  registeredRelations,
  relationState,
  type AcrossSlotsReduction,
  type AnalysisInput,
  type Denominator,
  type Dimension,
  type DimensionValue,
  type EvidencePolicy,
  type LogicalSlot,
  type Measure,
  type MissingPolicy,
  type Population,
  type ProducerPolicy,
  type Relation,
  type WithinAttemptReduction,
  type WithinSlotReduction,
  logicalSlots,
} from "./definitions.ts";
import {
  costMeasureState,
  isCostMeasure,
  type CostMeasure,
  type CostMetricValue,
} from "./cost.ts";
import { aggregateCostProjection } from "./cost-projection.ts";
import {
  makeClosedRows,
  type AnalysisIssue,
  type AnalysisRequestError,
  type SampleClosedError,
  type ClosedRows,
  type DomainView,
  type EvidenceRef,
  type MetricBasis,
  type MetricValue,
  type PopulationIdentity,
  type ProducerIdentity,
  type AttemptEvidenceIdentity,
  type Sample,
} from "./contracts.ts";
import {
  assertSampleOpen,
  currentAnalysisIssueCapture,
  recordAnalysisCostMetric,
  recordAnalysisIssues,
  readCostProjection,
  readBuiltinDomainView,
  readRunDiagnosticsDomainView,
  runSamplePromise,
  type AnalysisIssueCaptureToken,
} from "../sample/capability.ts";

/**
 * Constraint only: `any` intentionally erases the nominal Population and
 * value brands at this object boundary. Generic inference retains each named
 * descriptor's real type in AggregateRow; callers do not need an unsafe cast
 * merely because several descriptors share a Population.
 */
export type DimensionSet = Readonly<Record<string, Dimension<any, any>>>;
export type MeasureSet = Readonly<Record<string, Measure<any, any>>>;

type DimensionOutput<Value> = Value extends Dimension<any, infer Output> ? Output : never;

/**
 * The one result mapping for every requested Measure. Cost keeps `number` as
 * its Measure value for ordinary axes while its closed cell exposes the
 * authoritative CostProjectionValue without a Report cast.
 */
export type MeasureCell<Value> = Value extends CostMeasure
  ? CostMetricValue
  : Value extends Measure<any, infer Output>
  ? MetricValue<Output>
  : never;

export type AggregateRow<By, Values> = Readonly<
  { readonly key: string }
  & {
    readonly [Key in keyof By]: DimensionOutput<By[Key]>;
  }
  & {
    readonly [Key in keyof Values]: MeasureCell<Values[Key]>;
  }
>;

export type SemanticRow<By, Measures> = AggregateRow<By, Measures>;

export interface SemanticFrame<By, Measures> {
  readonly kind: "semantic-frame";
  readonly sample: import("./contracts.ts").SampleIdentity;
  readonly population: PopulationIdentity;
  readonly rows: ClosedRows<SemanticRow<By, Measures>>;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

export interface AggregateRequest<By extends object, Values extends object> {
  readonly by: By;
  readonly values: Values;
}

export interface FrameQuery<Member, By extends object, Measures extends object> {
  readonly kind: "frame";
  readonly population: Population<Member>;
  readonly by: By;
  readonly measures: Measures;
}

const domainViewRequestTypeId: unique symbol = Symbol("niceeval.analysis.DomainViewRequest");

export type { BuiltinDomainViewKind } from "./domain-view.ts";

/** One fully closed entry for a selected Attempt in a built-in DomainView. */
export type ClosedDomainEntry<Kind extends BuiltinDomainViewKind = BuiltinDomainViewKind> =
  | {
      readonly attempt: AttemptEvidenceIdentity;
      readonly state: "available";
      readonly view: Kind;
      readonly detail: BuiltinDomainDetail<Kind>;
    }
  | {
      readonly attempt: AttemptEvidenceIdentity;
      readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid";
      readonly view: Kind;
    }
  | {
      readonly attempt: AttemptEvidenceIdentity;
      readonly state: "failed";
      readonly view: Kind;
      readonly detail: string;
    };

/**
 * The projection contains only JSON values, evidence identities and analysis
 * issues. It never carries a Record capability, filesystem location or thunk.
 */
export interface BuiltinDomainView<Kind extends BuiltinDomainViewKind> extends DomainView {
  readonly view: Kind;
  readonly entries: readonly ClosedDomainEntry<Kind>[];
}

export type AttemptEvidenceDomainView = BuiltinDomainView<"attempt-evidence">;
export type AttemptObservabilityDomainView = BuiltinDomainView<"attempt-observability">;
export type FileChangesDomainView = BuiltinDomainView<"file-changes">;
export type SourceNavigationDomainView = BuiltinDomainView<"source-navigation">;
export type SourcesDomainView = BuiltinDomainView<"sources">;
export type SandboxHistoryDomainView = BuiltinDomainView<"sandbox-history">;

export type ClosedRunDiagnosticsEntry =
  | {
      readonly runId: string;
      readonly experimentId: string;
      readonly state: "available";
      readonly detail: import("./domain-view.ts").ClosedDiagnosticsDetail;
    }
  | {
      readonly runId: string;
      readonly experimentId: string;
      readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid";
    }
  | {
      readonly runId: string;
      readonly experimentId: string;
      readonly state: "failed";
      readonly detail: string;
    };

/** Closed Run-owned diagnostics, including failures that predate an Attempt. */
export interface RunDiagnosticsDomainView extends DomainView {
  readonly view: "run-diagnostics";
  readonly entries: readonly ClosedRunDiagnosticsEntry[];
}

/** A NiceEval-published request for a non-tabular, already-closed DomainView. */
export interface DomainViewRequest<View extends DomainView> {
  readonly kind: "domain-view-request";
  readonly id: string;
  readonly [domainViewRequestTypeId]: (_: View) => View;
}

interface PublishedDomainViewRegistration {
  readonly read: (
    sample: Sample,
    locator?: import("../attempt-locator.ts").AttemptLocator,
  ) => Effect.Effect<DomainView, SampleClosedError>;
}

const publishedDomainViewBindings = new WeakMap<object, PublishedDomainViewRegistration>();

function publishedDomainViewRequest<
  Kind extends BuiltinDomainViewKind,
  Payload,
  Family extends FixedFamilyBinding<FixedFamilyOwnerRequirement, Payload, any>,
>(
  binding: BuiltinDomainViewBinding<Kind, Payload, Family>,
): DomainViewRequest<BuiltinDomainView<Kind>> {
  const request: DomainViewRequest<BuiltinDomainView<Kind>> = Object.freeze({
    kind: "domain-view-request" as const,
    id: binding.id,
    [domainViewRequestTypeId]: (value: BuiltinDomainView<Kind>) => value,
  });
  publishedDomainViewBindings.set(request, Object.freeze({
    read: (sample: Sample, locator?: AttemptLocator) =>
      readBuiltinDomainView(sample, binding, locator),
  }));
  return request;
}

/** Closed Assertions / evidence material for each included Attempt. */
export const attemptEvidenceView = publishedDomainViewRequest(attemptEvidenceDomainBinding);

/** Closed conversation, commands, usage, timing and diagnostics per Attempt. */
export const attemptObservabilityView = publishedDomainViewRequest(attemptObservabilityDomainBinding);

/** Closed attempt-owned FileChanges projection. */
export const fileChangesView = publishedDomainViewRequest(fileChangesDomainBinding);

/** Closed physical send-to-source and send-to-timing navigation rows. */
export const sourceNavigationView = publishedDomainViewRequest(sourceNavigationDomainBinding);

/** Closed origin-run Sources projection for each included Attempt. */
export const sourcesView = publishedDomainViewRequest(sourcesDomainBinding);

/** Sandbox command/timing/diagnostic history projected from Observability. */
export const sandboxHistoryView = publishedDomainViewRequest(sandboxHistoryDomainBinding);

export const runDiagnosticsView: DomainViewRequest<RunDiagnosticsDomainView> = Object.freeze({
  kind: "domain-view-request" as const,
  id: "niceeval.domain.run-diagnostics",
  [domainViewRequestTypeId]: (value: RunDiagnosticsDomainView) => value,
});
publishedDomainViewBindings.set(runDiagnosticsView, Object.freeze({
  read: (sample: Sample) => readRunDiagnosticsDomainView(sample),
}));

export interface DomainViewQuery<View extends DomainView> {
  readonly kind: "domain-view";
  readonly view: DomainViewRequest<View>;
  /**
   * When present, closes exactly one selected Attempt rather than eagerly
   * reading every included Attempt in the Sample.
   */
  readonly locator?: import("../attempt-locator.ts").AttemptLocator;
}

export function aggregate<By extends object, Values extends object>(
  sample: Sample,
  request: AggregateRequest<By, Values>,
): Promise<ClosedRows<AggregateRow<By, Values>>> {
  const capture = currentAnalysisIssueCapture(sample);
  return runSamplePromise(sample, aggregateEffect(sample, request, capture));
}

/**
 * Scoped host operation behind the public Promise facade. It is intentionally
 * absent from the `niceeval/analysis` export surface.
 *
 * @internal
 */
export function aggregateEffect<By extends object, Values extends object>(
  sample: Sample,
  request: AggregateRequest<By, Values>,
  capture?: AnalysisIssueCaptureToken,
): Effect.Effect<ClosedRows<AggregateRow<By, Values>>, SampleClosedError | AnalysisRequestError> {
  return Effect.flatMap(assertSampleOpen(sample), () => {
    const inferred = inferAggregatePopulation(request);
    if (inferred instanceof Error) return Effect.fail(requestError(inferred.message));
    return Effect.map(
      executeFrame(sample, {
        kind: "frame",
        population: inferred,
        by: request.by,
        measures: request.values,
      }, capture),
      (frame) => frame.rows,
    );
  });
}

export function query<Member, By extends object, Measures extends object>(
  sample: Sample,
  request: FrameQuery<Member, By, Measures>,
): Promise<SemanticFrame<By, Measures>>;
export function query<View extends DomainView>(
  sample: Sample,
  request: DomainViewQuery<View>,
): Promise<View>;
export function query(
  sample: Sample,
  request:
    | FrameQuery<unknown, object, object>
    | DomainViewQuery<DomainView>,
): Promise<SemanticFrame<object, object> | DomainView> {
  const capture = currentAnalysisIssueCapture(sample);
  const operation = request.kind === "frame"
    ? queryEffect(sample, request, capture)
    : queryEffect(sample, request, capture);
  return runSamplePromise<
    SemanticFrame<object, object> | DomainView,
    SampleClosedError | AnalysisRequestError
  >(sample, operation);
}

/**
 * Scoped host operation behind the public Promise facade. It is intentionally
 * absent from the `niceeval/analysis` export surface.
 *
 * @internal
 */
export function queryEffect<Member, By extends object, Measures extends object>(
  sample: Sample,
  request: FrameQuery<Member, By, Measures>,
  capture?: AnalysisIssueCaptureToken,
): Effect.Effect<SemanticFrame<By, Measures>, SampleClosedError | AnalysisRequestError>;
/** @internal */
export function queryEffect<View extends DomainView>(
  sample: Sample,
  request: DomainViewQuery<View>,
  capture?: AnalysisIssueCaptureToken,
): Effect.Effect<View, SampleClosedError | AnalysisRequestError>;
/** @internal */
export function queryEffect(
  sample: Sample,
  request:
    | FrameQuery<unknown, object, object>
    | DomainViewQuery<DomainView>,
  capture?: AnalysisIssueCaptureToken,
): Effect.Effect<
  SemanticFrame<object, object> | DomainView,
  SampleClosedError | AnalysisRequestError
> {
  if (request.kind === "frame") return executeFrame(sample, request, capture);
  const binding = publishedDomainViewBindings.get(request.view);
  if (binding === undefined) {
    return Effect.flatMap(assertSampleOpen(sample), () =>
      Effect.fail(requestError(`DomainView request ${request.view.id} is not published by Analysis`)),
    );
  }
  return Effect.flatMap(
    assertSampleOpen(sample),
    (): Effect.Effect<DomainView, SampleClosedError | AnalysisRequestError> => {
      const locator = request.locator;
      if (locator !== undefined) {
        if (typeof locator !== "string" || !parseAttemptLocator(locator).valid) {
          return Effect.fail(requestError("DomainView locator must be a canonical Attempt locator"));
        }
        const selected = sample.snapshot.slots.some((slot) =>
          slot.state === "included" && slot.attempt.locator === locator
        );
        if (!selected) {
          return Effect.fail(requestError("DomainView locator does not belong to the current Sample"));
        }
      }
      return Effect.map(binding.read(sample, locator), (view) => {
        recordAnalysisIssues(sample, view.issues, capture);
        return view;
      });
    },
  );
}

interface NormalizedFrameRequest {
  readonly population: Population<unknown>;
  readonly dimensions: readonly [string, Dimension<unknown, DimensionValue>][];
  readonly measures: readonly [string, Measure<unknown, unknown>][];
}

interface ResolvedMember {
  readonly member?: unknown;
  readonly issues: readonly AnalysisIssue[];
}

interface QueryContext {
  readonly sample: Sample;
  readonly relationTargets: Map<object, Map<string, string>>;
  readonly memberKeys: Map<object, readonly string[]>;
}

interface FrameGroup {
  readonly key: string;
  readonly coordinates: Readonly<Record<string, DimensionValue>>;
  readonly members: unknown[];
  readonly issues: AnalysisIssue[];
}

/** Bound independent Record reads without serializing large Report Samples. */
const ANALYSIS_READ_CONCURRENCY = 32;

type Reduced<Value> = {
  readonly state: "value" | "empty" | "missing" | "migration-required" | "unsupported" | "failed";
  readonly value?: Value;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly producers: readonly ProducerIdentity[];
};

function executeFrame<By extends object, Measures extends object>(
  sample: Sample,
  request: FrameQuery<unknown, By, Measures>,
  capture?: AnalysisIssueCaptureToken,
): Effect.Effect<SemanticFrame<By, Measures>, SampleClosedError | AnalysisRequestError> {
  return Effect.suspend<SemanticFrame<By, Measures>, SampleClosedError | AnalysisRequestError, never>(() => {
    const normalized = normalizeFrameRequest(request);
    if (normalized instanceof Error) return Effect.fail(requestError(normalized.message));
    return Effect.gen(function* () {
      yield* assertSampleOpen(sample);
      const context: QueryContext = {
        sample,
        relationTargets: new Map(),
        memberKeys: new Map(),
      };
      const groups = yield* buildGroups(context, normalized);
      const rows: Readonly<SemanticRow<By, Measures>>[] = [];
      const frameIssues: AnalysisIssue[] = [];
      const frameRefs: EvidenceRef[] = [];

      for (const group of groups) {
        const row: Record<string, unknown> = { key: group.key, ...group.coordinates };
        const values = yield* Effect.forEach(
          normalized.measures,
          ([name, measure]) => Effect.map(
            evaluateMeasure(context, normalized.population, group.members, measure),
            (value) => [name, measure, value] as const,
          ),
          { concurrency: ANALYSIS_READ_CONCURRENCY },
        );
        for (const [name, measure, value] of values) {
          row[name] = value;
          frameIssues.push(...value.issues);
          frameRefs.push(...value.refs);
          if (isCostMeasure(measure)) {
            recordAnalysisCostMetric(sample, {
              measureId: measure.id,
              row: Object.freeze({ key: group.key, dimensions: group.coordinates }),
              metric: value as CostMetricValue,
            }, capture);
          }
        }
        rows.push(Object.freeze(row) as SemanticRow<By, Measures>);
        frameIssues.push(...group.issues);
        frameRefs.push(...group.issues.flatMap((entry) => entry.refs));
      }

      const issues = freezeIssues(frameIssues);
      const refs = dedupeRefs([...frameRefs, ...issues.flatMap((entry) => entry.refs)]);
      const closedRows = makeClosedRows<SemanticRow<By, Measures>>({
        rows,
        identity: Object.freeze({
          kind: "closed-rows" as const,
          id: canonicalIdentity("closed-rows", [
            sample.snapshot.identity.id,
            normalized.population.id,
            normalized.dimensions.map(([name, dimension]) => [name, dimension.id]),
            normalized.measures.map(([name, measure]) => [name, measure.id]),
            groups.map((group) => Object.freeze([
              group.key,
              Object.freeze(group.members
                .map((member) => populationMembersState(normalized.population.members).key(member))
                .sort(compareCanonicalCodeUnits)),
            ])),
          ]),
        }),
        issues,
        refs,
      });
      const frame = Object.freeze({
        kind: "semantic-frame" as const,
        sample: sample.snapshot.identity,
        population: populationIdentity(normalized.population),
        rows: closedRows,
        issues,
        refs,
      });
      recordAnalysisIssues(sample, issues, capture);
      return frame;
    });
  });
}

function inferAggregatePopulation(
  request: AggregateRequest<object, object>,
): Population<unknown> | Error {
  const candidates: Population<unknown>[] = [];
  let hasCostMeasure = false;
  try {
    for (const dimension of Object.values(request.by)) {
      if (!isDimension(dimension)) return new Error("aggregate by must contain only Dimensions");
      candidates.push(dimension.population);
    }
    for (const measure of Object.values(request.values)) {
      const cost = isCostMeasure(measure);
      if (!cost && !isMeasure(measure)) return new Error("aggregate values must contain only Measures");
      if (cost) {
        // The CostMeasure descriptor, rather than a foreign package's
        // Population object or a string id, binds it to this package's
        // logical-Slot catalog.
        hasCostMeasure = true;
      } else {
        candidates.push((measure as Measure<unknown, unknown>).population);
      }
    }
  } catch (error) {
    return new Error(errorMessage(error));
  }
  if (hasCostMeasure) return logicalSlots as unknown as Population<unknown>;
  const first = candidates[0];
  return first === undefined ? new Error("aggregate needs at least one Dimension or Measure") : first;
}

function normalizeFrameRequest(
  request: FrameQuery<unknown, object, object>,
): NormalizedFrameRequest | Error {
  if (request === null || typeof request !== "object" || request.kind !== "frame") {
    return new Error("frame request must have kind frame");
  }
  try {
    if (!isPlainObject(request.by) || !isPlainObject(request.measures)) {
      return new Error("frame by and measures must be records");
    }
    const dimensions = Object.entries(request.by);
    const measures = Object.entries(request.measures);
    if (measures.length === 0) return new Error("frame request needs at least one Measure");
    const ids = new Set<string>();
    for (const [, dimension] of dimensions) {
      if (!isDimension(dimension)) return new Error("frame by must contain only Dimensions");
      if (ids.has(dimension.id)) return new Error(`Dimension identity collision: ${dimension.id}`);
      ids.add(dimension.id);
    }
    for (const [, measure] of measures) {
      const cost = isCostMeasure(measure);
      if (!cost && !isMeasure(measure)) return new Error("frame measures must contain only Measures");
      const descriptor = measure as Measure<unknown, unknown>;
      if (ids.has(descriptor.id)) return new Error(`Measure identity collision: ${descriptor.id}`);
      ids.add(descriptor.id);
    }
    const typedDimensions = dimensions.filter((entry): entry is [string, Dimension<unknown, DimensionValue>] =>
      isDimension(entry[1])
    );
    const typedMeasures = measures.filter((entry): entry is [string, Measure<unknown, unknown>] =>
      isCostMeasure(entry[1]) || isMeasure(entry[1])
    );
    // Explicit query Population capabilities stay package-local. Cross-package
    // CostMeasure support is limited to aggregate()'s Measure-driven inference;
    // a string id cannot author a new Population capability here.
    populationIdentity(request.population);
    const population = request.population;
    for (const [, descriptor] of [...typedDimensions, ...typedMeasures]) {
      const targetPopulation = isCostMeasure(descriptor)
        ? logicalSlots as unknown as Population<unknown>
        : descriptor.population;
      if (samePopulationMembers(population, targetPopulation)) continue;
      const links = registeredRelations().filter((relation) =>
        relation.from === population && relation.to === targetPopulation
      );
      if (links.length !== 1) {
        return new Error(
          `No unambiguous Relation connects ${population.id} to ${targetPopulation.id}`,
        );
      }
    }
    return Object.freeze({
      population,
      dimensions: Object.freeze(typedDimensions),
      measures: Object.freeze(typedMeasures),
    });
  } catch (error) {
    return new Error(errorMessage(error));
  }
}

function buildGroups(
  context: QueryContext,
  request: NormalizedFrameRequest,
): Effect.Effect<readonly FrameGroup[], SampleClosedError> {
  return Effect.gen(function* () {
    const baseMembers = yield* populationMembersState(request.population.members).enumerate(context.sample);
    const groups = new Map<string, FrameGroup>();
    for (const member of baseMembers) {
      const coordinates: Record<string, DimensionValue> = {};
      const issues: AnalysisIssue[] = [];
      for (const [name, dimension] of request.dimensions) {
        const resolved = yield* resolveMember(context, request.population, member, dimension.population);
        issues.push(...resolved.issues);
        if (resolved.member === undefined) {
          coordinates[name] = null;
          continue;
        }
        try {
          const value = dimensionState(dimension).value(resolved.member);
          if (!isDimensionValue(value)) {
            issues.push(issue("input-invalid", `Dimension ${dimension.id} returned a non-serializable value`));
            coordinates[name] = null;
          } else {
            coordinates[name] = value;
          }
        } catch (error) {
          issues.push(issue("input-invalid", `Dimension ${dimension.id} failed: ${errorMessage(error)}`));
          coordinates[name] = null;
        }
      }
      const key = groupKey(coordinates);
      const previous = groups.get(key);
      if (previous === undefined) {
        groups.set(key, {
          key,
          coordinates: Object.freeze({ ...coordinates }),
          members: [member],
          issues,
        });
      } else {
        previous.members.push(member);
        previous.issues.push(...issues);
      }
    }
    return Object.freeze([...groups.values()].sort((left, right) =>
      compareCanonicalCodeUnits(left.key, right.key)
    ));
  });
}

function evaluateMeasure(
  context: QueryContext,
  sourcePopulation: Population<unknown>,
  sourceMembers: readonly unknown[],
  measure: Measure<unknown, unknown>,
): Effect.Effect<MetricValue<unknown> | CostMetricValue, SampleClosedError> {
  return Effect.gen(function* () {
    const cost = costMeasureState(measure);
    if (cost !== undefined) {
      return yield* evaluateCostMeasure(context, sourcePopulation, sourceMembers, cost);
    }
    const state = measureStateFor(measure);
    const denominator = denominatorState(state.denominator);
    const resolved: Reduced<unknown>[] = [];
    const targetMembers: unknown[] = [];

    const targets = yield* Effect.forEach(
      sourceMembers,
      (sourceMember) => resolveMember(context, sourcePopulation, sourceMember, measure.population),
      { concurrency: ANALYSIS_READ_CONCURRENCY },
    );
    for (const target of targets) {
      if (target.member === undefined) {
        resolved.push(failedReduced(target.issues));
      } else {
        targetMembers.push(target.member);
      }
    }
    const expectedMembers = denominator.members(targetMembers);
    const observations = yield* Effect.forEach(
      expectedMembers,
      (member) => Effect.map(
        analysisInputState(state.input).read(context.sample, member),
        (observation) => {
          const withinAttempt = reduce(
            reductionState(state.withinAttempt).kind,
            [fromObservation(observation)],
          );
          return reduce(
            reductionState(state.withinSlot).kind,
            [withinAttempt],
          );
        },
      ),
      { concurrency: ANALYSIS_READ_CONCURRENCY },
    );
    resolved.push(...observations);

    const across = reduce(
      reductionState(state.acrossSlots).kind,
      resolved,
    );
    return metricValue({
      measure,
      slots: resolved,
      across,
      total: resolved.length,
      basis: denominator.basis,
      enforceSameProducer: producerPolicyIsRequired(state.producers),
    });
  });
}

function evaluateCostMeasure(
  context: QueryContext,
  sourcePopulation: Population<unknown>,
  sourceMembers: readonly unknown[],
  state: NonNullable<ReturnType<typeof costMeasureState>>,
): Effect.Effect<CostMetricValue, SampleClosedError> {
  return Effect.gen(function* () {
    const resolved = yield* Effect.forEach(
      sourceMembers,
      (member) => resolveMember(
        context,
        sourcePopulation,
        member,
        logicalSlots as unknown as Population<unknown>,
      ),
      { concurrency: ANALYSIS_READ_CONCURRENCY },
    );
    const relationIssues = freezeIssues(resolved.flatMap((entry) => entry.issues));
    const keys = new Set(resolved.flatMap((entry) =>
      entry.member === undefined ? [] : [logicalSlotKey(entry.member as LogicalSlot)]
    ));
    const entries = yield* readCostProjection(context.sample, state.profile);
    const reduced = aggregateCostProjection(
      state.profile,
      entries.filter((entry) => keys.has(logicalSlotKey(entry.slot))),
      state.mode,
    );
    return Object.freeze({
      value: reduced.value,
      state: reduced.projection.state,
      samples: reduced.samples,
      total: reduced.total,
      basis: "slot" as const,
      issues: relationIssues,
      refs: dedupeRefs([...reduced.refs, ...relationIssues.flatMap((entry) => entry.refs)]),
      format: "currency-usd" as const,
      better: "lower" as const,
      projection: reduced.projection,
    });
  });
}

function logicalSlotKey(slot: Pick<LogicalSlot, "runId" | "slotId">): string {
  return `${slot.runId}\u0000${slot.slotId}`;
}

function resolveMember(
  context: QueryContext,
  from: Population<unknown>,
  member: unknown,
  to: Population<unknown>,
): Effect.Effect<ResolvedMember, SampleClosedError> {
  if (samePopulationMembers(from, to)) {
    return Effect.succeed(Object.freeze({ member, issues: Object.freeze([]) }));
  }
  const candidates = registeredRelations().filter((relation) => relation.from === from && relation.to === to);
  if (candidates.length !== 1) {
    return Effect.succeed(unmatched(`No unambiguous Relation connects ${from.id} to ${to.id}`));
  }
  const relation = candidates[0]!;
  let target: unknown | null;
  try {
    target = relationState(relation).match(member);
  } catch (error) {
    return Effect.succeed(unmatched(`Relation ${relation.id} failed: ${errorMessage(error)}`));
  }
  if (target === null) return Effect.succeed(unmatched(`Relation ${relation.id} did not match a target`));

  return Effect.flatMap(memberKeys(context, to), (targets) => {
    let targetKey: string;
    let sourceKey: string;
    try {
      targetKey = populationMembersState(to.members).key(target);
      sourceKey = populationMembersState(from.members).key(member);
    } catch (error) {
      return Effect.succeed(unmatched(`Relation ${relation.id} returned an invalid target: ${errorMessage(error)}`));
    }
    if (!targets.includes(targetKey)) {
      return Effect.succeed(unmatched(`Relation ${relation.id} returned a target outside ${to.id}`));
    }
    if (relation.cardinality === "one-to-one") {
      let seen = context.relationTargets.get(relation);
      if (seen === undefined) {
        seen = new Map();
        context.relationTargets.set(relation, seen);
      }
      const previous = seen.get(targetKey);
      if (previous !== undefined && previous !== sourceKey) {
        return Effect.succeed(unmatched(`Relation ${relation.id} violates one-to-one cardinality`));
      }
      seen.set(targetKey, sourceKey);
    }
    return Effect.succeed(Object.freeze({ member: target, issues: Object.freeze([]) }));
  });
}

function memberKeys(
  context: QueryContext,
  population: Population<unknown>,
): Effect.Effect<readonly string[], SampleClosedError> {
  const cached = context.memberKeys.get(population);
  if (cached !== undefined) return Effect.succeed(cached);
  return Effect.map(populationMembersState(population.members).enumerate(context.sample), (members) => {
    const keys = Object.freeze(members.map((member) => populationMembersState(population.members).key(member)));
    context.memberKeys.set(population, keys);
    return keys;
  });
}

function fromObservation<Value>(observation: import("./contracts.ts").SampleInputObservation<Value>): Reduced<Value> {
  if (observation.state === "value") {
    if (observation.value === null) {
      return Object.freeze({
        state: "empty" as const,
        issues: Object.freeze([]),
        refs: observation.refs,
        producers: observation.producer === undefined ? Object.freeze([]) : Object.freeze([observation.producer]),
      });
    }
    return Object.freeze({
      state: "value" as const,
      value: observation.value,
      issues: Object.freeze([]),
      refs: observation.refs,
      producers: observation.producer === undefined ? Object.freeze([]) : Object.freeze([observation.producer]),
    });
  }
  return Object.freeze({
    state: observation.state,
    issues: observation.issues,
    refs: observation.refs,
    producers: observation.producer === undefined ? Object.freeze([]) : Object.freeze([observation.producer]),
  });
}

function reduce(kind: import("./definitions.ts").ReductionKind, entries: readonly Reduced<unknown>[]): Reduced<unknown> {
  const metadata = reductionMetadata(entries);
  if (entries.some((entry) => entry.state === "failed")) {
    return failedReduced(metadata.issues, metadata.refs, metadata.producers);
  }
  const values = entries.filter((entry): entry is Reduced<unknown> & { readonly state: "value"; readonly value: unknown } =>
    entry.state === "value"
  );
  if (values.length === 0) {
    if (entries.length > 0 && entries.every((entry) => entry.state === "migration-required")) {
      return migrationRequiredReduced(metadata.issues, metadata.refs, metadata.producers);
    }
    if (entries.some((entry) => entry.state === "missing")) {
      return missingReduced(metadata.issues, metadata.refs, metadata.producers);
    }
    if (entries.some((entry) => entry.state === "unsupported")) {
      return unsupportedReduced(metadata.issues, metadata.refs, metadata.producers);
    }
    return emptyReduced(metadata.issues, metadata.refs, metadata.producers);
  }
  try {
    switch (kind) {
      case "one-value":
        if (values.length !== 1) return failedReduced([
          ...metadata.issues,
          issue("reduction-failed", "oneValue received more than one input"),
        ], metadata.refs, metadata.producers);
        return valueReduced(values[0]!.value, metadata.issues, metadata.refs, metadata.producers);
      case "latest-completed-attempt":
        return valueReduced(values.at(-1)!.value, metadata.issues, metadata.refs, metadata.producers);
      case "sum": {
        const sum = values.reduce((total, entry) => total + finiteNumber(entry.value), 0);
        return valueReduced(sum, metadata.issues, metadata.refs, metadata.producers);
      }
      case "mean": {
        const sum = values.reduce((total, entry) => total + finiteNumber(entry.value), 0);
        return valueReduced(sum / values.length, metadata.issues, metadata.refs, metadata.producers);
      }
      case "ratio": {
        const passed = values.reduce((total, entry) => total + (booleanValue(entry.value) ? 1 : 0), 0);
        return valueReduced(passed / values.length, metadata.issues, metadata.refs, metadata.producers);
      }
    }
  } catch (error) {
    return failedReduced([
      ...metadata.issues,
      issue("reduction-failed", errorMessage(error)),
    ], metadata.refs, metadata.producers);
  }
}

function metricValue(input: {
  readonly measure: Measure<unknown, unknown>;
  readonly slots: readonly Reduced<unknown>[];
  readonly across: Reduced<unknown>;
  readonly total: number;
  readonly basis: MetricBasis;
  readonly enforceSameProducer: boolean;
}): MetricValue<unknown> {
  const issues = [...input.slots.flatMap((slot) => slot.issues), ...input.across.issues];
  const refs = dedupeRefs([...input.slots.flatMap((slot) => slot.refs), ...input.across.refs]);
  const producers = new Set(input.slots.flatMap((slot) => slot.producers).map((producer) => producer.id));
  const producerConflict = input.enforceSameProducer && producers.size > 1;
  if (producerConflict) {
    issues.push(issue("producer-incompatible", "Measure requires one comparable producer"));
  }
  const frozenIssues = freezeIssues(issues);
  const samples = input.slots.filter((slot) => slot.state === "value" || slot.state === "empty").length;
  const common = {
    samples,
    total: input.total,
    basis: input.basis,
    issues: frozenIssues,
    refs,
    ...(input.measure.unit === undefined ? {} : { unit: input.measure.unit }),
    ...(input.measure.format === undefined ? {} : { format: closeFormat(input.measure.format) }),
    ...(input.measure.better === undefined ? {} : { better: input.measure.better }),
  };

  if (producerConflict || input.slots.some((slot) => slot.state === "failed") || input.across.state === "failed") {
    return Object.freeze({ value: null, state: "failed" as const, ...common });
  }
  if (input.total === 0) {
    return Object.freeze({ value: null, state: "empty" as const, ...common });
  }
  const values = input.slots.filter((slot) => slot.state === "value");
  const migrationRequired = input.slots.filter((slot) => slot.state === "migration-required");
  const unsupported = input.slots.filter((slot) => slot.state === "unsupported");
  const missing = input.slots.filter((slot) => slot.state === "missing");
  const empty = input.slots.filter((slot) => slot.state === "empty");
  if (values.length === 0 && migrationRequired.length === input.total) {
    return Object.freeze({ value: null, state: "migration-required" as const, ...common });
  }
  if (values.length === 0 && unsupported.length === input.total) {
    return Object.freeze({ value: null, state: "unsupported" as const, ...common });
  }
  if (values.length === 0 && empty.length === input.total) {
    return Object.freeze({ value: null, state: "empty" as const, ...common });
  }
  if (samples < input.total || missing.length > 0 || migrationRequired.length > 0 || unsupported.length > 0) {
    return Object.freeze({
      value: input.across.state === "value" ? input.across.value! : null,
      state: "partial" as const,
      ...common,
    });
  }
  if (input.across.state === "empty") {
    return Object.freeze({ value: null, state: "empty" as const, ...common });
  }
  if (input.across.state === "migration-required") {
    return Object.freeze({ value: null, state: "migration-required" as const, ...common });
  }
  if (input.across.state === "unsupported") {
    return Object.freeze({ value: null, state: "unsupported" as const, ...common });
  }
  if (input.across.state === "missing") {
    return Object.freeze({ value: null, state: "partial" as const, ...common });
  }
  return Object.freeze({ value: input.across.value!, state: "available" as const, ...common });
}

function reductionMetadata(entries: readonly Reduced<unknown>[]): {
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly producers: readonly ProducerIdentity[];
} {
  return Object.freeze({
    issues: freezeIssues(entries.flatMap((entry) => entry.issues)),
    refs: dedupeRefs(entries.flatMap((entry) => entry.refs)),
    producers: Object.freeze(entries.flatMap((entry) => entry.producers)),
  });
}

function valueReduced(
  value: unknown,
  issues: readonly AnalysisIssue[],
  refs: readonly EvidenceRef[],
  producers: readonly ProducerIdentity[],
): Reduced<unknown> {
  return Object.freeze({ state: "value" as const, value, issues: freezeIssues(issues), refs, producers });
}

function emptyReduced(
  issues: readonly AnalysisIssue[],
  refs: readonly EvidenceRef[] = [],
  producers: readonly ProducerIdentity[] = [],
): Reduced<never> {
  return Object.freeze({ state: "empty" as const, issues: freezeIssues(issues), refs: dedupeRefs(refs), producers });
}

function missingReduced(
  issues: readonly AnalysisIssue[],
  refs: readonly EvidenceRef[] = [],
  producers: readonly ProducerIdentity[] = [],
): Reduced<never> {
  return Object.freeze({ state: "missing" as const, issues: freezeIssues(issues), refs: dedupeRefs(refs), producers });
}

function migrationRequiredReduced(
  issues: readonly AnalysisIssue[],
  refs: readonly EvidenceRef[] = [],
  producers: readonly ProducerIdentity[] = [],
): Reduced<never> {
  return Object.freeze({
    state: "migration-required" as const,
    issues: freezeIssues(issues),
    refs: dedupeRefs(refs),
    producers,
  });
}

function unsupportedReduced(
  issues: readonly AnalysisIssue[],
  refs: readonly EvidenceRef[] = [],
  producers: readonly ProducerIdentity[] = [],
): Reduced<never> {
  return Object.freeze({ state: "unsupported" as const, issues: freezeIssues(issues), refs: dedupeRefs(refs), producers });
}

function failedReduced(
  issues: readonly AnalysisIssue[],
  refs: readonly EvidenceRef[] = [],
  producers: readonly ProducerIdentity[] = [],
): Reduced<never> {
  return Object.freeze({
    state: "failed" as const,
    issues: freezeIssues(issues),
    refs: dedupeRefs(refs),
    producers: Object.freeze([...producers]),
  });
}

function unmatched(message: string): ResolvedMember {
  return Object.freeze({
    issues: Object.freeze([issue("relation-unmatched", message)]),
  });
}

function issue(code: AnalysisIssue["code"], message: string, refs: readonly EvidenceRef[] = []): AnalysisIssue {
  return Object.freeze({ code, message, refs: dedupeRefs(refs) });
}

function freezeIssues(issues: readonly AnalysisIssue[]): readonly AnalysisIssue[] {
  const byIdentity = new Map<string, AnalysisIssue>();
  for (const value of issues) {
    const refs = dedupeRefs(value.refs);
    const key = `${value.code}\u0000${value.message}\u0000${refs.map(evidenceRefIdentity).join("\u0001")}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, Object.freeze({ code: value.code, message: value.message, refs }));
    }
  }
  return Object.freeze(
    [...byIdentity.entries()]
      .sort(([left], [right]) => compareCanonicalCodeUnits(left, right))
      .map(([, value]) => value),
  );
}

function dedupeRefs(refs: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const byIdentity = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    const key = evidenceRefIdentity(ref);
    if (!byIdentity.has(key)) {
      byIdentity.set(key, Object.freeze({ identity: Object.freeze({ ...ref.identity }) }));
    }
  }
  return Object.freeze(
    [...byIdentity.entries()]
      .sort(([left], [right]) => compareCanonicalCodeUnits(left, right))
      .map(([, value]) => value),
  );
}

function evidenceRefIdentity(ref: EvidenceRef): string {
  return `${ref.identity.kind}\u0000${ref.identity.locator}`;
}

function closeFormat(format: import("./contracts.ts").MeasureFormat): import("./contracts.ts").MeasureFormat {
  if (typeof format === "string") return format;
  return Object.freeze({
    kind: format.kind,
    ...(format.options === undefined ? {} : { options: cloneJson(format.options) }),
  });
}

function cloneJson(value: import("./contracts.ts").JsonValue): import("./contracts.ts").JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(cloneJson));
  const result: { [key: string]: import("./contracts.ts").JsonValue } = {};
  for (const [key, entry] of Object.entries(value)) result[key] = cloneJson(entry);
  return Object.freeze(result);
}

function groupKey(coordinates: Readonly<Record<string, DimensionValue>>): string {
  const encoded = Object.entries(coordinates)
    .sort(([left], [right]) => compareCanonicalCodeUnits(left, right))
    .map(([key, value]) => Object.freeze([key, value] as const));
  return canonicalIdentity("row", encoded);
}

/** Locale-independent ordering for all Analysis identities and closed output. */
function compareCanonicalCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Canonical identities retain their complete normalized input.  They are not
 * bounded hashes, so distinct coordinates cannot collapse through a digest
 * collision.
 */
function canonicalIdentity(namespace: string, value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Analysis identity input must be JSON-serializable");
  return `${namespace}-v1:${encoded}`;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("reduction expected a finite number");
  return value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("ratio reduction expected a boolean");
  return value;
}

function isDimensionValue(value: unknown): value is DimensionValue {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDimension(value: unknown): value is Dimension<unknown, DimensionValue> {
  return typeof value === "object" && value !== null && (value as { readonly kind?: unknown }).kind === "dimension";
}

function isMeasure(value: unknown): value is Measure<unknown, unknown> {
  return typeof value === "object" && value !== null && (value as { readonly kind?: unknown }).kind === "measure";
}


function samePopulationMembers(left: Population<unknown>, right: Population<unknown>): boolean {
  return left === right || left.members === right.members;
}

function measureStateFor(measure: Measure<unknown, unknown>): {
  readonly input: AnalysisInput<unknown, unknown>;
  readonly withinAttempt: WithinAttemptReduction<unknown, unknown>;
  readonly withinSlot: WithinSlotReduction<unknown, unknown>;
  readonly acrossSlots: AcrossSlotsReduction<unknown, unknown>;
  readonly denominator: Denominator<unknown>;
  readonly missing: MissingPolicy;
  readonly evidence: EvidencePolicy;
  readonly producers?: ProducerPolicy;
} {
  return measureState(measure);
}

function requestError(reason: string): AnalysisRequestError {
  return Object.freeze({ code: "analysis-request-invalid" as const, reason });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "an unknown definition error occurred";
}

// Keeps the catalog helper reachable in generated type declarations without
// opening a second definition surface for application code.
export type BuiltinLogicalSlotDenominator = ReturnType<typeof allLogicalSlots<LogicalSlot>>;
