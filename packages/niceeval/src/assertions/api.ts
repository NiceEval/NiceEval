import type { Effect } from "effect";

import type {
  BooleanMatch,
  CollectionMatch,
  ManagedToolCalls,
  MatchDiagnostic,
  NumericComparator,
  NumericComparisonMatch,
  ScoreMatch,
  ThresholdedScoreMatch,
  ToolMatch,
} from "./match.ts";
import type { AgentWorkspaceDiff } from "./workspace-diff.ts";

/** The two Evaluation kinds deliberately share one Assertion entry model. */
export type AssertionEvaluationKind = "pass" | "score";

/**
 * A bounded JSON-shaped value owned by the authoring runtime.  It is a
 * domain value, not the durable Assertions attachment material type.
 */
export type AssertionSnapshotValue =
  | null
  | boolean
  | number
  | string
  | readonly AssertionSnapshotValue[]
  | AssertionSnapshotObject;

export interface AssertionSnapshotObject {
  readonly [key: string]: AssertionSnapshotValue;
}

export interface AssertionDisplay {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
}

export type AssertionCoverage =
  | { readonly state: "complete" }
  | {
      readonly state: "partial";
      readonly reason: "sampled" | "truncated" | "redacted" | "provider-limited";
    }
  | {
      readonly state: "unavailable";
      readonly reason: "not-collected" | "source-unavailable" | "producer-failed";
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "optional-material" | "unsupported-subject";
    };

export type AssertionLimitation =
  | { readonly kind: "redacted"; readonly fieldCount: number }
  | { readonly kind: "sampled"; readonly captured: number; readonly knownTotal?: number }
  | { readonly kind: "truncated"; readonly omittedBytes: number }
  | { readonly kind: "provider-limited" };

/**
 * Authoring material intentionally has no blob ref, attachment entry ID, or
 * durable schema identity. The private producer adapter selects the exact
 * same-owner Attachment schema when it serializes this domain reference.
 */
export type AssertionMaterial =
  | { readonly kind: "snapshot"; readonly value: AssertionSnapshotValue }
  | {
      readonly kind: "record-attachment";
      readonly preview: string;
    };

export type AssertionCriterion =
  | {
      readonly kind: "value-match";
      readonly subject: "explicit-value";
      readonly matcher: { readonly state: "declared"; readonly name: string } | { readonly state: "unavailable" };
    }
  | {
      /** Package-private runtime variant encoded as numeric-comparison/v1. */
      readonly kind: "value-match";
      readonly numeric: {
        readonly comparator: NumericComparator;
        readonly threshold: number;
        readonly subject:
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
      };
    }
  | {
      readonly kind: "scope-status";
      readonly scope: "turn" | "session" | "attempt";
      readonly assertion: "succeeded" | "no-failed-actions";
    }
  | {
      readonly kind: "occurrence";
      readonly scope: "turn" | "session" | "attempt";
      readonly occurrence: "tool" | "skill" | "event";
      readonly assertion: "present" | "absent" | "count" | "order";
      readonly matcher?: string;
      readonly quantifier?:
        | { readonly kind: "absent" }
        | {
            readonly kind: "at-least" | "less-than" | "at-most" | "greater-than" | "exact";
            readonly count: number;
          };
    }
  | {
      readonly kind: "judge-measurement";
      readonly recipe: "closed-qa" | "factuality" | "summarizes";
      readonly scale: "unit-interval";
    }
  | {
      readonly kind: "sandbox-result";
      readonly operation: "changed-paths";
      readonly paths: readonly string[];
    }
  | { readonly kind: "sandbox-result"; readonly operation: "no-changes" }
  | {
      readonly kind: "sandbox-result";
      readonly operation: "file-changed";
      readonly path: string;
      readonly status?: "added" | "modified" | "deleted";
      readonly before?: string;
      readonly after?: string;
    }
  | { readonly kind: "sandbox-result"; readonly operation: "file-deleted"; readonly path: string }
  | {
      readonly kind: "sandbox-result";
      readonly operation: "not-in-diff";
      readonly pattern: string;
      readonly flags: string;
      readonly content: "added" | "removed" | "both";
    }
  | { readonly kind: "direct-score"; readonly source: "author" }
  | {
      readonly kind: "third-party";
      readonly name: string;
      readonly schemaId: string;
      readonly data: AssertionSnapshotValue;
    };

