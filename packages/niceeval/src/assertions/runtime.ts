import { Cause, Deferred, Effect } from "effect";

import type { SourceLoc } from "../shared/types.ts";

import {
  assertionHandleBrand,
  AssertionAuthoringClosedError,
  type AssertionCoverage,
  type AssertionCollectionReceipt,
  type AssertionCriterion,
  type AssertionDisplay,
  type AssertionEvaluationKind,
  type AssertionLimitation,
  type AssertionMaterial,
  type AssertionResult,
  type AssertionScoreContribution,
  type AssertionSealError,
  type AssertionSealOptions,
  type AssertionSnapshotObject,
  type AssertionSnapshotValue,
  type AssertionStopError,
  type AssertionStopExecutor,
  type AssertionsContext,
  type AssertionsRuntime,
  type BooleanAssertionHandle,
  type BooleanAssertionEvaluation,
  type BooleanAssertionRegistration,
  type CapturedAssertionSnapshot,
  type MeasurementAssertionEvaluation,
  type MeasurementAssertionRegistration,
  type MatcherQueryArtifact,
  type PassBooleanAssertionHandle,
  type PostRunBooleanAssertionHandle,
  type ScoreBooleanAssertionHandle,
  type SealedAssertionEntry,
  type SealedAssertionEvaluation,
  type SealedAssertionsRuntime,
} from "./api.ts";
import {
  assertManagedValueMatch,
  evaluateBooleanMatch,
  evaluateScoreMatch,
  isManagedThresholdedScoreMatch,
  looksLikeThresholdedScoreMatch,
  thresholdedScoreMatchValue,
  type BooleanMatch,
  type MatchDiagnostic,
  type ScoreMatch,
  type ThresholdedScoreMatch,
} from "./match.ts";
import { assertionRuntimeLimits } from "./limits.ts";

const UTF8 = new TextEncoder();

const assertionHandleRegistry = new WeakSet<object>();

type EntryKind = "boolean" | "measurement" | "direct-score";

interface SettlementDiagnostic {
  readonly diagnostic?: MatchDiagnostic;
  readonly explanation?: AssertionSnapshotObject;
  readonly receipt?: AssertionCollectionReceipt;
  readonly matcherArtifact?: MatcherQueryArtifact;
}

type AvailableResult =
  | ({ readonly state: "matched"; readonly value: unknown } & SettlementDiagnostic)
  | ({ readonly state: "mismatched" } & SettlementDiagnostic)
  | ({ readonly state: "measured"; readonly value: number } & SettlementDiagnostic);

type EntrySettlement =
  | AvailableResult
  | ({
      readonly state: "unavailable";
      readonly reason:
        | "evidence-unavailable"
        | "source-unavailable"
        | "redacted";
    } & SettlementDiagnostic)
  | ({ readonly state: "not-applicable" } & SettlementDiagnostic)
  | ({ readonly state: "errored" } & SettlementDiagnostic)
  | ({ readonly state: "interrupted" } & SettlementDiagnostic);

interface AssertionEntry {
  readonly index: number;
  readonly kind: EntryKind;
  readonly criterion: AssertionCriterion;
  readonly subject: AssertionMaterial;
  readonly evidence: readonly AssertionMaterial[];
  readonly initialCoverage: AssertionCoverage;
  readonly initialLimitations: readonly AssertionLimitation[];
  readonly evaluate: () => Effect.Effect<EntrySettlement, unknown, never>;
  readonly display: {
    key: string | undefined;
    label: string | undefined;
    groupPath: string[];
  };
  readonly directScorePoints: number | undefined;
  readonly interruptedMatcherArtifact: MatcherQueryArtifact | undefined;
  optionalConfigured: boolean;
  gateConfigured: boolean;
  threshold: number | undefined;
  scorePoints: number | undefined;
  settled: EntrySettlement | undefined;
  pending: Deferred.Deferred<EntrySettlement> | undefined;
}

/**
 * Source navigation remains a Runner-owned observation.  These types are
 * intentionally package-internal: neither the author-facing handle nor the
 * sealed Assertion value acquires a source field or durable identity.
 */
export type AssertionRuntimeSourceRole =
  | "declaration"
  | "threshold"
  | "score"
  | "gate"
  | "optional"
  | "stop";

export interface AssertionRuntimeSourceSite {
  readonly location: SourceLoc;
  readonly sourceOrder: number;
}

export interface AssertionRuntimeSourceOccurrence {
  readonly role: AssertionRuntimeSourceRole;
  readonly site?: AssertionRuntimeSourceSite;
  readonly outcome?: "continued" | "stopped" | "interrupted";
}

export interface AssertionsRuntimeSourceCaptureSnapshot {
  readonly entries: readonly {
    readonly occurrences: readonly AssertionRuntimeSourceOccurrence[];
  }[];
}

interface MutableAssertionRuntimeSourceOccurrence {
  readonly role: AssertionRuntimeSourceRole;
  readonly site?: AssertionRuntimeSourceSite;
  outcome?: "continued" | "stopped" | "interrupted";
}

interface AssertionRuntimeSourceEntry {
  readonly occurrences: MutableAssertionRuntimeSourceOccurrence[];
}

interface AssertionsRuntimeSourceCapture {
  readonly capture: () => AssertionRuntimeSourceSite | undefined;
  readonly entries: AssertionRuntimeSourceEntry[];
  readonly byEntry: WeakMap<AssertionEntry, AssertionRuntimeSourceEntry>;
}

const sourceCaptureByRuntime = new WeakMap<AssertionsRuntimeImplementation, AssertionsRuntimeSourceCapture>();

interface SnapshotState {
  truncated: boolean;
  omittedBytes: number;
  readonly seen: WeakSet<object>;
}

