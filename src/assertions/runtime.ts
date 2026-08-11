import { Cause, Deferred, Effect } from "effect";

import {
  assertionHandleBrand,
  type AssertionEvaluationKindV1,
  type AssertionSealErrorV1,
  type AssertionSealOptionsV1,
  type AssertionSnapshotMaterialV1,
  type AssertionStopErrorV1,
  type AssertionsContextV1,
  type AssertionsRuntimeV1,
  type BooleanAssertionEvaluationV1,
  type BooleanAssertionRegistrationV1,
  type MeasurementAssertionEvaluationV1,
  type MeasurementAssertionRegistrationV1,
  type SealedAssertionsRuntimeV1,
} from "./api.ts";
import {
  assertManagedValueMatch,
  evaluateBooleanMatch,
  evaluateScoreMatch,
  type BooleanMatch,
  type ScoreMatch,
} from "./match.ts";
import type {
  AssertionsAttachmentEntryInputV1,
} from "./record/attachment.ts";
import {
  MAX_ASSERTION_DISPLAY_CODE_POINTS_V1,
  MAX_ASSERTION_ENTRIES_V1,
  MAX_ASSERTION_GROUP_DEPTH_V1,
  MAX_ASSERTION_JSON_ARRAY_ITEMS_V1,
  MAX_ASSERTION_JSON_DEPTH_V1,
  MAX_ASSERTION_JSON_OBJECT_KEYS_V1,
  MAX_ASSERTION_STRING_BYTES_V1,
} from "./record/codec.ts";
import type {
  AssertionCoverageV1 as RecordAssertionCoverageV1,
  AssertionDisplayV1,
  AssertionLimitationV1,
  BoundedJsonObjectV1,
  BoundedJsonValueV1,
  EarnedScoreContributionV1,
  NoScoreContributionV1,
  SealedAssertionResultV1,
  UnavailableScoreContributionV1,
  WritableCriterionEnvelopeV1,
} from "./record/model.ts";
import type { EvaluationAttemptFactsV1 } from "../eval/record/sealed-assertion.ts";

const UTF8 = new TextEncoder();

const assertionHandleRegistry = new WeakSet<object>();

type EntryKind = "boolean" | "measurement" | "direct-score";

type AvailableResult =
  | { readonly state: "matched"; readonly value: unknown }
  | { readonly state: "mismatched" }
  | { readonly state: "measured"; readonly value: number };

type EntrySettlement =
  | AvailableResult
  | {
      readonly state: "unavailable";
      readonly reason:
        | "evidence-unavailable"
        | "source-unavailable"
        | "redacted";
    }
  | { readonly state: "not-applicable" }
  | { readonly state: "errored" };

interface AssertionEntry {
  readonly index: number;
  readonly kind: EntryKind;
  readonly criterion: WritableCriterionEnvelopeV1;
  readonly subject: AssertionSnapshotMaterialV1;
  readonly evidence: readonly AssertionSnapshotMaterialV1[];
  readonly initialCoverage: RecordAssertionCoverageV1;
  readonly initialLimitations: readonly AssertionLimitationV1[];
  readonly evaluate: () => Effect.Effect<EntrySettlement, unknown, never>;
  readonly display: {
    key: string | undefined;
    label: string | undefined;
    groupPath: string[];
  };
  readonly directScorePoints: number | undefined;
  optionalConfigured: boolean;
  gateConfigured: boolean;
  threshold: number | undefined;
  scorePoints: number | undefined;
  settled: EntrySettlement | undefined;
  pending: Deferred.Deferred<EntrySettlement> | undefined;
}

interface CapturedSnapshot {
  readonly material: AssertionSnapshotMaterialV1;
  readonly coverage: RecordAssertionCoverageV1;
  readonly limitations: readonly AssertionLimitationV1[];
}

interface SnapshotState {
  truncated: boolean;
  omittedBytes: number;
  readonly seen: WeakSet<object>;
}

type AvailableScoreContribution =
  | NoScoreContributionV1
  | EarnedScoreContributionV1;

type IncompleteScoreContribution =
  | NoScoreContributionV1
  | UnavailableScoreContributionV1;

function isRecord(value: unknown): value is globalThis.Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFiniteNonNegative(value: unknown, owner: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${owner} must be a finite non-negative number`);
  }
}

function assertUnitInterval(value: unknown, owner: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${owner} must be a finite number in [0, 1]`);
  }
}

