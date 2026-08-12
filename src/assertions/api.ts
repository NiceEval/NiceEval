import type { Effect } from "effect";

import type {
  BooleanMatch,
  ScoreMatch,
} from "./match.ts";
import type {
  AssertionsAttachmentEntryInputV1,
} from "./record/attachment.ts";
import type {
  AssertionCoverageV1,
  AssertionLimitationV1,
  AssertionMaterialV1,
  WritableCriterionEnvelopeV1,
} from "./record/model.ts";

/** The two Evaluation kinds deliberately share one Assertion entry model. */
export type AssertionEvaluationKindV1 = "pass" | "score";

/**
 * Assertion handles are runtime-owned capabilities, not subjects for another
 * `t.check`. The symbol is public only for TypeScript's nominal boundary; the
 * runtime also keeps an unforgeable ownership registry.
 */
export const assertionHandleBrand: unique symbol = Symbol(
  "niceeval.assertion-handle",
);

export interface AssertionHandleBaseV1 {
  readonly [assertionHandleBrand]: true;
  key(value: string): this;
  label(value: string): this;
  /** Adds one display-only group segment to this already registered entry. */
  group(title: string): this;
}

/** A value that is not an AssertionHandle. */
export type AssertionSubjectV1<Value> = Value extends AssertionHandleBaseV1
  ? never
  : Value;

export interface AssertionStopErrorV1 {
  readonly _tag: "AssertionStopErrorV1";
  readonly entryIndex: number;
  readonly reason:
    | "condition-not-met"
    | "source-unavailable"
    | "evaluator-failed"
    | "not-applicable";
}

/**
 * A public authoring call reached an Attempt boundary which is no longer able
 * to accept it.  Keeping this distinct from an evaluator failure lets a
 * detached Promise diagnose its own lifecycle error instead of looking like a
 * failed assertion.
 */
export class AssertionAuthoringClosedErrorV1 extends Error {
  readonly _tag = "AssertionAuthoringClosedErrorV1";

  constructor(
    readonly reason:
      | "stop-latched"
      | "attempt-sealing"
      | "attempt-sealed"
      | "attempt-interrupted"
      | "runtime-unattached",
  ) {
    super(`Cannot use an Assertion authoring handle after ${reason}`);
    this.name = "AssertionAuthoringClosedErrorV1";
  }
}

/**
 * The owning Attempt executes a requested stop barrier in its existing Effect
 * scope. Handles only enqueue this request; they never create a runtime.
 */
export type AssertionStopExecutorV1 = <Value>(
  effect: Effect.Effect<Value, AssertionStopErrorV1, never>,
) => Promise<Value>;

/** A Boolean entry is evaluated once and may retain a refinement witness. */
export type BooleanAssertionEvaluationV1<Refined> =
  | { readonly state: "matched"; readonly value: Refined }
  | { readonly state: "mismatched" }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "evidence-unavailable"
        | "source-unavailable"
        | "redacted";
    }
  | { readonly state: "not-applicable" };

/** A measurement is always a finite unit-interval value when it is available. */
export type MeasurementAssertionEvaluationV1 =
  | { readonly state: "measured"; readonly value: number }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "evidence-unavailable"
        | "source-unavailable"
        | "redacted";
    }
  | { readonly state: "not-applicable" }
  | { readonly state: "errored" };

/** Snapshot-only material keeps this authoring runtime independent of Record blob authority. */
export type AssertionSnapshotMaterialV1 = Extract<
  AssertionMaterialV1<never>,
  { readonly kind: "snapshot" }
>;

/** A same-owner, exact post-run Attachment reference with no storage handle. */
export type AssertionRecordAttachmentMaterialV1 = Extract<
  AssertionMaterialV1<never>,
  { readonly kind: "record-attachment" }
>;

/** Runtime registrations never gain raw Record blob authority. */
export type AssertionRuntimeMaterialV1 =
  | AssertionSnapshotMaterialV1
  | AssertionRecordAttachmentMaterialV1;

export interface AssertionRegistrationBaseV1 {
  readonly criterion: WritableCriterionEnvelopeV1;
  readonly subject: AssertionRuntimeMaterialV1;
  readonly evidence?: readonly AssertionRuntimeMaterialV1[];
  readonly coverage?: AssertionCoverageV1;
  readonly limitations?: readonly AssertionLimitationV1[];
}