export type AssertionScoreContribution =
  | { readonly state: "not-scored" }
  | { readonly state: "earned"; readonly points: number; readonly earned: number }
  | {
      readonly state: "unavailable";
      readonly points: number;
      readonly reason: "source-unavailable" | "evaluation-errored" | "not-applicable";
    };

/** Constant-size semantic receipt for one collection evaluation. */
export interface AssertionCollectionReceipt {
  readonly examined: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
  readonly knownTotal: number | null;
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
}

export type MatcherRelationStatus =
  | { readonly state: "exact" }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "historical-not-recorded"
        | "source-unavailable"
        | "ambiguous";
    };

export type MatcherSourceLocator =
  | {
      readonly kind: "tool-occurrence";
      readonly toolOccurrenceId: string;
      readonly relation: MatcherRelationStatus;
    }
  | {
      readonly kind: "event";
      readonly eventId: string;
      readonly toolOccurrenceId?: string;
      readonly relation: MatcherRelationStatus;
    };

export interface MatcherRetainedRow {
  readonly locator: MatcherSourceLocator;
  readonly result: "matched" | "mismatched" | "unavailable" | "not-evaluated";
  readonly difference?: AssertionSnapshotValue;
}

export interface MatcherQueryStep {
  readonly step: number;
  readonly summary: AssertionSnapshotValue;
}

export type MatcherSourceSnapshot =
  | {
      readonly scope: "turn";
      readonly sessionId: string;
      readonly turnId: string;
      readonly scopeId: string;
      readonly throughSessionSequence: number;
      readonly source: {
        readonly family: "niceeval.agent-turns";
        readonly schemaVersion: number;
      };
      readonly collectionAtCut: "complete" | "partial" | "unavailable";
    }
  | {
      readonly scope: "session";
      readonly sessionId: string;
      readonly scopeId: string;
      readonly throughSessionSequence: number;
      readonly source: {
        readonly family: "niceeval.agent-turns";
        readonly schemaVersion: number;
      };
      readonly collectionAtCut: "complete" | "partial" | "unavailable";
    }
  | {
      readonly scope: "attempt";
      readonly scopeId: string;
      readonly sessions: readonly {
        readonly sessionId: string;
        readonly throughSessionSequence: number;
      }[];
      readonly source: {
        readonly family: "niceeval.agent-turns";
        readonly schemaVersion: number;
      };
      readonly collectionAtCut: "complete" | "partial" | "unavailable";
    };

export interface OrderStepReceipt {
  readonly step: number;
  readonly comparisons: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
}

export interface OrderEvaluationReceipt {
  readonly sourceRows: number;
  readonly comparisons: number;
  readonly unavailableComparisons: number;
  readonly definitePrefixLength: number;
  readonly possiblePrefixLength: number;
  readonly stepReceipts: readonly OrderStepReceipt[];
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
}

export interface MatcherOrderPathNode {
  readonly step: number;
  readonly locator: MatcherSourceLocator;
  readonly sessionId: string;
  readonly sessionSequence: number;
  readonly result: "matched" | "unavailable";
}

export interface MatcherFailureFrontier {
  readonly longestDefinitePrefix: readonly MatcherOrderPathNode[];
  readonly longestPossiblePrefix: readonly MatcherOrderPathNode[];
  readonly firstBlockingStep: number;
  readonly suffixChecked: AssertionCollectionReceipt;
  readonly representatives: readonly MatcherRetainedRow[];
}

export type MatcherQueryArtifact =
  | {
      readonly kind: "collection-filter";
      readonly sourceSnapshot: MatcherSourceSnapshot;
      readonly query: MatcherQueryStep;
      readonly receipt: AssertionCollectionReceipt;
      readonly retainedRows: readonly MatcherRetainedRow[];
    }
  | {
      readonly kind: "ordered-sequence";
      readonly sourceSnapshot: Extract<
        MatcherSourceSnapshot,
        { readonly scope: "turn" | "session" }
      >;
      readonly querySteps: readonly MatcherQueryStep[];
      readonly receipt: OrderEvaluationReceipt;
      readonly result:
        | { readonly state: "matched"; readonly witnessPath: readonly MatcherOrderPathNode[] }
        | { readonly state: "mismatched"; readonly failureFrontier: MatcherFailureFrontier }
        | { readonly state: "unavailable"; readonly reason: string };
      readonly retainedRows: readonly MatcherRetainedRow[];
    };

