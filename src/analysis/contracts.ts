import type { MembershipAction } from "../record/model/core.ts";
import type {
  AttemptId,
  EvalId,
  ExecutionIdentityDigest,
  ExperimentId,
  RunId,
  SlotId,
  UtcMillis,
} from "../record/model/identifiers.ts";
import type { AttemptLocator } from "../attempt-locator.ts";

export type {
  AttemptId,
  EvalId,
  ExecutionIdentityDigest,
  ExperimentId,
  RunId,
  SlotId,
  UtcMillis,
};

/** JSON is the only wire shape accepted by the Sample snapshot codec. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Stable identity for one Sample capability and its portable snapshot. */
export interface SampleIdentity {
  readonly kind: "analysis-sample";
  readonly id: string;
}

/**
 * A public identity for evidence from one immutable Attempt.  It deliberately
 * carries a locator rather than Record's nominal selected-reference capability
 * or an AttemptId that could be used as an ad-hoc storage lookup.
 */
export interface AttemptEvidenceIdentity {
  readonly kind: "attempt";
  readonly locator: AttemptLocator;
  readonly originRunId: RunId;
}

export type AnalysisSelectionProblem =
  | { readonly code: "incomplete-run"; readonly runId: RunId }
  | { readonly code: "record-core-invalid"; readonly runId: RunId }
  | { readonly code: "selection-run-missing"; readonly runId: RunId }
  | { readonly code: "selection-run-unreadable"; readonly runId: RunId };

/**
 * One current target Slot identity. `project-current` keeps only Sample
 * members whose experiment/eval/attempt ordinal aligns, then whose digest
 * still narrows that aligned identity.
 */
export interface AnalysisCurrentSlotIdentity {
  readonly experimentId: ExperimentId;
  readonly evalId: EvalId;
  /** Logical attempt identity; never inferred from expectedSlots array order. */
  readonly attemptOrdinal: number;
  /** Narrows an already aligned logical identity; it is not the alignment key. */
  readonly executionIdentityDigest: ExecutionIdentityDigest;
}

/** Exact occurrence retained after project-current logical alignment. */
export interface AnalysisSlotOccurrenceIdentity {
  readonly runId: RunId;
  readonly slotId: SlotId;
}

/** Host-issued selection used by Application, CLI, and Report from-record. */
export type AnalysisSelectionRequest =
  | {
      readonly policy: "explicit-runs";
      readonly runIds: readonly RunId[];
    }
  | {
      readonly policy: "project-current";
      readonly experimentIds?: readonly ExperimentId[];
      readonly currentSlots: readonly AnalysisCurrentSlotIdentity[];
    };

/**
 * The exact selection audit retained by a closed SampleSnapshot. `runIds` are
 * the explicit request; `selectedRunIds` are recomputed from the current,
 * non-excluded Sample frame after every monotonic narrowing.
 */
export type AnalysisSelectionSummary =
  | {
      readonly policy: "explicit-runs";
      readonly runIds: readonly RunId[];
      readonly selectedRunIds: readonly RunId[];
      readonly problems: readonly AnalysisSelectionProblem[];
    }
  | {
      readonly policy: "project-current";
      readonly experimentIds: readonly ExperimentId[] | "all";
      readonly selectedRunIds: readonly RunId[];
      readonly problems: readonly AnalysisSelectionProblem[];
    };

export interface AnalysisRun {
  readonly runId: RunId;
  readonly experimentId: ExperimentId;
  /**
   * The safe, immutable portion of the selected Run's Core context. A later
   * Core read can be unavailable after selection, in which case no context is
   * invented for that Run.
   */
  readonly context: AnalysisRunContext | null;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
}

/**
 * Display- and grouping-safe Run configuration retained by a Sample. It has
 * no Record capability and is recursively JSON-only.
 */
export interface AnalysisRunContext {
  readonly execution: AnalysisRunExecution;
  readonly labels: Readonly<Record<string, string>>;
}

export interface AnalysisRunExecution {
  readonly agentId: string;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly flags: Readonly<Record<string, JsonValue>>;
}

export interface AnalysisSlotRef {
  /** Occurrence identity is always the exact selected Run/Slot pair. */
  readonly runId: RunId;
  readonly slotId: SlotId;
  /** Derived from the associated selected AnalysisRun, never a Record Slot field. */
  readonly experimentId: ExperimentId;
  /** Logical alignment is experiment + eval + durable attempt ordinal. */
  readonly evalId: EvalId;
  readonly attemptOrdinal: number;
  /** This remains an identity-narrowing value, never a logical alignment key. */
  readonly executionIdentityDigest: ExecutionIdentityDigest;
}