type AvailableScoreContribution = Extract<
  AssertionScoreContribution,
  { readonly state: "not-scored" | "earned" }
>;

type IncompleteScoreContribution = Extract<
  AssertionScoreContribution,
  { readonly state: "not-scored" | "unavailable" }
>;

function isRecord(value: unknown): value is globalThis.Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssertionStop(value: unknown): value is AssertionStopError {
  return isRecord(value) && value._tag === "AssertionStopError";
}

function isInterruptedAuthoringClosure(value: unknown): boolean {
  return value instanceof AssertionAuthoringClosedError && value.reason === "attempt-interrupted";
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
  if (Array.from(value).length > assertionRuntimeLimits.displayCodePoints) {
    throw new TypeError(
      `${owner} must be at most ${assertionRuntimeLimits.displayCodePoints} code points`,
    );
  }
}

function marker(value: string): AssertionSnapshotObject {
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
  if (bytes <= assertionRuntimeLimits.stringBytes) return value;

  let retainedBytes = 0;
  let retainedEnd = 0;
  for (const point of value) {
    const pointBytes = omittedBytes(point);
    if (retainedBytes + pointBytes > assertionRuntimeLimits.stringBytes) break;
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
  if (omittedBytes(key) <= assertionRuntimeLimits.stringBytes) return key;

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
): AssertionSnapshotValue {
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

  if (depth >= assertionRuntimeLimits.jsonDepth) {
    markTruncated(state);
    return marker("depth-truncated");
  }

  if (state.seen.has(value)) {
    markTruncated(state);
    return marker("cyclic-or-shared-reference");
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const length = Math.min(value.length, assertionRuntimeLimits.jsonArrayItems);
    if (length < value.length) markTruncated(state, value.length - length);
    const entries: AssertionSnapshotValue[] = [];
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
  const length = Math.min(keys.length, assertionRuntimeLimits.jsonObjectKeys);
  if (length < keys.length) markTruncated(state, keys.length - length);
  const entries: Array<readonly [string, AssertionSnapshotValue]> = [];
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

export function captureAssertionSnapshot(value: unknown): CapturedAssertionSnapshot {
  const state: SnapshotState = {
    truncated: false,
    omittedBytes: 0,
    seen: new WeakSet<object>(),
  };
  const snapshot = boundedSnapshotValue(value, 0, state);
  const material: Extract<AssertionMaterial, { readonly kind: "snapshot" }> = Object.freeze({
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

/**
 * Matcher diagnostics are runtime objects, but sealed Assertions need a
 * bounded JSON copy that keeps their tree (field children and locators) for
 * show/view without granting those readers evaluator authority.
 */
function captureMatchDiagnostic(
  value: MatchDiagnostic | undefined,
  depth = 0,
  seen = new WeakSet<object>(),
  budget = { remainingNodes: assertionRuntimeLimits.diagnosticNodes },
): AssertionSnapshotObject | undefined {
  if (value === undefined) return undefined;
  if (budget.remainingNodes <= 0) {
    return Object.freeze({
      code: "diagnostic-truncated",
      message: "matcher diagnostic exceeded the persisted node limit",
      path: Object.freeze([]),
    });
  }
  budget.remainingNodes -= 1;
  if (depth >= assertionRuntimeLimits.diagnosticDepth || seen.has(value)) {
    return Object.freeze({
      code: "diagnostic-truncated",
      message: depth >= assertionRuntimeLimits.diagnosticDepth
        ? "matcher diagnostic exceeded the persisted depth limit"
        : "matcher diagnostic contained a cycle",
      path: Object.freeze([]),
    });
  }
  seen.add(value);
  try {
    const text = (input: string): string => {
      const state: SnapshotState = { truncated: false, omittedBytes: 0, seen: new WeakSet<object>() };
      return boundedSnapshotString(input, state);
    };
    const output: globalThis.Record<string, AssertionSnapshotValue> = {
      code: text(value.code),
      message: text(value.message),
      path: Object.freeze(value.path.map((segment) => typeof segment === "string" ? text(segment) : segment)),
    };
    if (value.expected !== undefined) output.expected = text(value.expected);
    if (value.received !== undefined) output.received = text(value.received);
    if (value.reason !== undefined) output.reason = text(value.reason);
    if (value.locator !== undefined) {
      output.locator = value.locator.kind === "json-pointer"
        ? Object.freeze({ kind: "json-pointer", pointer: text(value.locator.pointer) })
        : Object.freeze({ kind: "tool-occurrence", id: text(value.locator.id) });
    }
    if (value.truncation !== undefined) {
      output.truncation = Object.freeze({ ...value.truncation });
    }
    if (value.children !== undefined) {
      const children: AssertionSnapshotValue[] = [];
      for (const child of value.children.slice(0, assertionRuntimeLimits.jsonArrayItems)) {
        if (budget.remainingNodes <= 0) break;
        const entry: globalThis.Record<string, AssertionSnapshotValue> = {
          index: child.index,
          state: child.state,
        };
        if (child.label !== undefined) entry.label = text(child.label);
        const diagnostic = captureMatchDiagnostic(child.diagnostic, depth + 1, seen, budget);
        if (diagnostic !== undefined) entry.diagnostic = diagnostic;
        children.push(Object.freeze(entry));
      }
      output.children = Object.freeze(children);
      if (children.length < value.children.length && output.truncation === undefined) {
        output.truncation = Object.freeze({
          code: "diagnostic-truncated",
          reason: "sampled",
          captured: children.length,
          knownTotal: value.children.length,
        });
      }
    }
    const captured = Object.freeze(output);
    const serialized = JSON.stringify(captured);
    const originalBytes = UTF8.encode(serialized).byteLength;
    if (originalBytes <= assertionRuntimeLimits.diagnosticBytes) return captured;
    return Object.freeze({
      code: output.code,
      message: output.message,
      path: output.path,
      ...(output.expected === undefined ? {} : { expected: output.expected }),
      ...(output.received === undefined ? {} : { received: output.received }),
      ...(output.reason === undefined ? {} : { reason: output.reason }),
      ...(output.locator === undefined ? {} : { locator: output.locator }),
      truncation: Object.freeze({
        code: "diagnostic-truncated",
        reason: "byte-limit",
        limitBytes: assertionRuntimeLimits.diagnosticBytes,
        originalBytes,
      }),
    });
  } finally {
    seen.delete(value);
  }
}

function freezeAssertionMaterial(
  material: AssertionMaterial,
): AssertionMaterial {
  if (material.kind === "snapshot") {
    return Object.freeze({ kind: "snapshot", value: material.value });
  }
  if (typeof material.preview !== "string" || material.preview.trim() === "") {
    throw new TypeError("record-attachment material requires a non-empty preview");
  }
  return Object.freeze({
    kind: "record-attachment",
    preview: material.preview,
  });
}

function cloneCoverage(coverage: AssertionCoverage): AssertionCoverage {
  return Object.freeze({ ...coverage });
}

function cloneLimitations(
  limitations: readonly AssertionLimitation[],
): readonly AssertionLimitation[] {
  return Object.freeze(limitations.map((limitation) => Object.freeze({ ...limitation })));
}

function noScore(): Extract<AssertionScoreContribution, { readonly state: "not-scored" }> {
  return Object.freeze({ state: "not-scored" as const });
}

function earnedScore(
  points: number,
  earned: number,
): Extract<AssertionScoreContribution, { readonly state: "earned" }> {
  return Object.freeze({ state: "earned" as const, points, earned });
}

function unavailableScore(
  points: number,
  reason: Extract<AssertionScoreContribution, { readonly state: "unavailable" }>["reason"],
): Extract<AssertionScoreContribution, { readonly state: "unavailable" }> {
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

  gate(value?: number): this {
    this.runtime.configureGate(this.entry, value);
    return this;
  }

  score(points: number): this {
    this.runtime.configureScore(this.entry, points);
    return this;
  }

  orStop(): Promise<unknown> {
    return this.runtime.requestStopBoolean(this.entry);
  }
}

function isScoreBooleanAssertionHandle<Refined>(
  handle:
    | PassBooleanAssertionHandle<Refined>
    | ScoreBooleanAssertionHandle<Refined>,
): handle is ScoreBooleanAssertionHandle<Refined> {
  return "score" in handle && typeof handle.score === "function";
}

/**
 * Gives a post-run producer a configuration-only view of an ordinary Boolean
 * entry. Keeping this as a distinct, null-prototype object matters at the
 * JavaScript boundary too: a cast must not recover `orStop()` and force a
 * deferred producer to evaluate before its Attempt has frozen its evidence.
 */
export function postRunBooleanAssertionHandle<
  Kind extends AssertionEvaluationKind,
  Refined,
>(
  handle: BooleanAssertionHandle<Kind, Refined>,
  evaluationKind: Kind,
): PostRunBooleanAssertionHandle<Kind, Refined> {
  const view = Object.create(null) as object;
  const descriptor = (value: unknown): PropertyDescriptor => ({
    value,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  Object.defineProperties(view, {
    [assertionHandleBrand]: {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    kind: descriptor("boolean"),
    key: descriptor((value: string) => {
      handle.key(value);
      return view;
    }),
    label: descriptor((value: string) => {
      handle.label(value);
      return view;
    }),
    group: descriptor((title: string) => {
      handle.group(title);
      return view;
    }),
    ...(evaluationKind === "pass"
      ? (() => {
          const passHandle = handle as PassBooleanAssertionHandle<Refined>;
          return {
            optional: descriptor(() => {
              passHandle.optional();
              return view;
            }),
            gate: descriptor(() => {
              passHandle.gate();
              return view;
            }),
          };
        })()
      : {}),
    ...(evaluationKind === "score"
      ? (() => {
          if (!isScoreBooleanAssertionHandle(handle)) {
            throw new Error("Score post-run Boolean Assertion received a non-score handle");
          }
          return {
            score: descriptor((points: number) => {
              handle.score(points);
              return view;
            }),
          };
        })()
      : {}),
  });
  assertionHandleRegistry.add(view);
  return Object.freeze(view) as PostRunBooleanAssertionHandle<Kind, Refined>;
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

  gate(value: number): this {
    this.runtime.configureGate(this.entry, value);
    return this;
  }

  score(points: number): this {
    this.runtime.configureScore(this.entry, points);
    return this;
  }

  orStop(): Promise<number> {
    return this.runtime.requestStopMeasurement(this.entry);
  }
}

class DirectScoreHandle extends HandleBase {
  readonly kind = "direct-score" as const;
}

class AssertionsRuntimeImplementation {
  readonly t: AssertionsContext<AssertionEvaluationKind>;
  private readonly entries: AssertionEntry[] = [];
  private readonly groupStack: string[] = [];
  private stopped: AssertionStopError | undefined;
  private closing = false;
  private sealed: SealedAssertionsRuntime | undefined;

  constructor(
    readonly evaluationKind: AssertionEvaluationKind,
    private readonly executeStop: AssertionStopExecutor,
  ) {
    const base = {
      evaluationKind,
      check: this.check.bind(this),
      group: this.withGroup.bind(this),
    };
    this.t = Object.freeze(
      evaluationKind === "score"
        ? { ...base, score: this.directScore.bind(this) }
        : base,
    ) as AssertionsContext<AssertionEvaluationKind>;
  }

  private recordSourceOccurrence(
    entry: AssertionEntry,
    role: AssertionRuntimeSourceRole,
  ): MutableAssertionRuntimeSourceOccurrence | undefined {
    const capture = sourceCaptureByRuntime.get(this);
    const capturedEntry = capture?.byEntry.get(entry);
    if (capturedEntry === undefined || capture === undefined) return undefined;
    let site: AssertionRuntimeSourceSite | undefined;
    try {
      site = capture.capture();
    } catch {
      // Source navigation must never change authoring or assertion behavior.
    }
    const occurrence: MutableAssertionRuntimeSourceOccurrence = {
      role,
      ...(site === undefined ? {} : { site }),
    };
    capturedEntry.occurrences.push(occurrence);
    return occurrence;
  }

  check<Value, Refined extends Value>(
    value: Value,
    match: BooleanMatch<NoInfer<Value>, Refined, "value">,
  ): BooleanHandle;
  check<Value>(value: Value, match: ScoreMatch<NoInfer<Value>>): MeasurementHandle;
  check<Value>(value: Value, match: ThresholdedScoreMatch<NoInfer<Value>>): MeasurementHandle;
  check(value: unknown, match: unknown, ...extra: readonly unknown[]): BooleanHandle | MeasurementHandle {
    if (extra.length > 0) {
      throw new TypeError("t.check() accepts exactly (value, match)");
    }
    this.assertCanRegister();
    if (typeof value === "object" && value !== null && assertionHandleRegistry.has(value)) {
      throw new TypeError("t.check() cannot use an AssertionHandle as a subject");
    }
    const thresholded = isManagedThresholdedScoreMatch(match)
      ? thresholdedScoreMatchValue(match)
      : undefined;
    if (thresholded === undefined && looksLikeThresholdedScoreMatch(match)) {
      throw new TypeError("t.check() match must be a threshold view created by ScoreMatch.atLeast()");
    }
    const managed = thresholded?.match ?? assertManagedValueMatch(match, "t.check() match");
    const captured = captureAssertionSnapshot(value);
    if (managed.kind === "boolean") {
      const entry = this.createEntry({
        kind: "boolean",
        criterion: Object.freeze({ kind: "value-match" as const, subject: "explicit-value" as const, matcher: Object.freeze({ state: "declared" as const, name: managed.name }) }),
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
      criterion: Object.freeze({ kind: "value-match" as const, subject: "explicit-value" as const, matcher: Object.freeze({ state: "declared" as const, name: managed.name }) }),
      subject: captured.material,
      evidence: Object.freeze([]),
      coverage: captured.coverage,
      limitations: captured.limitations,
      evaluate: () => this.evaluateScoreMatch(managed, value),
    });
    if (thresholded !== undefined) this.configureThreshold(entry, thresholded.threshold);
    return new MeasurementHandle(this, entry);
  }

  registerBoolean<Refined>(
    definition: BooleanAssertionRegistration<Refined>,
  ): BooleanHandle {
    this.assertCanRegister();
    this.assertRegistration(definition, "registerBoolean()");
    const entry = this.createEntry({
      kind: "boolean",
      criterion: definition.criterion,
      subject: freezeAssertionMaterial(definition.subject),
      evidence: Object.freeze((definition.evidence ?? []).map(freezeAssertionMaterial)),
      coverage: cloneCoverage(definition.coverage ?? { state: "complete" }),
      limitations: cloneLimitations(definition.limitations ?? []),
      interruptedMatcherArtifact: definition.interruptedMatcherArtifact,
      evaluate: () =>
        Effect.suspend(definition.evaluate).pipe(
          Effect.map((evaluation): EntrySettlement => this.booleanSettlement(evaluation)),
          this.captureEvaluationFailure(definition.interruptedMatcherArtifact),
        ),
    });
    return new BooleanHandle(this, entry);
  }

  registerMeasurement(
    definition: MeasurementAssertionRegistration,
  ): MeasurementHandle {
    this.assertCanRegister();
    this.assertRegistration(definition, "registerMeasurement()");
    const entry = this.createEntry({
      kind: "measurement",
      criterion: definition.criterion,
      subject: freezeAssertionMaterial(definition.subject),
      evidence: Object.freeze((definition.evidence ?? []).map(freezeAssertionMaterial)),
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
    const captured = captureAssertionSnapshot(points);
    const entry = this.createEntry({
      kind: "direct-score",
      criterion: Object.freeze({ kind: "direct-score" as const, source: "author" as const }),
      subject: captured.material,
      evidence: Object.freeze([]),
      coverage: captured.coverage,
      limitations: captured.limitations,
      directScorePoints: points,
      evaluate: () => Effect.succeed({ state: "matched", value: points }),
    });
    return new DirectScoreHandle(this, entry);
  }

  async withGroup<Value>(
    title: string,
    body: () => Value | PromiseLike<Value>,
  ): Promise<Awaited<Value>> {
    this.assertCanRegister();
    assertDisplayText(title, "t.group() title");
    if (this.groupStack.length >= assertionRuntimeLimits.groupDepth) {
      throw new Error(
        `Assertion group depth cannot exceed ${assertionRuntimeLimits.groupDepth}`,
      );
    }
    this.groupStack.push(title);
    try {
      return await body() as Awaited<Value>;
    } finally {
      const popped = this.groupStack.pop();
      if (popped !== title) {
        throw new Error("Assertion group stack lost nesting order");
      }
    }
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
    if (entry.display.groupPath.length >= assertionRuntimeLimits.groupDepth) {
      throw new Error(
        `Assertion group depth cannot exceed ${assertionRuntimeLimits.groupDepth}`,
      );
    }
    entry.display.groupPath.push(title);
  }

  configureOptional(entry: AssertionEntry): void {
    this.assertMutable(entry, "optional()");
    if (this.evaluationKind === "score") {
      throw new TypeError("optional() is not available in a Score Eval; every score contribution must be comparable");
    }
    if (entry.optionalConfigured) throw new Error("An Assertion optional policy is already configured");
    entry.optionalConfigured = true;
    this.recordSourceOccurrence(entry, "optional");
  }

  configureGate(entry: AssertionEntry, threshold?: number): void {
    this.assertMutable(entry, "gate()");
    if (this.evaluationKind === "score") {
      throw new TypeError("gate() is not available in a Score Eval; normal scoring always passes");
    }
    if (entry.kind === "direct-score") throw new TypeError("A direct-score Assertion cannot be a gate");
    if (entry.kind === "measurement") {
      if (threshold === undefined) {
        throw new TypeError("A measurement Assertion requires gate(threshold)");
      }
      assertUnitInterval(threshold, "gate() threshold");
      if (entry.threshold !== undefined) throw new Error("An Assertion threshold is already configured");
      entry.threshold = threshold;
    }
    if (entry.gateConfigured) throw new Error("An Assertion gate policy is already configured");
    entry.gateConfigured = true;
    this.recordSourceOccurrence(entry, "gate");
  }

  configureThreshold(entry: AssertionEntry, value: number): void {
    this.assertMutable(entry, "atLeast()");
    if (entry.kind !== "measurement") throw new TypeError("atLeast() is available only on a measurement Assertion");
    assertUnitInterval(value, "atLeast() threshold");
    if (entry.threshold !== undefined) throw new Error("An Assertion threshold is already configured");
    entry.threshold = value;
    this.recordSourceOccurrence(entry, "threshold");
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
    this.recordSourceOccurrence(entry, "score");
  }

  requestStopBoolean(entry: AssertionEntry): Promise<unknown> {
    return this.observeStop(entry, this.requestStop(this.stopBoolean(entry)));
  }

  requestStopMeasurement(entry: AssertionEntry): Promise<number> {
    return this.observeStop(entry, this.requestStop(this.stopMeasurement(entry)));
  }

  private observeStop<Value>(
    entry: AssertionEntry,
    result: Promise<Value>,
  ): Promise<Value> {
    const occurrence = this.recordSourceOccurrence(entry, "stop");
    return result.then(
      (value) => {
        if (occurrence !== undefined && occurrence.outcome === undefined) {
          occurrence.outcome = "continued";
        }
        return value;
      },
      (error: unknown) => {
        if (occurrence !== undefined && occurrence.outcome === undefined) {
          if (isAssertionStop(error)) occurrence.outcome = "stopped";
          else if (isInterruptedAuthoringClosure(error)) occurrence.outcome = "interrupted";
        }
        throw error;
      },
    );
  }

  private requestStop<Value>(
    effect: Effect.Effect<Value, AssertionStopError, never>,
  ): Promise<Value> {
    if (this.stopped !== undefined) return Promise.reject(this.stopped);
    if (this.sealed !== undefined) {
      return Promise.reject(new AssertionAuthoringClosedError("attempt-sealed"));
    }
    if (this.closing) {
      return Promise.reject(new AssertionAuthoringClosedError("attempt-sealing"));
    }
    try {
      return this.executeStop(effect);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private stopBoolean(entry: AssertionEntry): Effect.Effect<unknown, AssertionStopError> {
    return this.settleThrough(entry).pipe(
      Effect.flatMap((settlement) => {
        if (settlement.state === "matched") return Effect.succeed(settlement.value);
        return Effect.fail(this.latchStop(entry, settlement));
      }),
    );
  }

  private stopMeasurement(entry: AssertionEntry): Effect.Effect<number, AssertionStopError> {
    return this.settleThrough(entry).pipe(
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
    options: AssertionSealOptions = {},
  ): Effect.Effect<SealedAssertionsRuntime, AssertionSealError, never> {
    return Effect.suspend(() => {
      if (this.sealed !== undefined) return Effect.succeed(this.sealed);
      if (options.interrupted) {
        this.closing = true;
        for (const entry of this.entries) {
          if (entry.settled === undefined) {
            entry.settled = Object.freeze({
              state: "interrupted" as const,
              ...(entry.interruptedMatcherArtifact === undefined
                ? {}
                : { matcherArtifact: entry.interruptedMatcherArtifact }),
            });
          }
        }
        return Effect.sync(() => this.finishSeal({
          ...options,
          execution: "errored",
        }));
      }
      const missingThreshold = this.entries.find(
        (entry) => this.evaluationKind === "pass" && entry.kind === "measurement" && entry.threshold === undefined,
      );
      if (missingThreshold !== undefined) {
        return Effect.fail(Object.freeze({
          _tag: "AssertionSealError" as const,
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
    readonly criterion: AssertionCriterion;
    readonly subject: AssertionMaterial;
    readonly evidence: readonly AssertionMaterial[];
    readonly coverage: AssertionCoverage;
    readonly limitations: readonly AssertionLimitation[];
    readonly evaluate: () => Effect.Effect<EntrySettlement, unknown, never>;
    readonly directScorePoints?: number;
    readonly interruptedMatcherArtifact?: MatcherQueryArtifact;
  }): AssertionEntry {
    if (this.entries.length >= assertionRuntimeLimits.entries) {
      throw new Error(
        `An Assertions Attachment cannot contain more than ${assertionRuntimeLimits.entries} entries`,
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
      interruptedMatcherArtifact: input.interruptedMatcherArtifact,
      optionalConfigured: false,
      gateConfigured: false,
      threshold: undefined,
      scorePoints: input.directScorePoints,
      settled: undefined,
      pending: undefined,
    };
    this.entries.push(entry);
    const capture = sourceCaptureByRuntime.get(this);
    if (capture !== undefined) {
      const capturedEntry: AssertionRuntimeSourceEntry = { occurrences: [] };
      capture.entries.push(capturedEntry);
      capture.byEntry.set(entry, capturedEntry);
      this.recordSourceOccurrence(entry, "declaration");
    }
    return entry;
  }

  private assertRegistration(
    definition: unknown,
    owner: string,
  ): asserts definition is BooleanAssertionRegistration<unknown> | MeasurementAssertionRegistration {
    if (!isRecord(definition) || typeof definition.evaluate !== "function") {
      throw new TypeError(`${owner} requires an Effect evaluation function`);
    }
    if (
      !isRecord(definition.subject)
      || (definition.subject.kind !== "snapshot" && definition.subject.kind !== "record-attachment")
    ) {
      throw new TypeError(`${owner} requires snapshot or same-owner record-attachment subject material`);
    }
    if (
      definition.subject.kind === "record-attachment"
      && typeof definition.subject.preview !== "string"
    ) {
      throw new TypeError(`${owner} requires a record-attachment preview`);
    }
    if (
      definition.evidence !== undefined
      && (!Array.isArray(definition.evidence)
        || definition.evidence.some((material) =>
          !isRecord(material)
          || (material.kind !== "snapshot" && material.kind !== "record-attachment")
          || (material.kind === "record-attachment"
            && typeof material.preview !== "string"),
        ))
    ) {
      throw new TypeError(`${owner} evidence must use snapshot or record-attachment material`);
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
          ? Object.freeze({
              state: "unavailable" as const,
              reason: "source-unavailable" as const,
              ...(evaluation.diagnostic === undefined ? {} : { diagnostic: evaluation.diagnostic }),
            })
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

  private captureEvaluationFailure(
    matcherArtifact?: MatcherQueryArtifact,
  ): <Value>(
    effect: Effect.Effect<Value, unknown, never>,
  ) => Effect.Effect<Value | EntrySettlement, never, never> {
    return (effect) => effect.pipe(
      Effect.catchAllCause((cause) =>
        Cause.isInterruptedOnly(cause)
          ? Effect.interrupt
          : Effect.succeed(Object.freeze({
              state: "errored" as const,
              ...(matcherArtifact === undefined ? {} : { matcherArtifact }),
            })),
      ),
    );
  }

  private booleanSettlement(
    evaluation: BooleanAssertionEvaluation<unknown>,
  ): EntrySettlement {
    switch (evaluation.state) {
      case "matched":
        return Object.freeze({
          state: "matched" as const,
          value: evaluation.value,
          ...(evaluation.diagnostic === undefined ? {} : { diagnostic: evaluation.diagnostic }),
          ...(evaluation.receipt === undefined ? {} : { receipt: evaluation.receipt }),
          ...(evaluation.matcherArtifact === undefined ? {} : { matcherArtifact: evaluation.matcherArtifact }),
        });
      case "mismatched":
        return Object.freeze({
          state: "mismatched" as const,
          ...(evaluation.diagnostic === undefined ? {} : { diagnostic: evaluation.diagnostic }),
          ...(evaluation.receipt === undefined ? {} : { receipt: evaluation.receipt }),
          ...(evaluation.matcherArtifact === undefined ? {} : { matcherArtifact: evaluation.matcherArtifact }),
        });
      case "unavailable":
        return Object.freeze({
          state: "unavailable" as const,
          reason: evaluation.reason,
          ...(evaluation.diagnostic === undefined ? {} : { diagnostic: evaluation.diagnostic }),
          ...(evaluation.receipt === undefined ? {} : { receipt: evaluation.receipt }),
          ...(evaluation.matcherArtifact === undefined ? {} : { matcherArtifact: evaluation.matcherArtifact }),
        });
      case "not-applicable":
        return Object.freeze({
          state: "not-applicable" as const,
          ...(evaluation.diagnostic === undefined ? {} : { diagnostic: evaluation.diagnostic }),
          ...(evaluation.matcherArtifact === undefined ? {} : { matcherArtifact: evaluation.matcherArtifact }),
        });
    }
  }

  private measurementSettlement(
    evaluation: MeasurementAssertionEvaluation,
  ): EntrySettlement {
    switch (evaluation.state) {
      case "measured":
        assertUnitInterval(evaluation.value, "measurement Assertion result");
        return Object.freeze({
          state: "measured" as const,
          value: evaluation.value,
          ...(evaluation.detail === undefined ? {} : { explanation: evaluation.detail }),
        });
      case "unavailable":
        return Object.freeze({
          state: "unavailable" as const,
          reason: evaluation.reason,
          ...(evaluation.detail === undefined ? {} : { explanation: evaluation.detail }),
        });
      case "not-applicable":
        return Object.freeze({ state: "not-applicable" as const, ...(evaluation.detail === undefined ? {} : { explanation: evaluation.detail }) });
      case "errored":
        return Object.freeze({ state: "errored" as const, ...(evaluation.detail === undefined ? {} : { explanation: evaluation.detail }) });
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
          // An enclosing Attempt interruption may have synchronously sealed
          // this entry while its evaluator was unwinding. Preserve that
          // producer-interrupted terminal fact rather than resurrecting a
          // late evaluator result.
          const terminal = entry.settled ?? settled;
          entry.settled = terminal;
          yield* Deferred.succeed(deferred, terminal);
          return terminal;
        }),
      );
    });
  }

  /**
   * A control barrier may force evaluation early, but it must not let a later
   * Judge entry leapfrog an earlier declaration. `settle()` still memoizes the
   * individual work, so the normal seal only observes these same results.
   */
  private settleThrough(entry: AssertionEntry): Effect.Effect<EntrySettlement> {
    return Effect.forEach(
      this.entries.slice(0, entry.index + 1),
      (candidate) => this.settle(candidate),
    ).pipe(
      Effect.map((settlements) => {
        const settlement = settlements.at(-1);
        if (settlement === undefined) throw new Error("Assertion stop entry was not registered");
        return settlement;
      }),
    );
  }

  private latchStop(
    entry: AssertionEntry,
    settlement: EntrySettlement,
  ): AssertionStopError {
    if (this.stopped !== undefined) return this.stopped;
    const reason = settlement.state === "mismatched" || settlement.state === "measured"
      ? "condition-not-met" as const
      : settlement.state === "unavailable"
        ? "source-unavailable" as const
        : settlement.state === "not-applicable"
          ? "not-applicable" as const
          : "evaluator-failed" as const;
    this.stopped = Object.freeze({
      _tag: "AssertionStopError" as const,
      entryIndex: entry.index,
      reason,
    });
    return this.stopped;
  }

  private finishSeal(options: AssertionSealOptions): SealedAssertionsRuntime {
    if (this.sealed !== undefined) return this.sealed;
    const entries: SealedAssertionEntry[] = [];
    const assertions: SealedAssertionEvaluation["assertions"][number][] = [];
    for (const entry of this.entries) {
      const sealedEntry = this.toSealedEntry(entry);
      entries.push(sealedEntry);
      assertions.push(Object.freeze({
        required: !entry.optionalConfigured,
        result: sealedEntry.result,
      }));
    }
    const evaluation: SealedAssertionEvaluation = Object.freeze({
      execution: options.execution ?? "completed",
      explicitlySkipped: options.explicitlySkipped ?? false,
      assertions: Object.freeze(assertions),
    });
    this.sealed = Object.freeze({
      entries: Object.freeze(entries),
      evaluation,
    });
    return this.sealed;
  }

  private toSealedEntry(
    entry: AssertionEntry,
  ): SealedAssertionEntry {
    const settlement = entry.settled;
    if (settlement === undefined) throw new Error("Attempted to seal an unsettled Assertion entry");
    const display: AssertionDisplay = Object.freeze({
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
      policy: Object.freeze({
        requirement: entry.optionalConfigured ? "optional" as const : "required" as const,
        condition: entry.kind === "measurement" && entry.threshold !== undefined
          ? Object.freeze({ kind: "at-least" as const, threshold: entry.threshold })
          : entry.kind === "boolean"
            ? Object.freeze({ kind: "boolean" as const, expected: true as const })
            : Object.freeze({ kind: "record-only" as const }),
      }),
      observed: entry.kind === "boolean"
        ? Object.freeze({
            kind: "boolean" as const,
            outcome: settlement.state === "measured" || settlement.state === "interrupted"
              ? "errored" as const
              : settlement.state,
          })
        : entry.kind === "measurement"
          ? settlement.state === "measured"
            ? Object.freeze({ kind: "measurement" as const, state: "available" as const, value: settlement.value })
            : Object.freeze({ kind: "measurement" as const, state: "unavailable" as const })
          : settlement.state === "measured"
            ? Object.freeze({ kind: "direct-score" as const, state: "available" as const, value: settlement.value })
            : Object.freeze({ kind: "direct-score" as const, state: "unavailable" as const }),
      ...(settlement.matcherArtifact === undefined
        ? {}
        : { matcherArtifact: settlement.matcherArtifact }),
    });
  }

  private materialFor(entry: AssertionEntry, settlement: EntrySettlement): {
    readonly coverage: AssertionCoverage;
    readonly limitations: readonly AssertionLimitation[];
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

  private resultFor(entry: AssertionEntry, settlement: EntrySettlement): AssertionResult {
    const capturedDiagnostic = settlement.explanation ?? captureMatchDiagnostic(settlement.diagnostic);
    const diagnostic = capturedDiagnostic === undefined ? {} : { diagnostic: capturedDiagnostic };
    const receipt = settlement.receipt === undefined ? {} : { receipt: settlement.receipt };
    switch (settlement.state) {
      case "matched":
        return Object.freeze({
          state: "matched" as const,
          gate: this.gateForMatched(entry),
          score: this.availableScoreFor(entry, 1),
          ...diagnostic,
          ...receipt,
        });
      case "mismatched":
        return Object.freeze({
          state: "mismatched" as const,
          reason: "condition-not-met" as const,
          gate: this.gateForMismatched(entry),
          score: this.availableScoreFor(entry, 0),
          ...diagnostic,
          ...receipt,
        });
      case "measured": {
        const matched = entry.threshold === undefined || settlement.value >= entry.threshold;
        return matched
          ? Object.freeze({
              state: "matched" as const,
              gate: this.gateForMatched(entry),
              score: this.availableScoreFor(entry, settlement.value),
              ...diagnostic,
              ...receipt,
            })
          : Object.freeze({
              state: "mismatched" as const,
              reason: "condition-not-met" as const,
              gate: this.gateForMismatched(entry),
              score: this.availableScoreFor(entry, settlement.value),
              ...diagnostic,
              ...receipt,
            });
      }
      case "unavailable":
        return Object.freeze({
          state: "unavailable" as const,
          reason: settlement.reason,
          gate: this.gateForUnavailable(entry),
          score: this.incompleteScoreFor(entry, "source-unavailable"),
          ...diagnostic,
          ...receipt,
        });
      case "not-applicable":
        return Object.freeze({
          state: "not-applicable" as const,
          reason: "coverage-not-applicable" as const,
          gate: this.gateForNotApplicable(entry),
          score: this.incompleteScoreFor(entry, "not-applicable"),
          ...diagnostic,
          ...receipt,
        });
      case "errored":
        return Object.freeze({
          state: "errored" as const,
          reason: "evaluator-failed" as const,
          gate: this.gateForUnavailable(entry),
          score: this.incompleteScoreFor(entry, "evaluation-errored"),
          ...diagnostic,
          ...receipt,
        });
      case "interrupted":
        return Object.freeze({
          state: "errored" as const,
          reason: "producer-interrupted" as const,
          gate: this.gateForUnavailable(entry),
          score: this.incompleteScoreFor(entry, "evaluation-errored"),
          ...diagnostic,
          ...receipt,
        });
    }
  }

  private isGate(entry: AssertionEntry): boolean {
    if (entry.gateConfigured) return true;
    return this.evaluationKind === "pass" && entry.kind === "boolean";
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
    reason: Extract<AssertionScoreContribution, { readonly state: "unavailable" }>["reason"],
  ): IncompleteScoreContribution {
    const points = entry.scorePoints;
    return points === undefined ? noScore() : unavailableScore(points, reason);
  }

  private assertCanRegister(): void {
    if (this.stopped !== undefined) {
      throw new AssertionAuthoringClosedError("stop-latched");
    }
    if (this.sealed !== undefined) {
      throw new AssertionAuthoringClosedError("attempt-sealed");
    }
    if (this.closing) {
      throw new AssertionAuthoringClosedError("attempt-sealing");
    }
  }

  private assertMutable(entry: AssertionEntry, method: string): void {
    this.assertCanRegister();
    if (entry.settled !== undefined || entry.pending !== undefined) {
      throw new Error(`Cannot configure an Assertion after ${method} has begun evaluation`);
    }
  }
}

function sourceCaptureRuntime(
  runtime: AssertionsRuntime<"pass" | "score">,
): AssertionsRuntimeImplementation | undefined {
  return runtime instanceof AssertionsRuntimeImplementation ? runtime : undefined;
}

/** @internal Runner-only source observation hook; it never changes the public runtime value. */
export function attachAssertionsRuntimeSourceCapture(
  runtime: AssertionsRuntime<"pass" | "score">,
  capture: () => AssertionRuntimeSourceSite | undefined,
): void {
  const implementation = sourceCaptureRuntime(runtime);
  if (implementation === undefined) {
    throw new TypeError("Assertions source capture requires a NiceEval AssertionsRuntime");
  }
  if (sourceCaptureByRuntime.has(implementation)) {
    throw new Error("Assertions source capture is already attached to this runtime");
  }
  sourceCaptureByRuntime.set(implementation, {
    capture,
    entries: [],
    byEntry: new WeakMap<AssertionEntry, AssertionRuntimeSourceEntry>(),
  });
}

/** @internal Detached immutable journal for the Runner source producer. */
export function assertionsRuntimeSourceCaptureSnapshot(
  runtime: AssertionsRuntime<"pass" | "score">,
): AssertionsRuntimeSourceCaptureSnapshot | undefined {
  const implementation = sourceCaptureRuntime(runtime);
  const capture = implementation === undefined ? undefined : sourceCaptureByRuntime.get(implementation);
  if (capture === undefined) return undefined;
  return Object.freeze({
    entries: Object.freeze(capture.entries.map((entry) => Object.freeze({
      occurrences: Object.freeze(entry.occurrences.map((occurrence) => Object.freeze({
        role: occurrence.role,
        ...(occurrence.site === undefined ? {} : { site: occurrence.site }),
        ...(occurrence.outcome === undefined ? {} : { outcome: occurrence.outcome }),
      }))),
    }))),
  });
}

/** @internal Attempt interruption gives pending real stop calls their terminal disposition. */
export function markAssertionsRuntimeSourceCaptureInterrupted(
  runtime: AssertionsRuntime<"pass" | "score">,
): void {
  const implementation = sourceCaptureRuntime(runtime);
  const capture = implementation === undefined ? undefined : sourceCaptureByRuntime.get(implementation);
  if (capture === undefined) return;
  for (const entry of capture.entries) {
    for (const occurrence of entry.occurrences) {
      if (occurrence.role === "stop" && occurrence.outcome === undefined) {
        occurrence.outcome = "interrupted";
      }
    }
  }
}

/** Creates one Attempt-local assert-first authoring runtime. */
export function createAssertionsRuntime(input: {
  readonly evaluationKind: "pass";
  readonly executeStop?: AssertionStopExecutor;
}): AssertionsRuntime<"pass">;
export function createAssertionsRuntime(input: {
  readonly evaluationKind: "score";
  readonly executeStop?: AssertionStopExecutor;
}): AssertionsRuntime<"score">;
export function createAssertionsRuntime(input: {
  readonly evaluationKind: AssertionEvaluationKind;
  readonly executeStop?: AssertionStopExecutor;
}): AssertionsRuntime<AssertionEvaluationKind> {
  if (input.evaluationKind !== "pass" && input.evaluationKind !== "score") {
    throw new TypeError("Assertions runtime evaluationKind must be \"pass\" or \"score\"");
  }
  const executeStop = input.executeStop ?? (() =>
    Promise.reject(new AssertionAuthoringClosedError("runtime-unattached"))
  );
  const runtime = new AssertionsRuntimeImplementation(input.evaluationKind, executeStop);
  return runtime as AssertionsRuntime<AssertionEvaluationKind>;
}