export type AssertionConditionPolicy =
  | { readonly kind: "boolean"; readonly expected: true }
  | { readonly kind: "at-least"; readonly threshold: number }
  | { readonly kind: "record-only" };

export interface AssertionPolicy {
  readonly requirement: "required" | "optional";
  readonly condition: AssertionConditionPolicy;
}

export type AssertionObserved =
  | { readonly kind: "boolean"; readonly outcome: "matched" | "mismatched" | "unavailable" | "errored" | "not-applicable" }
  | { readonly kind: "measurement"; readonly state: "available"; readonly value: number }
  | { readonly kind: "measurement"; readonly state: "unavailable" }
  | { readonly kind: "direct-score"; readonly state: "available"; readonly value: number }
  | { readonly kind: "direct-score"; readonly state: "unavailable" };

export type AssertionResult =
  | {
      readonly state: "matched";
      readonly gate: "not-gate" | "satisfied";
      readonly score: Extract<AssertionScoreContribution, { readonly state: "not-scored" | "earned" }>;
      readonly diagnostic?: AssertionSnapshotObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "mismatched";
      readonly reason: "condition-not-met";
      readonly gate: "not-gate" | "failed";
      readonly score: Extract<AssertionScoreContribution, { readonly state: "not-scored" | "earned" }>;
      readonly diagnostic?: AssertionSnapshotObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "evidence-unavailable" | "source-unavailable" | "redacted";
      readonly gate: "not-gate" | "unavailable";
      readonly score: Extract<AssertionScoreContribution, { readonly state: "not-scored" | "unavailable" }>;
      readonly diagnostic?: AssertionSnapshotObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "errored";
      readonly reason: "evaluator-failed" | "producer-interrupted" | "invalid-subject";
      readonly gate: "not-gate" | "unavailable";
      readonly score: Extract<AssertionScoreContribution, { readonly state: "not-scored" | "unavailable" }>;
      readonly diagnostic?: AssertionSnapshotObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "coverage-not-applicable";
      readonly gate: "not-gate" | "not-applicable";
      readonly score: Extract<AssertionScoreContribution, { readonly state: "not-scored" | "unavailable" }>;
      readonly diagnostic?: AssertionSnapshotObject;
      readonly receipt?: AssertionCollectionReceipt;
    };

/** One fully formed author/runtime result, before durable attachment encoding. */
export interface SealedAssertionEntry {
  readonly display: AssertionDisplay;
  readonly criterion: AssertionCriterion;
  readonly subject: AssertionMaterial;
  readonly evidence: readonly AssertionMaterial[];
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
  readonly result: AssertionResult;
  readonly policy: AssertionPolicy;
  readonly observed: AssertionObserved;
  readonly matcherArtifact?: MatcherQueryArtifact;
}

/**
 * Assertion handles are runtime-owned capabilities, not subjects for another
 * `t.check`. The symbol is public only for TypeScript's nominal boundary; the
 * runtime also keeps an unforgeable ownership registry.
 */
export const assertionHandleBrand: unique symbol = Symbol(
  "niceeval.assertion-handle",
);

export interface AssertionHandleBase {
  readonly [assertionHandleBrand]: true;
  key(value: string): this;
  label(value: string): this;
  /** Adds one display-only group segment to this already registered entry. */
  group(title: string): this;
}

/** A value that is not an AssertionHandle. */
export type AssertionSubject<Value> = Value extends AssertionHandleBase
  ? never
  : Value;

export interface AssertionStopError {
  readonly _tag: "AssertionStopError";
  readonly entryIndex: number;
  readonly reason:
    | "condition-not-met"
    | "source-unavailable"
    | "evaluator-failed"
    | "not-applicable";
}