function assertDisplayText(value: unknown, owner: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${owner} must be a non-empty string`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new TypeError(`${owner} must not contain control characters`);
  }
  if (Array.from(value).length > MAX_ASSERTION_DISPLAY_CODE_POINTS_V1) {
    throw new TypeError(
      `${owner} must be at most ${MAX_ASSERTION_DISPLAY_CODE_POINTS_V1} code points`,
    );
  }
}

function marker(value: string): BoundedJsonObjectV1 {
  return Object.freeze({ $niceeval: value });
}

function omittedBytes(value: string): number {
  return UTF8.encode(value).byteLength;
}

function markTruncated(state: SnapshotState, bytes = 1): void {
  state.truncated = true;
  state.omittedBytes += Math.max(1, bytes);
}

function boundedSnapshotString(value: string, state: SnapshotState): string {
  const bytes = omittedBytes(value);
  if (bytes <= MAX_ASSERTION_STRING_BYTES_V1) return value;

  let retainedBytes = 0;
  let retainedEnd = 0;
  for (const point of value) {
    const pointBytes = omittedBytes(point);
    if (retainedBytes + pointBytes > MAX_ASSERTION_STRING_BYTES_V1) break;
    retainedBytes += pointBytes;
    retainedEnd += point.length;
  }
  markTruncated(state, bytes - retainedBytes);
  return value.slice(0, retainedEnd);
}

function boundedSnapshotKey(
  key: string,
  index: number,
  existing: ReadonlySet<string>,
  state: SnapshotState,
): string {
  if (omittedBytes(key) <= MAX_ASSERTION_STRING_BYTES_V1) return key;

  markTruncated(state, omittedBytes(key));
  let replacement = `$niceeval:truncated-key:${index}`;
  let suffix = 0;
  while (existing.has(replacement)) {
    suffix += 1;
    replacement = `$niceeval:truncated-key:${index}:${suffix}`;
  }
  return replacement;
}

/**
 * Produces a bounded, safe-to-persist view without changing the actual value
 * consumed by a Match. Non-JSON runtime objects remain visible only as a
 * tagged placeholder and make the entry's material explicitly partial.
 */
function boundedSnapshotValue(
  value: unknown,
  depth: number,
  state: SnapshotState,
): BoundedJsonValueV1 {
  if (value === null || typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    markTruncated(state, String(value).length);
    return marker("non-finite-number");
  }

  if (typeof value === "string") {
    return boundedSnapshotString(value, state);
  }

  if (typeof value === "undefined") {
    markTruncated(state);
    return marker("undefined");
  }

  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    markTruncated(state, String(value).length);
    return marker(typeof value);
  }

  if (depth >= MAX_ASSERTION_JSON_DEPTH_V1) {
    markTruncated(state);
    return marker("depth-truncated");
  }

  if (state.seen.has(value)) {
    markTruncated(state);
    return marker("cyclic-or-shared-reference");
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const length = Math.min(value.length, MAX_ASSERTION_JSON_ARRAY_ITEMS_V1);
    if (length < value.length) markTruncated(state, value.length - length);
    const entries: BoundedJsonValueV1[] = [];
    for (let index = 0; index < length; index += 1) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined) {
          markTruncated(state);
          entries.push(marker("array-hole"));
        } else if (!("value" in descriptor)) {
          markTruncated(state);
          entries.push(marker("accessor-element"));
        } else {
          entries.push(boundedSnapshotValue(descriptor.value, depth + 1, state));
        }
      } catch {
        markTruncated(state);
        entries.push(marker("unreadable-element"));
      }
    }
    return Object.freeze(entries);
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) {
      markTruncated(state);
      return marker("invalid-date");
    }
    markTruncated(state);
    return Object.freeze({ $niceeval: "date", value: value.toISOString() });
  }

  let keys: readonly string[];
  try {
    keys = Object.keys(value);
  } catch {
    markTruncated(state);
    return marker("uninspectable-object");
  }
  const length = Math.min(keys.length, MAX_ASSERTION_JSON_OBJECT_KEYS_V1);
  if (length < keys.length) markTruncated(state, keys.length - length);
  const entries: Array<readonly [string, BoundedJsonValueV1]> = [];
  const reservedKeys = new Set(keys);
  for (let index = 0; index < length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const capturedKey = boundedSnapshotKey(key, index, reservedKeys, state);
    reservedKeys.add(capturedKey);
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        markTruncated(state);
        entries.push([capturedKey, marker("accessor-property")]);
      } else {
        entries.push([
          capturedKey,
          boundedSnapshotValue(descriptor.value, depth + 1, state),
        ]);
      }
    } catch {
      markTruncated(state);
      entries.push([capturedKey, marker("unreadable-property")]);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

function captureSnapshot(value: unknown): CapturedSnapshot {
  const state: SnapshotState = {
    truncated: false,
    omittedBytes: 0,
    seen: new WeakSet<object>(),
  };
  const snapshot = boundedSnapshotValue(value, 0, state);
  const material: AssertionSnapshotMaterialV1 = Object.freeze({
    kind: "snapshot",
    value: snapshot,
  });
  if (!state.truncated) {
    return Object.freeze({
      material,
      coverage: Object.freeze({ state: "complete" as const }),
      limitations: Object.freeze([]),
    });
  }
  return Object.freeze({
    material,
    coverage: Object.freeze({ state: "partial" as const, reason: "truncated" as const }),
    limitations: Object.freeze([
      Object.freeze({
        kind: "truncated" as const,
        omittedBytes: Math.max(1, state.omittedBytes),
      }),
    ]),
  });
}

function freezeSnapshotMaterial(
  material: AssertionSnapshotMaterialV1,
): AssertionSnapshotMaterialV1 {
  return Object.freeze({ kind: "snapshot", value: material.value });
}

function cloneCoverage(coverage: RecordAssertionCoverageV1): RecordAssertionCoverageV1 {
  return Object.freeze({ ...coverage });
}

function cloneLimitations(
  limitations: readonly AssertionLimitationV1[],
): readonly AssertionLimitationV1[] {
  return Object.freeze(limitations.map((limitation) => Object.freeze({ ...limitation })));
}

function noScore(): NoScoreContributionV1 {
  return Object.freeze({ state: "not-scored" as const });
}

function earnedScore(points: number, earned: number): EarnedScoreContributionV1 {
  return Object.freeze({ state: "earned" as const, points, earned });
}

function unavailableScore(
  points: number,
  reason: UnavailableScoreContributionV1["reason"],
): UnavailableScoreContributionV1 {
  return Object.freeze({ state: "unavailable" as const, points, reason });
}

class HandleBase {
  readonly [assertionHandleBrand] = true as const;

  constructor(
    protected readonly runtime: AssertionsRuntimeImplementation,
    protected readonly entry: AssertionEntry,
  ) {
    assertionHandleRegistry.add(this);
  }

  key(value: string): this {
    this.runtime.configureKey(this.entry, value);
    return this;
  }

  label(value: string): this {
    this.runtime.configureLabel(this.entry, value);
    return this;
  }

  group(title: string): this {
    this.runtime.configureGroup(this.entry, title);
    return this;
  }
}

class BooleanHandle extends HandleBase {
  readonly kind = "boolean" as const;

  optional(): this {
    this.runtime.configureOptional(this.entry);
    return this;
  }

  gate(): this {
    this.runtime.configureGate(this.entry);
    return this;
  }

  score(points: number): this {
    this.runtime.configureScore(this.entry, points);
    return this;
  }

  orStop(): Effect.Effect<unknown, AssertionStopErrorV1> {
    return this.runtime.stopBoolean(this.entry);
  }
}

class MeasurementHandle extends HandleBase {
  readonly kind = "measurement" as const;

  optional(): this {
    this.runtime.configureOptional(this.entry);
    return this;
  }

  atLeast(value: number): this {
    this.runtime.configureThreshold(this.entry, value);
    return this;
  }

  gate(): this {
    this.runtime.configureGate(this.entry);
    return this;
  }

  score(points: number): this {
    this.runtime.configureScore(this.entry, points);
    return this;
  }

  orStop(): Effect.Effect<number, AssertionStopErrorV1> {
    return this.runtime.stopMeasurement(this.entry);
  }
}

class DirectScoreHandle extends HandleBase {
  readonly kind = "direct-score" as const;
}

class AssertionsRuntimeImplementation {
  readonly t: AssertionsContextV1<AssertionEvaluationKindV1>;
  private readonly entries: AssertionEntry[] = [];
  private readonly groupStack: string[] = [];
  private stopped: AssertionStopErrorV1 | undefined;
  private closing = false;
  private sealed: SealedAssertionsRuntimeV1 | undefined;

  constructor(readonly evaluationKind: AssertionEvaluationKindV1) {
    const base = {
      evaluationKind,
      check: this.check.bind(this),
      group: this.withGroup.bind(this),
    };
    this.t = Object.freeze(
      evaluationKind === "score"
        ? { ...base, score: this.directScore.bind(this) }
        : base,
    ) as AssertionsContextV1<AssertionEvaluationKindV1>;
  }

  check<Value, Refined extends Value>(
    value: Value,
    match: BooleanMatch<NoInfer<Value>, Refined, "value">,
  ): BooleanHandle;
  check<Value>(value: Value, match: ScoreMatch<NoInfer<Value>>): MeasurementHandle;
  check(value: unknown, match: unknown, ...extra: readonly unknown[]): BooleanHandle | MeasurementHandle {
    if (extra.length > 0) {
      throw new TypeError("t.check() accepts exactly (value, match)");
    }
    this.assertCanRegister();
    if (typeof value === "object" && value !== null && assertionHandleRegistry.has(value)) {
      throw new TypeError("t.check() cannot use an AssertionHandle as a subject");
    }
    const managed = assertManagedValueMatch(match, "t.check() match");
    const captured = captureSnapshot(value);
    if (managed.kind === "boolean") {
      const entry = this.createEntry({
        kind: "boolean",
        criterion: Object.freeze({
          kind: "builtin" as const,
          id: "value-match/v1" as const,
          data: Object.freeze({ subject: "explicit-value" as const }),
        }),
        subject: captured.material,
        evidence: Object.freeze([]),
        coverage: captured.coverage,
        limitations: captured.limitations,
        evaluate: () => this.evaluateBooleanMatch(managed, value),
      });
      return new BooleanHandle(this, entry);
    }
    const entry = this.createEntry({
      kind: "measurement",
      criterion: Object.freeze({
        kind: "builtin" as const,
        id: "value-match/v1" as const,
        data: Object.freeze({ subject: "explicit-value" as const }),
      }),
      subject: captured.material,
      evidence: Object.freeze([]),
      coverage: captured.coverage,
      limitations: captured.limitations,
      evaluate: () => this.evaluateScoreMatch(managed, value),
    });
    return new MeasurementHandle(this, entry);
  }

  registerBoolean<Refined>(
    definition: BooleanAssertionRegistrationV1<Refined>,
  ): BooleanHandle {
    this.assertCanRegister();
    this.assertRegistration(definition, "registerBoolean()");
    const entry = this.createEntry({
      kind: "boolean",
      criterion: definition.criterion,
      subject: freezeSnapshotMaterial(definition.subject),
      evidence: Object.freeze((definition.evidence ?? []).map(freezeSnapshotMaterial)),
      coverage: cloneCoverage(definition.coverage ?? { state: "complete" }),
      limitations: cloneLimitations(definition.limitations ?? []),
      evaluate: () =>
        Effect.suspend(definition.evaluate).pipe(
          Effect.map((evaluation): EntrySettlement => this.booleanSettlement(evaluation)),
        ),
    });
    return new BooleanHandle(this, entry);
  }

  registerMeasurement(
    definition: MeasurementAssertionRegistrationV1,
  ): MeasurementHandle {
    this.assertCanRegister();
    this.assertRegistration(definition, "registerMeasurement()");
    const entry = this.createEntry({
      kind: "measurement",
      criterion: definition.criterion,
      subject: freezeSnapshotMaterial(definition.subject),
      evidence: Object.freeze((definition.evidence ?? []).map(freezeSnapshotMaterial)),
      coverage: cloneCoverage(definition.coverage ?? { state: "complete" }),
      limitations: cloneLimitations(definition.limitations ?? []),
      evaluate: () =>
        Effect.suspend(definition.evaluate).pipe(
          Effect.map((evaluation): EntrySettlement => this.measurementSettlement(evaluation)),
        ),
    });
    return new MeasurementHandle(this, entry);
  }

  directScore(points: number): DirectScoreHandle {
    this.assertCanRegister();
    if (this.evaluationKind !== "score") {
      throw new TypeError("t.score() is available only in a Score Eval");
    }
    assertFiniteNonNegative(points, "t.score() points");
    const captured = captureSnapshot(points);
    const entry = this.createEntry({
      kind: "direct-score",
      criterion: Object.freeze({
        kind: "builtin" as const,
        id: "direct-score/v1" as const,
        data: Object.freeze({ source: "author" as const }),
      }),
      subject: captured.material,
      evidence: Object.freeze([]),
      coverage: captured.coverage,
      limitations: captured.limitations,
      directScorePoints: points,
      evaluate: () => Effect.succeed({ state: "matched", value: points }),
    });
    return new DirectScoreHandle(this, entry);
  }

  withGroup<Value, Error>(
    title: string,
    body: () => Effect.Effect<Value, Error, never>,
  ): Effect.Effect<Value, Error, never> {
    return Effect.suspend(() => {
      this.assertCanRegister();
      assertDisplayText(title, "t.group() title");
      if (this.groupStack.length >= MAX_ASSERTION_GROUP_DEPTH_V1) {
        throw new Error(
          `Assertion group depth cannot exceed ${MAX_ASSERTION_GROUP_DEPTH_V1}`,
        );
      }
      return Effect.sync(() => {
        this.groupStack.push(title);
      }).pipe(
        Effect.zipRight(Effect.suspend(body)),
        Effect.ensuring(Effect.sync(() => {
          const popped = this.groupStack.pop();
          if (popped !== title) {
            throw new Error("Assertion group stack lost nesting order");
          }
        })),
      );
    });
  }

  configureKey(entry: AssertionEntry, value: string): void {
    this.assertMutable(entry, "key()");
    assertDisplayText(value, "key() value");
    if (entry.display.key !== undefined) throw new Error("An Assertion key is already configured");
    entry.display.key = value;
  }

  configureLabel(entry: AssertionEntry, value: string): void {
    this.assertMutable(entry, "label()");
    assertDisplayText(value, "label() value");
    if (entry.display.label !== undefined) throw new Error("An Assertion label is already configured");
    entry.display.label = value;
  }

  configureGroup(entry: AssertionEntry, title: string): void {
    this.assertMutable(entry, "group()");
    assertDisplayText(title, "group() title");
    if (entry.display.groupPath.length !== this.groupStack.length) {
      throw new Error("An Assertion group is already configured");
    }
    if (entry.display.groupPath.length >= MAX_ASSERTION_GROUP_DEPTH_V1) {
      throw new Error(
        `Assertion group depth cannot exceed ${MAX_ASSERTION_GROUP_DEPTH_V1}`,
      );
    }
    entry.display.groupPath.push(title);
  }

  configureOptional(entry: AssertionEntry): void {
    this.assertMutable(entry, "optional()");
    if (entry.optionalConfigured) throw new Error("An Assertion optional policy is already configured");
    entry.optionalConfigured = true;
  }

  configureGate(entry: AssertionEntry): void {
    this.assertMutable(entry, "gate()");
    if (entry.kind === "direct-score") throw new TypeError("A direct-score Assertion cannot be a gate");
    if (entry.kind === "measurement" && entry.threshold === undefined) {
      throw new TypeError("A measurement Assertion requires atLeast() before gate()");
    }
    if (entry.gateConfigured) throw new Error("An Assertion gate policy is already configured");
    entry.gateConfigured = true;
  }

  configureThreshold(entry: AssertionEntry, value: number): void {
    this.assertMutable(entry, "atLeast()");
    if (entry.kind !== "measurement") throw new TypeError("atLeast() is available only on a measurement Assertion");
    assertUnitInterval(value, "atLeast() threshold");
    if (entry.threshold !== undefined) throw new Error("An Assertion threshold is already configured");
    entry.threshold = value;
  }

  configureScore(entry: AssertionEntry, points: number): void {
    this.assertMutable(entry, "score()");
    if (this.evaluationKind !== "score") {
      throw new TypeError("handle.score() is available only in a Score Eval");
    }
    if (entry.kind === "direct-score") throw new TypeError("A direct-score Assertion already has its score contribution");
    assertFiniteNonNegative(points, "score() points");
    if (entry.scorePoints !== undefined) throw new Error("An Assertion score contribution is already configured");
    entry.scorePoints = points;
  }

  stopBoolean(entry: AssertionEntry): Effect.Effect<unknown, AssertionStopErrorV1> {
    return this.settle(entry).pipe(
      Effect.flatMap((settlement) => {
        if (settlement.state === "matched") return Effect.succeed(settlement.value);
        return Effect.fail(this.latchStop(entry, settlement));
      }),
    );
  }

  stopMeasurement(entry: AssertionEntry): Effect.Effect<number, AssertionStopErrorV1> {
    return this.settle(entry).pipe(
      Effect.flatMap((settlement) => {
        if (
          settlement.state === "measured"
          && entry.threshold !== undefined
          && settlement.value >= entry.threshold
        ) {
          return Effect.succeed(settlement.value);
        }
        return Effect.fail(this.latchStop(entry, settlement));
      }),
    );
  }

  seal(
    options: AssertionSealOptionsV1 = {},
  ): Effect.Effect<SealedAssertionsRuntimeV1, AssertionSealErrorV1, never> {
    return Effect.suspend(() => {
      if (this.sealed !== undefined) return Effect.succeed(this.sealed);
      const missingThreshold = this.entries.find(
        (entry) => this.evaluationKind === "pass" && entry.kind === "measurement" && entry.threshold === undefined,
      );
      if (missingThreshold !== undefined) {
        return Effect.fail(Object.freeze({
          _tag: "AssertionSealErrorV1" as const,
          code: "pass-measurement-threshold-missing" as const,
          entryIndex: missingThreshold.index,
        }));
      }
      if (this.closing) throw new Error("Assertions are already sealing");
      this.closing = true;
      return Effect.forEach(this.entries, (entry) => this.settle(entry)).pipe(
        Effect.zipRight(Effect.sync(() => this.finishSeal(options))),
        Effect.onInterrupt(() => Effect.sync(() => {
          this.closing = false;
        })),
      );
    });
  }

  private createEntry(input: {
    readonly kind: EntryKind;
    readonly criterion: WritableCriterionEnvelopeV1;
    readonly subject: AssertionSnapshotMaterialV1;
    readonly evidence: readonly AssertionSnapshotMaterialV1[];
    readonly coverage: RecordAssertionCoverageV1;
    readonly limitations: readonly AssertionLimitationV1[];
    readonly evaluate: () => Effect.Effect<EntrySettlement, unknown, never>;
    readonly directScorePoints?: number;
  }): AssertionEntry {
    if (this.entries.length >= MAX_ASSERTION_ENTRIES_V1) {
      throw new Error(
        `An Assertions Attachment cannot contain more than ${MAX_ASSERTION_ENTRIES_V1} entries`,
      );
    }
    const entry: AssertionEntry = {
      index: this.entries.length,
      kind: input.kind,
      criterion: input.criterion,
      subject: input.subject,
      evidence: input.evidence,
      initialCoverage: input.coverage,
      initialLimitations: input.limitations,
      evaluate: input.evaluate,
      display: { key: undefined, label: undefined, groupPath: [...this.groupStack] },
      directScorePoints: input.directScorePoints,
      optionalConfigured: false,
      gateConfigured: false,
      threshold: undefined,
      scorePoints: input.directScorePoints,
      settled: undefined,
      pending: undefined,
    };
    this.entries.push(entry);
    return entry;
  }

  private assertRegistration(
    definition: unknown,
    owner: string,
  ): asserts definition is BooleanAssertionRegistrationV1<unknown> | MeasurementAssertionRegistrationV1 {
    if (!isRecord(definition) || typeof definition.evaluate !== "function") {
      throw new TypeError(`${owner} requires an Effect evaluation function`);
    }
    if (!isRecord(definition.subject) || definition.subject.kind !== "snapshot") {
      throw new TypeError(`${owner} requires snapshot subject material`);
    }
  }

  private evaluateBooleanMatch(
    match: BooleanMatch<unknown, unknown, "value">,
    value: unknown,
  ): Effect.Effect<EntrySettlement> {
    return Effect.tryPromise({
      try: () => evaluateBooleanMatch(match, value),
      catch: () => undefined,
    }).pipe(
      Effect.map((evaluation): EntrySettlement =>
        evaluation.state === "unavailable"
          ? Object.freeze({ state: "unavailable" as const, reason: "source-unavailable" as const })
          : this.booleanSettlement(evaluation),
      ),
      this.captureEvaluationFailure(),
    );
  }

  private evaluateScoreMatch(
    match: ScoreMatch<unknown>,
    value: unknown,
  ): Effect.Effect<EntrySettlement> {
    return Effect.tryPromise({
      try: () => evaluateScoreMatch(match, value),
      catch: () => undefined,
    }).pipe(
      Effect.map((value): EntrySettlement => {
        assertUnitInterval(value, "measurement Match result");
        return Object.freeze({ state: "measured" as const, value });
      }),
      this.captureEvaluationFailure(),
    );
  }

  private captureEvaluationFailure(): <Value>(
    effect: Effect.Effect<Value, unknown, never>,
  ) => Effect.Effect<Value | EntrySettlement, never, never> {
    return (effect) => effect.pipe(
      Effect.catchAllCause((cause) =>
        Cause.isInterruptedOnly(cause)
          ? Effect.interrupt
          : Effect.succeed(Object.freeze({ state: "errored" as const })),
      ),
    );
  }

  private booleanSettlement(
    evaluation: BooleanAssertionEvaluationV1<unknown>,
  ): EntrySettlement {
    switch (evaluation.state) {
      case "matched":
        return Object.freeze({ state: "matched" as const, value: evaluation.value });
      case "mismatched":
        return Object.freeze({ state: "mismatched" as const });
      case "unavailable":
        return Object.freeze({ state: "unavailable" as const, reason: evaluation.reason });
      case "not-applicable":
        return Object.freeze({ state: "not-applicable" as const });
    }
  }

  private measurementSettlement(
    evaluation: MeasurementAssertionEvaluationV1,
  ): EntrySettlement {
    switch (evaluation.state) {
      case "measured":
        assertUnitInterval(evaluation.value, "measurement Assertion result");
        return Object.freeze({ state: "measured" as const, value: evaluation.value });
      case "unavailable":
        return Object.freeze({ state: "unavailable" as const, reason: evaluation.reason });
      case "not-applicable":
        return Object.freeze({ state: "not-applicable" as const });
    }
  }

  /** Evaluates an entry at most once even when multiple Effect fibers await it. */
  private settle(entry: AssertionEntry): Effect.Effect<EntrySettlement> {
    return Effect.suspend(() => {
      if (entry.settled !== undefined) return Effect.succeed(entry.settled);
      if (entry.pending !== undefined) return entry.pending;
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (entry.settled !== undefined) return entry.settled;
          if (entry.pending !== undefined) return yield* entry.pending;
          const deferred = yield* Deferred.make<EntrySettlement>();
          entry.pending = deferred;
          const settled = yield* restore(
            Effect.suspend(entry.evaluate).pipe(
              Effect.catchAllCause((cause) =>
                Cause.isInterruptedOnly(cause)
                  ? Effect.interrupt
                  : Effect.succeed(Object.freeze({ state: "errored" as const })),
              ),
            ),
          ).pipe(
            Effect.onInterrupt(() =>
              Deferred.interrupt(deferred).pipe(
                Effect.zipRight(Effect.sync(() => {
                  if (entry.pending === deferred) entry.pending = undefined;
                })),
              ),
            ),
          );
          entry.settled = settled;
          yield* Deferred.succeed(deferred, settled);
          return settled;
        }),
      );
    });
  }

  private latchStop(
    entry: AssertionEntry,
    settlement: EntrySettlement,
  ): AssertionStopErrorV1 {
    if (this.stopped !== undefined) return this.stopped;
    const reason = settlement.state === "mismatched" || settlement.state === "measured"
      ? "condition-not-met" as const
      : settlement.state === "unavailable"
        ? "source-unavailable" as const
        : settlement.state === "not-applicable"
          ? "not-applicable" as const
          : "evaluator-failed" as const;
    this.stopped = Object.freeze({
      _tag: "AssertionStopErrorV1" as const,
      entryIndex: entry.index,
      reason,
    });
    return this.stopped;
  }

  private finishSeal(options: AssertionSealOptionsV1): SealedAssertionsRuntimeV1 {
    if (this.sealed !== undefined) return this.sealed;
    const entries: AssertionsAttachmentEntryInputV1<never, never>[] = [];
    const assertions: EvaluationAttemptFactsV1["assertions"][number][] = [];
    for (const entry of this.entries) {
      const sealedEntry = this.toAttachmentEntry(entry);
      entries.push(sealedEntry);
      assertions.push(Object.freeze({
        required: !entry.optionalConfigured,
        result: sealedEntry.result,
      }));
    }
    const facts: EvaluationAttemptFactsV1 = Object.freeze({
      execution: options.execution ?? "completed",
      explicitlySkipped: options.explicitlySkipped ?? false,
      assertions: Object.freeze(assertions),
    });
    this.sealed = Object.freeze({ entries: Object.freeze(entries), facts });
    return this.sealed;
  }

  private toAttachmentEntry(
    entry: AssertionEntry,
  ): AssertionsAttachmentEntryInputV1<never, never> {
    const settlement = entry.settled;
    if (settlement === undefined) throw new Error("Attempted to seal an unsettled Assertion entry");
    const display: AssertionDisplayV1 = Object.freeze({
      ...(entry.display.key === undefined ? {} : { key: entry.display.key }),
      ...(entry.display.label === undefined ? {} : { label: entry.display.label }),
      groupPath: Object.freeze([...entry.display.groupPath]),
    });
    const material = this.materialFor(entry, settlement);
    return Object.freeze({
      display,
      criterion: entry.criterion,
      subject: entry.subject,
      evidence: entry.evidence,
      coverage: material.coverage,
      limitations: material.limitations,
      result: this.resultFor(entry, settlement),
    });
  }

  private materialFor(entry: AssertionEntry, settlement: EntrySettlement): {
    readonly coverage: RecordAssertionCoverageV1;
    readonly limitations: readonly AssertionLimitationV1[];
  } {
    if (settlement.state === "unavailable") {
      return Object.freeze({
        coverage: Object.freeze({ state: "unavailable" as const, reason: "source-unavailable" as const }),
        limitations: Object.freeze([]),
      });
    }
    if (settlement.state === "not-applicable") {
      return Object.freeze({
        coverage: Object.freeze({ state: "not-applicable" as const, reason: "optional-material" as const }),
        limitations: Object.freeze([]),
      });
    }
    return Object.freeze({
      coverage: entry.initialCoverage,
      limitations: entry.initialLimitations,
    });
  }

  private resultFor(entry: AssertionEntry, settlement: EntrySettlement): SealedAssertionResultV1 {
    switch (settlement.state) {
      case "matched":
        return Object.freeze({
          state: "matched" as const,
          gate: this.gateForMatched(entry),
          score: this.availableScoreFor(entry, 1),
        });
      case "mismatched":
        return Object.freeze({
          state: "mismatched" as const,
          reason: "condition-not-met" as const,
          gate: this.gateForMismatched(entry),
          score: this.availableScoreFor(entry, 0),
        });
      case "measured": {
        const matched = entry.threshold === undefined || settlement.value >= entry.threshold;
        return matched
          ? Object.freeze({
              state: "matched" as const,
              gate: this.gateForMatched(entry),
              score: this.availableScoreFor(entry, settlement.value),
            })
          : Object.freeze({
              state: "mismatched" as const,
              reason: "condition-not-met" as const,
              gate: this.gateForMismatched(entry),
              score: this.availableScoreFor(entry, settlement.value),
            });
      }
      case "unavailable":
        return Object.freeze({
          state: "unavailable" as const,
          reason: settlement.reason,
          gate: this.gateForUnavailable(entry),
          score: this.incompleteScoreFor(entry, "source-unavailable"),
        });
      case "not-applicable":
        return Object.freeze({
          state: "not-applicable" as const,
          reason: "coverage-not-applicable" as const,
          gate: this.gateForNotApplicable(entry),
          score: this.incompleteScoreFor(entry, "not-applicable"),
        });
      case "errored":
        return Object.freeze({
          state: "errored" as const,
          reason: "evaluator-failed" as const,
          gate: this.gateForUnavailable(entry),
          score: this.incompleteScoreFor(entry, "evaluation-errored"),
        });
    }
  }

  private isGate(entry: AssertionEntry): boolean {
    if (entry.gateConfigured) return true;
    return this.evaluationKind === "pass"
      && (entry.kind === "boolean" || (entry.kind === "measurement" && entry.threshold !== undefined));
  }

  private gateForMatched(entry: AssertionEntry): "not-gate" | "satisfied" {
    return this.isGate(entry) ? "satisfied" : "not-gate";
  }

  private gateForMismatched(entry: AssertionEntry): "not-gate" | "failed" {
    return this.isGate(entry) ? "failed" : "not-gate";
  }

  private gateForUnavailable(entry: AssertionEntry): "not-gate" | "unavailable" {
    return this.isGate(entry) ? "unavailable" : "not-gate";
  }

  private gateForNotApplicable(entry: AssertionEntry): "not-gate" | "not-applicable" {
    return this.isGate(entry) ? "not-applicable" : "not-gate";
  }

  private availableScoreFor(
    entry: AssertionEntry,
    normalized: number,
  ): AvailableScoreContribution {
    const points = entry.scorePoints;
    if (points === undefined) return noScore();
    return earnedScore(points, points * normalized);
  }

  private incompleteScoreFor(
    entry: AssertionEntry,
    reason: UnavailableScoreContributionV1["reason"],
  ): IncompleteScoreContribution {
    const points = entry.scorePoints;
    return points === undefined ? noScore() : unavailableScore(points, reason);
  }

  private assertCanRegister(): void {
    if (this.stopped !== undefined) {
      throw new Error("Cannot register an Assertion after orStop() set the authoring stop latch");
    }
    if (this.closing || this.sealed !== undefined) {
      throw new Error("Cannot register an Assertion after the Attempt has sealed");
    }
  }

  private assertMutable(entry: AssertionEntry, method: string): void {
    this.assertCanRegister();
    if (entry.settled !== undefined || entry.pending !== undefined) {
      throw new Error(`Cannot configure an Assertion after ${method} has begun evaluation`);
    }
  }
}

/** Creates one Attempt-local assert-first authoring runtime. */
export function createAssertionsRuntimeV1(input: {
  readonly evaluationKind: "pass";
}): AssertionsRuntimeV1<"pass">;
export function createAssertionsRuntimeV1(input: {
  readonly evaluationKind: "score";
}): AssertionsRuntimeV1<"score">;
export function createAssertionsRuntimeV1(input: {
  readonly evaluationKind: AssertionEvaluationKindV1;
}): AssertionsRuntimeV1<AssertionEvaluationKindV1> {
  if (input.evaluationKind !== "pass" && input.evaluationKind !== "score") {
    throw new TypeError("Assertions runtime evaluationKind must be \"pass\" or \"score\"");
  }
  const runtime = new AssertionsRuntimeImplementation(input.evaluationKind);
  return runtime as AssertionsRuntimeV1<AssertionEvaluationKindV1>;
}