/** A Member with an exact origin Attempt. */
export interface IncludedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "included";
  /** Core provenance is not inferred from whether the Attempt is local. */
  readonly action: "executed" | "carried" | "accepted";
  readonly relation: "origin" | "reference";
  readonly attempt: AttemptEvidenceIdentity;
}

/**
 * An expected Slot without an Attempt. `null` means no Member document was
 * recorded; the two actions retain a recorded null Member without suggesting
 * that it is pending work.
 */
export interface NotRecordedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "not-recorded";
  readonly action: "not-dispatched" | "interrupted" | null;
  readonly attempt: null;
}

/** Core could be read far enough to identify the frame but not its member. */
export interface CoreInvalidAnalysisSlot extends AnalysisSlotRef {
  readonly state: "core-invalid";
  readonly action: MembershipAction | null;
  readonly attempt: null;
  readonly issues: readonly AnalysisIssue[];
}

export type ActiveAnalysisSlot =
  | IncludedAnalysisSlot
  | NotRecordedAnalysisSlot
  | CoreInvalidAnalysisSlot;

/** A monotonic Sample narrowing preserves the previous, non-nested state. */
export interface ExcludedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "excluded";
  readonly base: ActiveAnalysisSlot;
  /** Present when `project-current` dropped this Slot for identity mismatch. */
  readonly reason?: "identity-mismatch";
}

export type AnalysisSlot = ActiveAnalysisSlot | ExcludedAnalysisSlot;

export interface SampleCoverage {
  readonly frameTotal: number;
  readonly selected: number;
  readonly included: number;
  readonly notRecorded: number;
  readonly coreInvalid: number;
  readonly excluded: number;
}

/**
 * The closed, portable representation of a Record selection. It contains
 * only selection identity, Core-derived Run/Slot denominator facts, and
 * selection problems. Decoding it can never reopen a Record.
 */
export interface SampleSnapshot {
  readonly version: 1;
  readonly identity: SampleIdentity;
  readonly selection: AnalysisSelectionSummary;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
  readonly coverage: SampleCoverage;
}

export const sampleCapabilityTypeId: unique symbol = Symbol(
  "niceeval.analysis.Sample",
);

/** A Host-issued, Scope-bound lazy Record-reading capability. */
export interface Sample {
  readonly kind: "analysis-sample";
  readonly snapshot: SampleSnapshot;
  readonly [sampleCapabilityTypeId]: true;
}

export type ExperimentGroupIdentity =
  | { readonly kind: "named"; readonly groupId: string; readonly key: `named/${string}` }
  | { readonly kind: "singleton"; readonly experimentId: ExperimentId; readonly key: `singleton/${string}` };

export type NonComparableReason =
  | "eval-population-mismatch"
  | "evaluation-kind-mismatch"
  | "population-unavailable"
  | "measure-population-mismatch"
  | "measure-basis-mismatch"
  | "measure-basis-unavailable";

export interface NonComparableIssue {
  readonly reason: NonComparableReason;
  readonly members: readonly ExperimentId[];
  readonly actual: readonly {
    readonly member: ExperimentId;
    readonly population: JsonValue | null;
    readonly basis: JsonValue | null;
  }[];
  readonly refs: readonly EvidenceRef[];
  readonly params: Readonly<Record<string, JsonValue>>;
}

export type ExperimentComparisonState =
  | { readonly state: "comparable"; readonly members: readonly ExperimentId[] }
  | {
      readonly state: "non-comparable";
      readonly members: readonly ExperimentId[];
      readonly issues: readonly NonComparableIssue[];
    };

const experimentComparisonScopeTypeId: unique symbol = Symbol("niceeval.analysis.ExperimentComparisonScope");

/** Analysis-issued comparison capability; the backing Sample remains private. */
export interface ExperimentComparisonScope {
  readonly group: ExperimentGroupIdentity;
  readonly comparison: ExperimentComparisonState;
  readonly [experimentComparisonScopeTypeId]: true;
}

export interface AnalysisComparisonGroupMismatchError {
  readonly code: "analysis-comparison-group-mismatch";
  readonly groups: readonly ExperimentGroupIdentity[];
}

export interface SampleSelector {
  readonly runIds?: readonly RunId[];
  readonly slotIds?: readonly SlotId[];
}

export interface SampleClosedError {
  readonly code: "analysis-sample-closed";
  readonly sample: SampleIdentity;
}

export interface SampleSnapshotCodecError {
  readonly code: "sample-snapshot-invalid";
  readonly path: readonly string[];
  readonly reason: string;
}