/**
 * A public authoring call reached an Attempt boundary which is no longer able
 * to accept it. Keeping this distinct from an evaluator failure lets a
 * detached Promise diagnose its own lifecycle error instead of looking like a
 * failed assertion.
 */
export class AssertionAuthoringClosedError extends Error {
  readonly _tag = "AssertionAuthoringClosedError";

  constructor(
    readonly reason:
      | "stop-latched"
      | "attempt-sealing"
      | "attempt-sealed"
      | "attempt-interrupted"
      | "runtime-unattached",
  ) {
    super(`Cannot use an Assertion authoring handle after ${reason}`);
    this.name = "AssertionAuthoringClosedError";
  }
}

/**
 * The owning Attempt executes a requested stop barrier in its existing Effect
 * scope. Handles only enqueue this request; they never create a runtime.
 */
export type AssertionStopExecutor = <Value>(
  effect: Effect.Effect<Value, AssertionStopError, never>,
) => Promise<Value>;

/** A Boolean entry is evaluated once and may retain a refinement witness. */
export type BooleanAssertionEvaluation<Refined> =
  | {
      readonly state: "matched";
      readonly value: Refined;
      readonly diagnostic?: MatchDiagnostic;
      readonly receipt?: AssertionCollectionReceipt;
      readonly matcherArtifact?: MatcherQueryArtifact;
    }
  | {
      readonly state: "mismatched";
      readonly diagnostic?: MatchDiagnostic;
      readonly receipt?: AssertionCollectionReceipt;
      readonly matcherArtifact?: MatcherQueryArtifact;
    }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "evidence-unavailable"
        | "source-unavailable"
        | "redacted";
      readonly diagnostic?: MatchDiagnostic;
      readonly receipt?: AssertionCollectionReceipt;
      readonly matcherArtifact?: MatcherQueryArtifact;
    }
  | {
      readonly state: "not-applicable";
      readonly diagnostic?: MatchDiagnostic;
      readonly matcherArtifact?: MatcherQueryArtifact;
    };

/** A measurement is always a finite unit-interval value when it is available. */
export type MeasurementAssertionEvaluation =
  | { readonly state: "measured"; readonly value: number; readonly detail?: AssertionSnapshotObject }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "evidence-unavailable"
        | "source-unavailable"
        | "redacted";
      readonly detail?: AssertionSnapshotObject;
    }
  | { readonly state: "not-applicable"; readonly detail?: AssertionSnapshotObject }
  | { readonly state: "errored"; readonly detail?: AssertionSnapshotObject };

export interface CapturedAssertionSnapshot {
  readonly material: Extract<AssertionMaterial, { readonly kind: "snapshot" }>;
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
}

export interface AssertionRegistrationBase {
  readonly criterion: AssertionCriterion;
  readonly subject: AssertionMaterial;
  readonly evidence?: readonly AssertionMaterial[];
  readonly coverage?: AssertionCoverage;
  readonly limitations?: readonly AssertionLimitation[];
}

/**
 * Scope, Judge, and Sandbox adapters use this internal registration shape.
 * They still register exactly one Assertion entry; they do not manufacture a
 * separate intermediate value for a later consumer.
 */
export interface BooleanAssertionRegistration<Refined>
  extends AssertionRegistrationBase {
  /** Sealed when Attempt interruption prevents the ordinary evaluator from running. */
  readonly interruptedMatcherArtifact?: MatcherQueryArtifact;
  readonly evaluate: () => Effect.Effect<
    BooleanAssertionEvaluation<Refined>,
    unknown,
    never
  >;
}

export interface MeasurementAssertionRegistration
  extends AssertionRegistrationBase {
  readonly evaluate: () => Effect.Effect<
    MeasurementAssertionEvaluation,
    unknown,
    never
  >;
}

export interface PassBooleanAssertionHandle<out Refined>
  extends AssertionHandleBase {
  readonly kind: "boolean";
  /** An unavailable/errored optional entry does not independently error Verdict. */
  optional(): this;
  gate(): this;
  orStop(): Promise<Refined>;
}

export interface ScoreBooleanAssertionHandle<out Refined>
  extends AssertionHandleBase {
  readonly kind: "boolean";
  score(points: number): this;
  orStop(): Promise<Refined>;
}