/**
 * Scope, Judge, and Sandbox adapters use this internal registration shape.
 * They still register exactly one Assertion entry; they do not manufacture a
 * separate intermediate value for a later consumer.
 */
export interface BooleanAssertionRegistrationV1<Refined>
  extends AssertionRegistrationBaseV1 {
  readonly evaluate: () => Effect.Effect<
    BooleanAssertionEvaluationV1<Refined>,
    unknown,
    never
  >;
}

export interface MeasurementAssertionRegistrationV1
  extends AssertionRegistrationBaseV1 {
  readonly evaluate: () => Effect.Effect<
    MeasurementAssertionEvaluationV1,
    unknown,
    never
  >;
}

export interface PassBooleanAssertionHandleV1<out Refined>
  extends AssertionHandleBaseV1 {
  readonly kind: "boolean";
  /** An unavailable/errored optional entry does not independently error Verdict. */
  optional(): this;
  gate(): this;
  orStop(): Promise<Refined>;
}

export interface ScoreBooleanAssertionHandleV1<out Refined>
  extends AssertionHandleBaseV1 {
  readonly kind: "boolean";
  /** An unavailable/errored optional entry does not independently error Verdict. */
  optional(): this;
  gate(): this;
  score(points: number): this;
  orStop(): Promise<Refined>;
}

export interface PassMeasurementAssertionHandleV1<
  Thresholded extends boolean = false,
> extends AssertionHandleBaseV1 {
  readonly kind: "measurement";
  /** An unavailable/errored optional entry does not independently error Verdict. */
  optional(): this;
  atLeast(value: number): PassMeasurementAssertionHandleV1<true>;
  gate(this: PassMeasurementAssertionHandleV1<true>): this;
  orStop(
    this: PassMeasurementAssertionHandleV1<true>,
  ): Promise<number>;
}

export interface ScoreMeasurementAssertionHandleV1<
  Thresholded extends boolean = false,
> extends AssertionHandleBaseV1 {
  readonly kind: "measurement";
  /** An unavailable/errored optional entry does not independently error Verdict. */
  optional(): this;
  atLeast(value: number): ScoreMeasurementAssertionHandleV1<true>;
  gate(this: ScoreMeasurementAssertionHandleV1<true>): this;
  score(points: number): this;
  orStop(
    this: ScoreMeasurementAssertionHandleV1<true>,
  ): Promise<number>;
}

/**
 * A Boolean Assertion whose evaluator runs after authoring has settled. This
 * is the only handle returned by the agent-attributed workspace-diff surface:
 * it configures one registered entry and intentionally has no control-flow
 * operation. It is deliberately a separate narrow interface instead of an
 * alias of ordinary Boolean handles: the runtime object may implement a
 * stop barrier, but a post-run diff assertion cannot expose one.
 */
interface PostRunPassBooleanAssertionHandleV1<Refined>
  extends AssertionHandleBaseV1 {
  readonly kind: "boolean";
  optional(): this;
  gate(): this;
}

interface PostRunScoreBooleanAssertionHandleV1<Refined>
  extends AssertionHandleBaseV1 {
  readonly kind: "boolean";
  optional(): this;
  gate(): this;
  score(points: number): this;
}

export type PostRunBooleanAssertionHandleV1<
  Kind extends AssertionEvaluationKindV1,
  Refined,
> = Kind extends "pass"
  ? PostRunPassBooleanAssertionHandleV1<Refined>
  : PostRunScoreBooleanAssertionHandleV1<Refined>;

/** Public name for post-run-only Boolean Assertions such as workspace diff. */
export type PostRunBooleanAssertionHandle<
  Kind extends AssertionEvaluationKindV1,
  Refined,
> = PostRunBooleanAssertionHandleV1<Kind, Refined>;

/** Direct score is an Assertion entry, but has no condition or stop barrier. */
export interface DirectScoreAssertionHandleV1 extends AssertionHandleBaseV1 {
  readonly kind: "direct-score";
}