export interface AnalysisRequestError {
  readonly code: "analysis-request-invalid";
  readonly reason: string;
}

export type AnalysisInputIssueCode =
  | "missing"
  | "migration-required"
  | "unsupported"
  | "producer-incompatible"
  | "input-invalid"
  | "reduction-failed"
  | "relation-unmatched";

export interface EvidenceIdentity {
  readonly kind: "attempt";
  readonly locator: AttemptLocator;
}

export interface EvidenceRef {
  readonly identity: EvidenceIdentity;
}

export interface AnalysisIssue {
  readonly code: AnalysisInputIssueCode;
  readonly message: string;
  readonly refs: readonly EvidenceRef[];
}

export interface ProducerIdentity {
  readonly id: string;
}

/** Internal result of a published AnalysisInput read. It never reaches Report. */
export type SampleInputObservation<Value> =
  | {
      readonly state: "value";
      readonly value: Value;
      readonly refs: readonly EvidenceRef[];
      readonly producer?: ProducerIdentity;
    }
  | {
      readonly state: "missing" | "migration-required" | "unsupported" | "failed";
      readonly issues: readonly AnalysisIssue[];
      readonly refs: readonly EvidenceRef[];
      readonly producer?: ProducerIdentity;
    };

export type MetricState =
  | "available"
  | "partial"
  /** A specialized closed metric may have no reportable value at all. */
  | "unavailable"
  | "empty"
  | "migration-required"
  | "unsupported"
  | "failed";

export type MetricBasis = "attempt" | "eval" | "run" | "pair" | "slot";

export type MeasureFormat =
  | string
  | {
      readonly kind: string;
      readonly options?: JsonValue;
    };

/** A closed Measure cell: never a selected Record handle or reader callback. */
export interface MetricValue<Value = number> {
  readonly value: Value | null;
  readonly state: MetricState;
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricBasis;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly bounds?: { readonly min?: number; readonly max?: number };
}

export interface ClosedRowsIdentity {
  readonly kind: "closed-rows";
  readonly id: string;
}

const closedRowsTypeId: unique symbol = Symbol("niceeval.analysis.ClosedRows");

/** @internal Metadata is retained out-of-band so an ordinary array cannot forge it. */
export interface ClosedRowsMetadata {
  readonly identity: ClosedRowsIdentity;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

const closedRowsBrands = new WeakSet<object>();
const closedRowsMetadataByValue = new WeakMap<object, ClosedRowsMetadata>();

/** A branded, frozen array produced only by Analysis query execution. */
export interface ClosedRows<Row> extends ReadonlyArray<Readonly<Row>> {
  readonly [closedRowsTypeId]: true;
  readonly identity: ClosedRowsIdentity;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

/** @internal Keeps the brand unforgeable to normal public callers. */
export function makeClosedRows<Row>(input: {
  readonly rows: readonly Readonly<Row>[];
  readonly identity: ClosedRowsIdentity;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}): ClosedRows<Row> {
  const rows = [...input.rows] as unknown as ClosedRows<Row>;
  const metadata: ClosedRowsMetadata = Object.freeze({
    identity: Object.freeze({ kind: input.identity.kind, id: input.identity.id }),
    issues: Object.freeze([...input.issues]),
    refs: Object.freeze([...input.refs]),
  });
  Object.defineProperties(rows, {
    [closedRowsTypeId]: { value: true, enumerable: false },
    identity: { value: metadata.identity, enumerable: true },
    issues: { value: metadata.issues, enumerable: true },
    refs: { value: metadata.refs, enumerable: true },
  });
  closedRowsBrands.add(rows);
  closedRowsMetadataByValue.set(rows, metadata);
  return Object.freeze(rows);
}

/** @internal Checks actual Analysis issuance, rather than structural shape. */
export function isClosedRows(value: unknown): value is ClosedRows<unknown> {
  return Array.isArray(value)
    && closedRowsBrands.has(value)
    && Reflect.get(value, closedRowsTypeId) === true;
}

/** @internal Returns immutable metadata registered at Analysis close time. */
export function closedRowsMetadata(value: unknown): ClosedRowsMetadata | undefined {
  return isClosedRows(value) ? closedRowsMetadataByValue.get(value) : undefined;
}

export interface PopulationIdentity {
  readonly kind: "population";
  readonly id: string;
}

/** The common, entirely closed base of every published DomainView. */
export interface DomainView {
  readonly kind: "domain-view";
  readonly identity: { readonly kind: "domain-view"; readonly id: string };
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}