export interface PassMeasurementAssertionHandle<
  Thresholded extends boolean = false,
> extends AssertionHandleBase {
  readonly kind: "measurement";
  /** An unavailable/errored optional entry does not independently error Verdict. */
  optional(): this;
  atLeast(value: number): PassMeasurementAssertionHandle<true>;
  gate(value: number): PassMeasurementAssertionHandle<true>;
  orStop(
    this: PassMeasurementAssertionHandle<true>,
  ): Promise<number>;
}

export interface ScoreMeasurementAssertionHandle<
  Thresholded extends boolean = false,
> extends AssertionHandleBase {
  readonly kind: "measurement";
  atLeast(value: number): ScoreMeasurementAssertionHandle<true>;
  score(points: number): this;
  orStop(
    this: ScoreMeasurementAssertionHandle<true>,
  ): Promise<number>;
}

/** A Boolean Assertion that intentionally has no author control-flow operation. */
interface PostRunPassBooleanAssertionHandle<Refined>
  extends AssertionHandleBase {
  readonly kind: "boolean";
  optional(): this;
  gate(): this;
}

interface PostRunScoreBooleanAssertionHandle<Refined>
  extends AssertionHandleBase {
  readonly kind: "boolean";
  score(points: number): this;
}

export type PostRunBooleanAssertionHandle<
  Kind extends AssertionEvaluationKind,
  Refined,
> = Kind extends "pass"
  ? PostRunPassBooleanAssertionHandle<Refined>
  : PostRunScoreBooleanAssertionHandle<Refined>;

/** Direct score is an Assertion entry, but has no condition or stop barrier. */
export interface DirectScoreAssertionHandle extends AssertionHandleBase {
  readonly kind: "direct-score";
}

export interface AssertionGroupContext {
  /**
   * Runs an ordinary author callback with one display-only group segment. The
   * callback remains inside the Attempt's outer Promise boundary; this facade
   * does not evaluate an Effect or create an independent runtime.
   */
  group<Value>(
    title: string,
    body: () => Value | PromiseLike<Value>,
  ): Promise<Awaited<Value>>;
}

export interface PassAssertionsContext extends AssertionGroupContext {
  readonly evaluationKind: "pass";
  check<Value, Refined extends Value>(
    value: AssertionSubject<Value>,
    match: BooleanMatch<NoInfer<Value>, Refined, "value">,
  ): PassBooleanAssertionHandle<Refined>;
  check<Value extends readonly unknown[]>(
    value: AssertionSubject<Value>,
    match: NumericComparisonMatch,
  ): PassBooleanAssertionHandle<Value>;
  check<S extends "turn" | "session" | "attempt">(
    value: AssertionSubject<ManagedToolCalls<S>>,
    match: ToolMatch,
  ): PassBooleanAssertionHandle<ManagedToolCalls<S>>;
  check<Value>(
    value: AssertionSubject<Value>,
    match: CollectionMatch<NoInfer<Value>>,
  ): PassBooleanAssertionHandle<Value>;
  check<Value>(
    value: AssertionSubject<Value>,
    match: ScoreMatch<NoInfer<Value>>,
  ): PassMeasurementAssertionHandle;
  check<Value>(
    value: AssertionSubject<Value>,
    match: ThresholdedScoreMatch<NoInfer<Value>>,
  ): PassMeasurementAssertionHandle<true>;
}

export interface ScoreAssertionsContext extends AssertionGroupContext {
  readonly evaluationKind: "score";
  check<Value, Refined extends Value>(
    value: AssertionSubject<Value>,
    match: BooleanMatch<NoInfer<Value>, Refined, "value">,
  ): ScoreBooleanAssertionHandle<Refined>;
  check<Value extends readonly unknown[]>(
    value: AssertionSubject<Value>,
    match: NumericComparisonMatch,
  ): ScoreBooleanAssertionHandle<Value>;
  check<S extends "turn" | "session" | "attempt">(
    value: AssertionSubject<ManagedToolCalls<S>>,
    match: ToolMatch,
  ): ScoreBooleanAssertionHandle<ManagedToolCalls<S>>;
  check<Value>(
    value: AssertionSubject<Value>,
    match: CollectionMatch<NoInfer<Value>>,
  ): ScoreBooleanAssertionHandle<Value>;
  check<Value>(
    value: AssertionSubject<Value>,
    match: ScoreMatch<NoInfer<Value>>,
  ): ScoreMeasurementAssertionHandle;
  check<Value>(
    value: AssertionSubject<Value>,
    match: ThresholdedScoreMatch<NoInfer<Value>>,
  ): ScoreMeasurementAssertionHandle<true>;
  score(points: number): DirectScoreAssertionHandle;
}