export interface AssertionGroupContextV1 {
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

export interface PassAssertionsContextV1 extends AssertionGroupContextV1 {
  readonly evaluationKind: "pass";
  check<Value, Refined extends Value>(
    value: AssertionSubjectV1<Value>,
    match: BooleanMatch<NoInfer<Value>, Refined, "value">,
  ): PassBooleanAssertionHandleV1<Refined>;
  check<Value>(
    value: AssertionSubjectV1<Value>,
    match: ScoreMatch<NoInfer<Value>>,
  ): PassMeasurementAssertionHandleV1;
}

export interface ScoreAssertionsContextV1 extends AssertionGroupContextV1 {
  readonly evaluationKind: "score";
  check<Value, Refined extends Value>(
    value: AssertionSubjectV1<Value>,
    match: BooleanMatch<NoInfer<Value>, Refined, "value">,
  ): ScoreBooleanAssertionHandleV1<Refined>;
  check<Value>(
    value: AssertionSubjectV1<Value>,
    match: ScoreMatch<NoInfer<Value>>,
  ): ScoreMeasurementAssertionHandleV1;
  score(points: number): DirectScoreAssertionHandleV1;
}

export type AssertionsContextV1<Kind extends AssertionEvaluationKindV1> =
  Kind extends "pass" ? PassAssertionsContextV1 : ScoreAssertionsContextV1;

export type BooleanAssertionHandleV1<
  Kind extends AssertionEvaluationKindV1,
  Refined,
> = Kind extends "pass"
  ? PassBooleanAssertionHandleV1<Refined>
  : ScoreBooleanAssertionHandleV1<Refined>;

export type MeasurementAssertionHandleV1<
  Kind extends AssertionEvaluationKindV1,
> = Kind extends "pass"
  ? PassMeasurementAssertionHandleV1
  : ScoreMeasurementAssertionHandleV1;

export interface AssertionSealOptionsV1 {
  readonly execution?: "completed" | "errored";
  readonly explicitlySkipped?: boolean;
  /**
   * The owning Attempt was interrupted before ordinary evaluation could
   * finish. Unsettled entries are sealed as producer-interrupted instead of
   * being silently omitted or evaluated on a detached runtime.
   */
  readonly interrupted?: boolean;
}

export interface AssertionSealErrorV1 {
  readonly _tag: "AssertionSealErrorV1";
  readonly code: "pass-measurement-threshold-missing";
  readonly entryIndex: number;
}

/**
 * The sealed evaluation data owned by Assertions. It is deliberately named
 * for its role, rather than for the historical Record fold input it can be
 * adapted into at the single Record boundary.
 */
export interface SealedAssertionEvaluationEntryV1 {
  readonly required: boolean;
  readonly result: AssertionsAttachmentEntryInputV1<never, never>["result"];
}

export interface SealedAssertionEvaluationV1 {
  readonly execution: "completed" | "errored";
  readonly explicitlySkipped: boolean;
  readonly assertions: readonly SealedAssertionEvaluationEntryV1[];
}

/**
 * One immutable result feeds both independent consumers. `entries` preserve
 * declaration order and may be appended directly to the Assertions producer.
 * `evaluation` is the sealed, attempt-local input shared by the Verdict and
 * Score folds; it does not expose a Fact authoring or Runner model.
 */
export interface SealedAssertionsRuntimeV1 {
  readonly entries: readonly AssertionsAttachmentEntryInputV1<never, never>[];
  readonly evaluation: SealedAssertionEvaluationV1;
}

export interface AssertionsRuntimeV1<
  Kind extends AssertionEvaluationKindV1,
> {
  readonly evaluationKind: Kind;
  readonly t: AssertionsContextV1<Kind>;
  registerBoolean<Refined>(
    definition: BooleanAssertionRegistrationV1<Refined>,
  ): BooleanAssertionHandleV1<Kind, Refined>;
  registerMeasurement(
    definition: MeasurementAssertionRegistrationV1,
  ): MeasurementAssertionHandleV1<Kind>;
  seal(
    options?: AssertionSealOptionsV1,
  ): Effect.Effect<SealedAssertionsRuntimeV1, AssertionSealErrorV1, never>;
}