export type AssertionsContext<Kind extends AssertionEvaluationKind> =
  Kind extends "pass" ? PassAssertionsContext : ScoreAssertionsContext;

export type BooleanAssertionHandle<
  Kind extends AssertionEvaluationKind,
  Refined,
> = Kind extends "pass"
  ? PassBooleanAssertionHandle<Refined>
  : ScoreBooleanAssertionHandle<Refined>;

export type MeasurementAssertionHandle<
  Kind extends AssertionEvaluationKind,
> = Kind extends "pass"
  ? PassMeasurementAssertionHandle
  : ScoreMeasurementAssertionHandle;

export interface AssertionSealOptions {
  readonly execution?: "completed" | "errored";
  readonly explicitlySkipped?: boolean;
  /**
   * The owning Attempt was interrupted before ordinary evaluation could
   * finish. Unsettled entries are sealed as producer-interrupted instead of
   * being silently omitted or evaluated on a detached runtime.
   */
  readonly interrupted?: boolean;
}

export interface AssertionSealError {
  readonly _tag: "AssertionSealError";
  readonly code: "pass-measurement-threshold-missing";
  readonly entryIndex: number;
}

/** The sealed evaluation is a domain result, not a durable Record payload. */
export interface SealedAssertionEvaluationEntry {
  readonly required: boolean;
  readonly result: AssertionResult;
}

export interface SealedAssertionEvaluation {
  readonly execution: "completed" | "errored";
  readonly explicitlySkipped: boolean;
  readonly assertions: readonly SealedAssertionEvaluationEntry[];
}

/**
 * One immutable result feeds the Verdict/Score fold and the private durable
 * producer adapter. No RecordAttachment writer type crosses this boundary.
 */
export interface SealedAssertionsRuntime {
  readonly entries: readonly SealedAssertionEntry[];
  readonly evaluation: SealedAssertionEvaluation;
}

/** The runtime Verdict is independent of the durable Verdict attachment codec. */
export interface AssertionVerdict {
  readonly state: "passed" | "failed" | "errored" | "skipped";
}

export type AssertionScoreIncompleteReason =
  | "execution-errored"
  | "source-unavailable"
  | "evaluation-errored"
  | "not-applicable";

/** The runtime Score is independent of the durable Score attachment codec. */
export type AssertionScore =
  | { readonly state: "complete"; readonly earned: number }
  | {
      readonly state: "partial";
      readonly earned: number;
      readonly reasons: readonly AssertionScoreIncompleteReason[];
    }
  | {
      readonly state: "unavailable";
      readonly reasons: readonly AssertionScoreIncompleteReason[];
    };

/**
 * The attempt-owned frozen result is handed from Runner to the Evaluation
 * Record adapter. The adapter alone adds attachment schemas and writes.
 */
export interface SealedAttemptAssertions {
  readonly entries: readonly SealedAssertionEntry[];
  readonly evaluation: SealedAssertionEvaluation;
  readonly workspaceDiff?: AgentWorkspaceDiff;
  readonly verdict: AssertionVerdict;
  readonly score?: AssertionScore;
}

export interface AssertionsRuntime<
  Kind extends AssertionEvaluationKind,
> {
  readonly evaluationKind: Kind;
  readonly t: AssertionsContext<Kind>;
  registerBoolean<Refined>(
    definition: BooleanAssertionRegistration<Refined>,
  ): BooleanAssertionHandle<Kind, Refined>;
  registerMeasurement(
    definition: MeasurementAssertionRegistration,
  ): MeasurementAssertionHandle<Kind>;
  seal(
    options?: AssertionSealOptions,
  ): Effect.Effect<SealedAssertionsRuntime, AssertionSealError, never>;
}
