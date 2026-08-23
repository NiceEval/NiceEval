import { Deferred, Effect, Either, Runtime, Scope } from "effect";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AttemptLocator } from "../attempt-locator.ts";
import type {
  BuiltinDomainViewBinding,
  FixedFamilyOwnerRequirement,
  PublishedAnalysisInputBinding,
  RecordReadBinding,
} from "../analysis/bindings.ts";
import { agentTurnsSource } from "../analysis/bindings.ts";
import type {
  BuiltinDomainView,
  ClosedRunDiagnosticsEntry,
  ClosedDomainEntry,
  RunDiagnosticsDomainView,
} from "../analysis/api.ts";
import type {
  BuiltinDomainDetail,
  BuiltinDomainViewKind,
  ClosedAttemptCore,
} from "../analysis/domain-view.ts";
import type { LogicalSlot } from "../analysis/definitions.ts";
import type { PricingProfile } from "../analysis/cost.ts";
import type { CostMetricValue } from "../analysis/cost.ts";
import {
  completedZeroCostSlot,
  projectCostUsage,
  unavailableCostSlot,
  type CostSlotProjection,
} from "../analysis/cost-projection.ts";
import { sampleCapabilityTypeId } from "../analysis/contracts.ts";
import type {
  ActiveAnalysisSlot,
  AnalysisRun,
  AttemptEvidenceIdentity,
  AnalysisIssue,
  AnalysisSelectionRequest,
  AnalysisSlotOccurrenceIdentity,
  DomainView,
  EvidenceRef,
  IncludedAnalysisSlot,
  JsonValue,
  Sample,
  SampleClosedError,
  SampleIdentity,
  SampleInputObservation,
  SampleSelector,
  SampleSnapshot,
  SampleSnapshotCodecError,
  SlotId,
} from "../analysis/contracts.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type { AgentTurnsAttachment } from "../record/family/agent-turns/definition.ts";
import type {
  FixedFamilyRead,
  ReadableAttempt,
  RecordReadSession,
  RecordSelection,
  SelectedAttemptRef,
  SelectedOwnerRef,
  SelectedRunRef,
} from "../record/host/types.ts";
import {
  closeAnalysisRunExecution,
  decodeSampleSnapshot as decodeSnapshot,
  decodeSampleSnapshotEither as decodeSnapshotEither,
  encodeSampleSnapshot as encodeSnapshot,
  materializeSampleSnapshot,
  narrowSampleSnapshot,
  narrowSampleSnapshotByCurrentIdentity,
} from "./analysis.ts";

interface SampleLifecycle {
  readonly inFlight: Set<AbortController>;
  readonly issueCaptures: Set<AnalysisIssueCaptureState>;
  readonly attempts: AttemptLazyCache;
  readonly attachments: RecordReadLazyCache;
  readonly costProjections: CostProjectionLazyCache;
  closed: boolean;
}

interface AnalysisIssueCaptureState {
  readonly lifecycle: SampleLifecycle;
  readonly issues: Map<string, AnalysisIssue>;
  readonly costs: Map<string, AnalysisCostCaptureEntry>;
  closed: boolean;
}

/** @internal Opaque execution-local token propagated by public Analysis calls. */
export type AnalysisIssueCaptureToken = AnalysisIssueCaptureState;

/** @internal Execution-local collection that Report turns into its problem table. */
export interface AnalysisIssueCapture {
  readonly issues: () => readonly AnalysisIssue[];
  /** Closed cost values requested during this exact host execution. */
  readonly costEntries: () => readonly AnalysisCostCaptureEntry[];
  readonly close: () => void;
  readonly run: <Value>(callback: () => Value) => Value;
}

/** @internal Host binds these data-only values to its target/page ownership. */
export interface AnalysisCostCaptureEntry {
  readonly measureId: string;
  readonly row: {
    readonly key: string;
    readonly dimensions: Readonly<Record<string, import("../analysis/definitions.ts").DimensionValue>>;
  };
  readonly profileIdentity: string;
  readonly projection: import("../analysis/cost.ts").CostProjectionValue;
}

interface SamplePromiseRunner {
  <Value, Error>(
    operation: Effect.Effect<Value, Error>,
    options: { readonly signal: AbortSignal },
  ): Promise<Value>;
}

interface SampleBinding {
  readonly reader: RecordReadSession;
  /** Nominal refs stay private and are only used to read selected Core. */
  readonly runRefs: readonly SelectedRunRef[];
  readonly attemptsBySlot: ReadonlyMap<string, SelectedAttemptRef>;
  readonly lifecycle: SampleLifecycle;
  /** Closed over the Runtime captured at issuance; never exposed on Sample. */
  readonly run: SamplePromiseRunner;
}

interface ResolvedAttempt {
  readonly attempt: ReadableAttempt;
  /** Closed during the same successful ReadableAttempt read as `attempt`. */
  readonly core: ClosedAttemptCore;
}

interface AttemptCoreUnavailable {
  readonly code: "analysis-attempt-core-unavailable";
}

interface AttemptReadFailed {
  readonly code: "analysis-attempt-read-failed";
  readonly message: string;
}

type CachedAttemptRead =
  | {
      readonly state: "available";
      readonly attempt: ReadableAttempt;
      readonly core: ClosedAttemptCore;
    }
  | { readonly state: "core-unavailable" }
  | { readonly state: "read-failed"; readonly message: string };

type AttemptCacheDeferred = Deferred.Deferred<CachedAttemptRead, SampleClosedError>;

type CachedRecordRead<Payload> =
  | { readonly state: "result"; readonly read: FixedFamilyRead<Payload> }
  | { readonly state: "read-failed"; readonly message: string };

type CacheDeferred = Deferred.Deferred<
  CachedRecordRead<unknown>,
  SampleClosedError
>;

type CostProjectionDeferred = Deferred.Deferred<
  readonly CostSlotProjection[],
  SampleClosedError
>;

/**
 * A Sample-local exact-once Core cache. The selected Attempt capability itself
 * is the key: no locator, path, Run id, or Attempt id is reconstructed here.
 * Keeping the resolved ReadableAttempt stable also keeps its nominal attempt
 * and origin owners stable for the fixed-family cache below.
 */
class AttemptLazyCache {
  private readonly byRef = new Map<SelectedAttemptRef, AttemptCacheDeferred>();

  read(input: {
    readonly sample: Sample;
    readonly reader: RecordReadSession;
    readonly ref: SelectedAttemptRef;
  }): Effect.Effect<CachedAttemptRead, SampleClosedError> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(this, function* () {
        const fresh = yield* Deferred.make<CachedAttemptRead, SampleClosedError>();
        const flight = yield* Effect.sync(() => {
          const pending = this.byRef.get(input.ref);
          if (pending !== undefined) return { _tag: "Follower" as const, deferred: pending };
          this.byRef.set(input.ref, fresh);
          return { _tag: "Leader" as const, deferred: fresh };
        });
        if (flight._tag === "Follower") return yield* restore(Deferred.await(flight.deferred));

        const completed = yield* Effect.exit(
          restore(
            Effect.flatMap(assertSampleOpen(input.sample), () =>
              Effect.catchAll(
                Effect.map(input.reader.readAttempt(input.ref), (read): CachedAttemptRead =>
                  read.state === "available"
                    ? Object.freeze({
                      state: "available" as const,
                      attempt: read.value,
                      // Do not defer this Core fact to another lookup. A
                      // successful ReadableAttempt is the only authority that
                      // can close its terminal outcome and origin execution
                      // history for Analysis. The origin must not be replaced
                      // with the selected target Run for carried/accepted
                      // members.
                      core: Object.freeze({
                        outcome: read.value.document.outcome,
                        origin: Object.freeze({
                          runId: read.value.origin.runId,
                          experimentId: read.value.origin.experimentId,
                          startedAt: read.value.origin.startedAt,
                          executionIdentityDigest: read.value.document.executionIdentityDigest,
                          execution: closeAnalysisRunExecution(read.value.origin.context.execution),
                        }),
                      }),
                    })
                    : Object.freeze({ state: "core-unavailable" as const })
                ),
                (error): Effect.Effect<CachedAttemptRead> => Effect.succeed(
                  Object.freeze({
                    state: "read-failed" as const,
                    message: safeErrorMessage(error),
                  }),
                ),
              ),
            ),
          ),
        );
        yield* Deferred.done(flight.deferred, completed);
        return yield* Deferred.await(flight.deferred);
      }),
    );
  }

  clear(): void {
    this.byRef.clear();
  }
}

/**
 * A Sample-local exact-once cache. Keys are the nominal owner capability and
 * the exact static source key, not a family string or an input id. Reader-side
 * assembled views use their own identity object and cannot masquerade as a
 * durable descriptor.
 * Deferreds keep concurrent readers in one in-flight operation and retain all
 * source states plus Record read failures for the remainder of Scope.
 */
class RecordReadLazyCache {
  private readonly byOwner = new Map<SelectedOwnerRef, Map<object, CacheDeferred>>();

  read<
    Payload,
    Source extends RecordReadBinding<FixedFamilyOwnerRequirement, Payload>,
  >(input: {
    readonly sample: Sample;
    readonly lifecycle: SampleLifecycle;
    readonly reader: RecordReadSession;
    readonly attempt: ReadableAttempt;
    readonly owner: SelectedOwnerRef;
    readonly source: Source;
  }): Effect.Effect<CachedRecordRead<Payload>, SampleClosedError> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(this, function* () {
        const fresh = yield* Deferred.make<CachedRecordRead<Payload>, SampleClosedError>();
        const flight = yield* Effect.sync(() => {
          let descriptors = this.byOwner.get(input.owner);
          if (descriptors === undefined) {
            descriptors = new Map();
            this.byOwner.set(input.owner, descriptors);
          }
          const pending = descriptors.get(input.source.cacheKey);
          if (pending !== undefined) {
            return { _tag: "Follower" as const, deferred: pending as Deferred.Deferred<CachedRecordRead<Payload>, SampleClosedError> };
          }
          descriptors.set(input.source.cacheKey, fresh as CacheDeferred);
          return { _tag: "Leader" as const, deferred: fresh };
        });
        if (flight._tag === "Follower") return yield* restore(Deferred.await(flight.deferred));

        const completed = yield* Effect.exit(
          restore(
            Effect.flatMap(assertSampleOpen(input.sample), () =>
              Effect.catchAll(
                Effect.map(
                  input.source.read(input.reader, input.attempt),
                  (read): CachedRecordRead<Payload> =>
                    Object.freeze({ state: "result" as const, read }),
                ),
                (error): Effect.Effect<CachedRecordRead<Payload>> => Effect.succeed(
                  Object.freeze({
                    state: "read-failed" as const,
                    message: safeErrorMessage(error),
                  }),
                ),
              ),
            ),
          ),
        );
        yield* Deferred.done(flight.deferred, completed);
        return yield* Deferred.await(flight.deferred);
      }),
    );
  }

  clear(): void {
    this.byOwner.clear();
  }
}

/**
 * Raw cost closure is memoized once for a Sample and Profile content identity.
 * Grouped mean/total reductions reuse the same closed Slot/provider ledger;
 * no Report page can trigger a second Usage interpretation for that pair.
 */
class CostProjectionLazyCache {
  private readonly byProfileIdentity = new Map<string, CostProjectionDeferred>();

  read(input: {
    readonly sample: Sample;
    readonly profile: PricingProfile;
    readonly build: () => Effect.Effect<readonly CostSlotProjection[], SampleClosedError>;
  }): Effect.Effect<readonly CostSlotProjection[], SampleClosedError> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(this, function* () {
        const fresh = yield* Deferred.make<readonly CostSlotProjection[], SampleClosedError>();
        const flight = yield* Effect.sync(() => {
          const pending = this.byProfileIdentity.get(input.profile.contentIdentity);
          if (pending !== undefined) return { _tag: "Follower" as const, deferred: pending };
          this.byProfileIdentity.set(input.profile.contentIdentity, fresh);
          return { _tag: "Leader" as const, deferred: fresh };
        });
        if (flight._tag === "Follower") return yield* restore(Deferred.await(flight.deferred));
        const completed = yield* Effect.exit(restore(input.build()));
        yield* Deferred.done(flight.deferred, completed);
        return yield* Deferred.await(flight.deferred);
      }),
    );
  }

  clear(): void {
    this.byProfileIdentity.clear();
  }
}

const sampleBindings = new WeakMap<Sample, SampleBinding>();
const issueCaptureContext = new AsyncLocalStorage<AnalysisIssueCaptureState>();

/**
 * Host-only opening operation. The Record session and its already-frozen
 * selection remain private in the binding map; Sample exposes only a closed
 * audit snapshot and Scope-bound lazy query capability.
 */
export function openSample(input: {
  readonly reader: RecordReadSession;
  readonly selection: RecordSelection;
  readonly selectionRequest: AnalysisSelectionRequest;
}): Effect.Effect<Sample, RecordReaderReadError, Scope.Scope> {
  return Effect.gen(function* () {
    const materialized = yield* materializeSampleSnapshot(input);
    const scope = yield* Effect.scope;
    const runtime = yield* Effect.runtime<never>();
    const lifecycle: SampleLifecycle = {
      closed: false,
      inFlight: new Set(),
      issueCaptures: new Set(),
      attempts: new AttemptLazyCache(),
      attachments: new RecordReadLazyCache(),
      costProjections: new CostProjectionLazyCache(),
    };
    const sample = bindSample({
      reader: input.reader,
      runRefs: Object.freeze([...input.selection.runRefs]),
      attemptsBySlot: materialized.attemptsBySlot,
      lifecycle,
      run: Runtime.runPromise(runtime),
    }, materialized.snapshot);
    yield* Scope.addFinalizer(scope, Effect.sync(() => closeLifecycle(lifecycle)));
    return sample;
  });
}

/**
 * Narrowing is synchronous, monotonic, and requires the issuing Scope to be
 * live. It never reopens Record or starts family I/O.
 */
export function narrowSample(sample: Sample, selector: SampleSelector): Sample {
  const binding = sampleBindings.get(sample);
  if (binding === undefined || binding.lifecycle.closed) throw sampleClosed(sample?.snapshot?.identity);
  const narrowed = narrowSampleSnapshot(sample.snapshot, selector);
  if ("code" in narrowed) throw narrowed;
  return bindSample(binding, narrowed);
}

/**
 * Named `project-current` narrowing. Matching SlotIds stay selected; every
 * other active Slot becomes `excluded` with `identity-mismatch`. The caller
 * supplies occurrence matches after it has aligned logical identities.
 */
export function narrowSampleByCurrentIdentity(
  sample: Sample,
  matchingOccurrences: readonly AnalysisSlotOccurrenceIdentity[],
): Sample {
  const binding = sampleBindings.get(sample);
  if (binding === undefined || binding.lifecycle.closed) throw sampleClosed(sample?.snapshot?.identity);
  return bindSample(binding, narrowSampleSnapshotByCurrentIdentity(sample.snapshot, matchingOccurrences));
}

/**
 * Promise boundary for author-facing Analysis operations. The Runtime belongs
 * to the original scoped Sample, so public APIs never choose a global runtime
 * or run an Effect from inside a definition.
 *
 * @internal
 */
export function runSamplePromise<Value, Error>(
  sample: Sample,
  operation: Effect.Effect<Value, Error>,
): Promise<Value> {
  const binding = sampleBindings.get(sample);
  if (binding === undefined || binding.lifecycle.closed) {
    return Promise.reject(sampleClosed(sample?.snapshot?.identity));
  }
  const controller = new AbortController();
  binding.lifecycle.inFlight.add(controller);
  if (binding.lifecycle.closed) {
    controller.abort();
    binding.lifecycle.inFlight.delete(controller);
    return Promise.reject(sampleClosed(sample.snapshot.identity));
  }
  return binding.run(Effect.flatMap(assertSampleOpen(sample), () => operation), { signal: controller.signal })
    .catch((error: unknown) => {
      if (binding.lifecycle.closed) throw sampleClosed(sample.snapshot.identity);
      throw error;
    })
    .finally(() => binding.lifecycle.inFlight.delete(controller));
}

/** @internal Stops an operation before it can start Record I/O after closure. */
export function assertSampleOpen(sample: Sample): Effect.Effect<void, SampleClosedError> {
  return Effect.suspend(() => {
    const binding = sampleBindings.get(sample);
    return binding === undefined || binding.lifecycle.closed
      ? Effect.fail(sampleClosed(sample?.snapshot?.identity))
      : Effect.void;
  });
}

/**
 * Starts a Report-execution-local collection of Analysis data issues. It is
 * private to hosts: callbacks still receive only closed data values.
 *
 * @internal
 */
export function captureAnalysisIssues(
  sample: Sample,
): Effect.Effect<AnalysisIssueCapture, SampleClosedError> {
  return Effect.flatMap(assertSampleOpen(sample), () => {
    const binding = sampleBindings.get(sample);
    if (binding === undefined || binding.lifecycle.closed) {
      return Effect.fail(sampleClosed(sample.snapshot.identity));
    }
    const state: AnalysisIssueCaptureState = {
      lifecycle: binding.lifecycle,
      issues: new Map(),
      costs: new Map(),
      closed: false,
    };
    binding.lifecycle.issueCaptures.add(state);
    return Effect.succeed(Object.freeze({
      issues: () => freezeIssues([...state.issues.values()]),
      costEntries: () => freezeCostEntries([...state.costs.values()]),
      close: () => {
        if (state.closed) return;
        state.closed = true;
        binding.lifecycle.issueCaptures.delete(state);
      },
      run: <Value>(callback: () => Value): Value => issueCaptureContext.run(state, callback),
    }));
  });
}

/**
 * Gets the execution-local capture synchronously while an author callback
 * starts a public Analysis Promise. The token is then carried explicitly
 * through the Effect runtime rather than consulting AsyncLocalStorage later.
 *
 * @internal
 */
export function currentAnalysisIssueCapture(sample: Sample): AnalysisIssueCaptureToken | undefined {
  const binding = sampleBindings.get(sample);
  if (binding === undefined || binding.lifecycle.closed) return undefined;
  const capture = issueCaptureContext.getStore();
  return capture === undefined || capture.closed || capture.lifecycle !== binding.lifecycle
    ? undefined
    : capture;
}

/** @internal Records already-closed Analysis issues for one explicit host execution. */
export function recordAnalysisIssues(
  sample: Sample,
  issues: readonly AnalysisIssue[],
  capture: AnalysisIssueCaptureToken | undefined,
): void {
  const binding = sampleBindings.get(sample);
  if (binding === undefined || binding.lifecycle.closed || issues.length === 0) return;
  if (capture === undefined || capture.closed || capture.lifecycle !== binding.lifecycle) return;
  for (const issue of freezeIssues(issues)) {
    // Unsupported is a closed, locally renderable MetricValue/DomainView
    // state. Report components retain it with its refs; it is not a Host-level
    // warning about a failed or unexpectedly missing analysis input.
    if (issue.code === "unsupported") continue;
    const key = analysisIssueIdentity(issue);
    if (!capture.issues.has(key)) capture.issues.set(key, issue);
  }
}

/** @internal Records one already-closed cost cell for the active Host execution. */
export function recordAnalysisCostMetric(
  sample: Sample,
  input: {
    readonly measureId: string;
    readonly row: {
      readonly key: string;
      readonly dimensions: Readonly<Record<string, import("../analysis/definitions.ts").DimensionValue>>;
    };
    readonly metric: CostMetricValue;
  },
  capture: AnalysisIssueCaptureToken | undefined,
): void {
  const binding = sampleBindings.get(sample);
  if (binding === undefined || binding.lifecycle.closed || capture === undefined || capture.closed || capture.lifecycle !== binding.lifecycle) {
    return;
  }
  const dimensions = Object.freeze(Object.fromEntries(
    Object.entries(input.row.dimensions).sort(([left], [right]) => compareUtf8(left, right)),
  ));
  const entry: AnalysisCostCaptureEntry = Object.freeze({
    measureId: input.measureId,
    row: Object.freeze({ key: input.row.key, dimensions }),
    profileIdentity: input.metric.projection.profile.contentIdentity,
    projection: input.metric.projection,
  });
  // Analysis only deduplicates byte-for-byte equivalent closed entries. A
  // repeated machine key with distinct dimensions or projection remains
  // visible to Host, which owns typed page/route conflict decisions.
  const key = canonicalCostCaptureIdentity(entry);
  if (!capture.costs.has(key)) capture.costs.set(key, entry);
}

/** @internal Enumerates selected logical Slots without Record I/O. */
export function logicalSlotMembersForSample(
  sample: Sample,
): Effect.Effect<readonly LogicalSlot[], SampleClosedError> {
  return Effect.map(assertSampleOpen(sample), () => {
    const runsById = new Map(sample.snapshot.runs.map((run) => [run.runId, run] as const));
    return Object.freeze(sample.snapshot.slots.flatMap((slot): readonly LogicalSlot[] => {
      if (slot.state === "excluded") return [];
      const run = runsById.get(slot.runId);
      if (run === undefined) throw new Error("SampleSnapshot Slot has no selected AnalysisRun");
      return [logicalSlotFromActiveSlot(slot, run)];
    }));
  });
}

/**
 * @internal Reads and closes every selected Slot once for one Profile content
 * identity. The return value contains only data, never a reader, owner, or
 * attachment payload capable of another interpretation.
 */
export function readCostProjection(
  sample: Sample,
  profile: PricingProfile,
): Effect.Effect<readonly CostSlotProjection[], SampleClosedError> {
  return Effect.gen(function* () {
    yield* assertSampleOpen(sample);
    const binding = sampleBindings.get(sample);
    if (binding === undefined) return yield* Effect.fail(sampleClosed(sample.snapshot.identity));
    return yield* binding.lifecycle.costProjections.read({
      sample,
      profile,
      build: () => Effect.flatMap(logicalSlotMembersForSample(sample), (members) =>
        Effect.forEach(
          members,
          (member) => readCostSlot(sample, binding, member, profile),
          { concurrency: 32 },
        ).pipe(Effect.map((entries) => Object.freeze(entries))),
      ),
    });
  });
}

/**
 * Reads one statically published input through its immutable binding. There is
 * no input-id lookup: the binding carries its semantic id, owner contract,
 * exact source identity, and pure projector together.
 */
export function readPublishedInput<
  Value,
  Payload,
  Source extends RecordReadBinding<FixedFamilyOwnerRequirement, Payload>,
>(
  sample: Sample,
  input: PublishedAnalysisInputBinding<Value, Payload, Source>,
  member: LogicalSlot,
): Effect.Effect<SampleInputObservation<Value>, SampleClosedError> {
  if (member.state === "not-recorded") return Effect.succeed(missingObservation(member));
  if (member.state === "core-invalid" || member.attempt === undefined) {
    return Effect.succeed(invalidObservation(member));
  }
  const included = member as LogicalSlot & { readonly attempt: AttemptEvidenceIdentity };
  const operation = Effect.gen(function* () {
    const binding = sampleBindings.get(sample);
    if (binding === undefined) return yield* Effect.fail(sampleClosed(sample.snapshot.identity));
    const resolved = yield* resolveAttempt(sample, binding, included);
    const cached = yield* readRecordSource<Payload, Source>(
      sample,
      binding,
      resolved.attempt,
      input.source,
    );
    if (cached.state === "read-failed") {
      return failedObservation(included, `Record read failed: ${cached.message}`);
    }
    if (cached.read.state === "not-recorded" && input.projectNotRecorded !== undefined) {
      const projected = input.projectNotRecorded({
        member: included,
        core: resolved.core,
      });
      if (projected.state === "value") return valueObservation(projected.value, evidenceRefs(included));
      if (projected.state === "migration-required") return migrationRequiredObservation(included, projected.message);
      if (projected.state === "unsupported") return unsupportedObservation(included, projected.message);
      if (projected.state === "failed") return failedObservation(included, projected.message);
      return missingObservation(included, projected.message);
    }
    if (cached.read.state !== "available") {
      return observationFromFamily(included, cached.read, input.id);
    }
    const projected = input.project({
      member: included,
      core: resolved.core,
      payload: cached.read.value,
    });
    if (projected.state === "value") return valueObservation(projected.value, evidenceRefs(included));
    if (projected.state === "migration-required") return migrationRequiredObservation(included, projected.message);
    if (projected.state === "unsupported") return unsupportedObservation(included, projected.message);
    if (projected.state === "failed") return failedObservation(included, projected.message);
    return missingObservation(included, projected.message);
  });
  return Effect.catchAll(operation, (error) =>
    isSampleClosedError(error)
      ? Effect.fail(error)
      : Effect.succeed(failedObservation(included, `Record read failed: ${safeErrorMessage(error)}`)),
  );
}

/** @internal Executes one static, typed, closed DomainView binding. */
export function readBuiltinDomainView<
  Kind extends BuiltinDomainViewKind,
  Payload,
  Source extends RecordReadBinding<FixedFamilyOwnerRequirement, Payload>,
>(
  sample: Sample,
  binding: BuiltinDomainViewBinding<Kind, Payload, Source>,
  locator?: AttemptLocator,
): Effect.Effect<BuiltinDomainView<Kind>, SampleClosedError> {
  return Effect.gen(function* () {
    yield* assertSampleOpen(sample);
    const sampleBinding = sampleBindings.get(sample);
    if (sampleBinding === undefined) return yield* Effect.fail(sampleClosed(sample.snapshot.identity));
    const slots = sample.snapshot.slots.filter((slot): slot is IncludedAnalysisSlot =>
      slot.state === "included" && (locator === undefined || slot.attempt.locator === locator)
    );
    const entries: ClosedDomainEntry<Kind>[] = [];
    const issues: AnalysisIssue[] = [];
    for (const slot of slots) {
      const entry = yield* readDomainEntry(sample, sampleBinding, slot, binding);
      entries.push(entry.value);
      issues.push(...entry.issues);
    }
    const refs = freezeRefs([
      ...slots.map((slot) => evidenceRef(slot.attempt)),
      ...issues.flatMap((issue) => issue.refs),
    ]);
    const view: BuiltinDomainView<Kind> = Object.freeze({
      kind: "domain-view" as const,
      identity: Object.freeze({
        kind: "domain-view" as const,
        id: canonicalIdentity("domain-view", [sample.snapshot.identity.id, binding.kind, locator ?? null]),
      }),
      view: binding.kind,
      entries: Object.freeze(entries),
      issues: freezeIssues(issues),
      refs,
    });
    return view;
  });
}

/** @internal Closes Run-owned diagnostics without requiring an Attempt locator. */
export function readRunDiagnosticsDomainView(
  sample: Sample,
): Effect.Effect<RunDiagnosticsDomainView, SampleClosedError> {
  return Effect.gen(function* () {
    yield* assertSampleOpen(sample);
    const binding = sampleBindings.get(sample);
    if (binding === undefined) return yield* Effect.fail(sampleClosed(sample.snapshot.identity));
    const selectedRunIds = new Set(sample.snapshot.runs.map((run) => String(run.runId)));
    const experimentByRun = new Map(sample.snapshot.runs.map((run) => [String(run.runId), String(run.experimentId)]));
    const entries: RunDiagnosticsDomainView["entries"][number][] = [];
    for (const ref of binding.runRefs) {
      const runId = String(ref.runId);
      if (!selectedRunIds.has(runId)) continue;
      const experimentId = experimentByRun.get(runId) ?? "unknown";
      const runRead = yield* Effect.either(binding.reader.readRun(ref));
      let entry: ClosedRunDiagnosticsEntry;
      if (Either.isLeft(runRead)) {
        entry = Object.freeze({
          runId,
          experimentId,
          state: "failed" as const,
          detail: `Record read failed: ${safeErrorMessage(runRead.left)}`,
        });
      } else if (runRead.right.state !== "available") {
        entry = Object.freeze({
          runId,
          experimentId,
          state: runRead.right.state === "missing" ? "not-recorded" as const : "invalid" as const,
        });
      } else {
        const diagnostics = yield* Effect.either(
          binding.reader.readRunRunnerDiagnostics(runRead.right.value.owner),
        );
        if (Either.isLeft(diagnostics)) {
          entry = Object.freeze({
            runId,
            experimentId,
            state: "failed" as const,
            detail: `Record read failed: ${safeErrorMessage(diagnostics.left)}`,
          });
        } else if (diagnostics.right.state !== "available") {
          entry = Object.freeze({
            runId,
            experimentId,
            state: diagnostics.right.state === "not-recorded"
              ? "not-recorded" as const
              : diagnostics.right.state === "migration-required"
                ? "migration-required" as const
                : diagnostics.right.state === "unsupported"
                  ? "unsupported" as const
                  : "invalid" as const,
          });
        } else {
          entry = Object.freeze({
            runId,
            experimentId,
            state: "available" as const,
            detail: Object.freeze({
              dependencies: Object.freeze(["niceeval.runner-diagnostics"] as const),
              collection: Object.freeze({
                state: diagnostics.right.value.collection.state,
                limitations: Object.freeze([...diagnostics.right.value.collection.limitations]),
              }),
              diagnostics: Object.freeze(diagnostics.right.value.segments.map((diagnostic) => Object.freeze({
                diagnosticId: String(diagnostic.diagnosticId),
                kind: diagnostic.kind,
                code: String(diagnostic.code),
                phase: diagnostic.phase,
                summary: String(diagnostic.summary),
                causes: Object.freeze(diagnostic.causes.map((cause) => Object.freeze({
                  code: String(cause.code),
                  summary: String(cause.summary),
                }))),
                redaction: diagnostic.redaction,
                sourceFrame: diagnostic.sourceFrame,
              }))),
            }),
          });
        }
      }
      entries.push(entry);
    }
    return Object.freeze({
      kind: "domain-view" as const,
      identity: Object.freeze({
        kind: "domain-view" as const,
        id: canonicalIdentity("domain-view", [sample.snapshot.identity.id, "run-diagnostics"]),
      }),
      view: "run-diagnostics" as const,
      entries: Object.freeze(entries),
      issues: Object.freeze([]),
      refs: Object.freeze([]),
    });
  });
}

/** Snapshot is the only Sample value that can cross a JSON boundary. */
export function encodeSampleSnapshot(snapshot: SampleSnapshot): JsonValue {
  return encodeSnapshot(snapshot);
}

/** Exact decode, canonical ordering, coverage validation, and deep freeze. */
export function decodeSampleSnapshot(value: unknown): SampleSnapshot {
  return decodeSnapshot(value);
}

/** @internal Typed codec branch used where callers retain the failure ADT. */
export function decodeSampleSnapshotEither(
  value: unknown,
): Either.Either<SampleSnapshot, SampleSnapshotCodecError> {
  return decodeSnapshotEither(value);
}

function bindSample(binding: SampleBinding, snapshot: SampleSnapshot): Sample {
  const sample: Sample = Object.freeze({
    kind: "analysis-sample",
    snapshot,
    [sampleCapabilityTypeId]: true as const,
  });
  sampleBindings.set(sample, binding);
  return sample;
}

function resolveAttempt(
  sample: Sample,
  binding: SampleBinding,
  member: LogicalSlot & { readonly attempt: AttemptEvidenceIdentity },
): Effect.Effect<ResolvedAttempt, SampleClosedError | AttemptCoreUnavailable | AttemptReadFailed> {
  const ref = binding.attemptsBySlot.get(slotKey(member.runId, member.slotId));
  if (ref === undefined) {
    return Effect.fail<AttemptCoreUnavailable>({ code: "analysis-attempt-core-unavailable" });
  }
  return Effect.flatMap(binding.lifecycle.attempts.read({ sample, reader: binding.reader, ref }), (cached) =>
    Effect.flatMap(
      assertSampleOpen(sample),
      (): Effect.Effect<ResolvedAttempt, AttemptCoreUnavailable | AttemptReadFailed> => {
      if (cached.state === "available") {
        return Effect.succeed(Object.freeze({ attempt: cached.attempt, core: cached.core }));
      }
      if (cached.state === "core-unavailable") {
        return Effect.fail<AttemptCoreUnavailable>({ code: "analysis-attempt-core-unavailable" });
      }
      return Effect.fail<AttemptReadFailed>(Object.freeze({
        code: "analysis-attempt-read-failed" as const,
        message: cached.message,
      }));
      },
    ),
  );
}

function readRecordSource<
  Payload,
  Source extends RecordReadBinding<FixedFamilyOwnerRequirement, Payload>,
>(
  sample: Sample,
  binding: SampleBinding,
  attempt: ReadableAttempt,
  source: Source,
): Effect.Effect<CachedRecordRead<Payload>, SampleClosedError> {
  const owner = source.owner === "attempt" ? attempt.owner : attempt.origin.owner;
  return Effect.flatMap(
    binding.lifecycle.attachments.read<Payload, Source>({
      sample,
      lifecycle: binding.lifecycle,
      reader: binding.reader,
      attempt,
      owner,
      source,
    }),
    (cached) => Effect.as(assertSampleOpen(sample), cached),
  );
}

function readCostSlot(
  sample: Sample,
  binding: SampleBinding,
  member: LogicalSlot,
  profile: PricingProfile,
): Effect.Effect<CostSlotProjection, SampleClosedError> {
  if (member.state === "not-recorded") {
    return Effect.succeed(unavailableCostSlot(member, "member-not-recorded"));
  }
  if (member.state === "core-invalid" || member.attempt === undefined) {
    return Effect.succeed(unavailableCostSlot(member, "core-invalid"));
  }
  const included = member as LogicalSlot & { readonly attempt: AttemptEvidenceIdentity };
  const refs = Object.freeze([evidenceRef(included.attempt)]);
  const operation = Effect.gen(function* () {
    const resolved = yield* resolveAttempt(sample, binding, included);
    const cached = yield* readRecordSource<
      AgentTurnsAttachment,
      typeof agentTurnsSource
    >(
      sample,
      binding,
      resolved.attempt,
      agentTurnsSource,
    );
    if (cached.state === "read-failed") {
      return unavailableCostSlot(included, "usage-unavailable", refs);
    }
    switch (cached.read.state) {
      case "available":
        return projectCostUsage({
          member: included,
          core: resolved.core,
          usage: Object.freeze({
            collection: cached.read.value.collection,
            observations: Object.freeze(cached.read.value.segments.flatMap((segment) => segment.usage)),
          }),
          profile,
          refs,
        });
      case "not-recorded":
        return resolved.core.outcome === "completed"
          ? completedZeroCostSlot(included, refs)
          : unavailableCostSlot(included, "usage-not-recorded", refs);
      case "unsupported":
        return unavailableCostSlot(included, "usage-unsupported", refs);
      case "migration-required":
        return unavailableCostSlot(included, "usage-migration-required", refs);
      case "invalid":
        return unavailableCostSlot(included, "usage-invalid", refs);
    }
  });
  return Effect.catchAll(operation, (error) =>
    isSampleClosedError(error)
      ? Effect.fail(error)
      : Effect.succeed(unavailableCostSlot(
        included,
        error.code === "analysis-attempt-core-unavailable" || error.code === "analysis-attempt-read-failed"
          ? "origin-run-unavailable"
          : "usage-unavailable",
        refs,
      )),
  );
}

function readDomainEntry<
  Kind extends BuiltinDomainViewKind,
  Payload,
  Source extends RecordReadBinding<FixedFamilyOwnerRequirement, Payload>,
>(
  sample: Sample,
  binding: SampleBinding,
  slot: IncludedAnalysisSlot,
  domain: BuiltinDomainViewBinding<Kind, Payload, Source>,
): Effect.Effect<
  { readonly value: ClosedDomainEntry<Kind>; readonly issues: readonly AnalysisIssue[] },
  SampleClosedError
> {
  const operation = Effect.gen(function* () {
    const run = analysisRunForSlot(sample.snapshot, slot);
    const resolved = yield* resolveAttempt(sample, binding, logicalSlotFromIncluded(slot, run));
    const cached = yield* readRecordSource<Payload, Source>(sample, binding, resolved.attempt, domain.source);
    if (cached.state === "read-failed") {
      return domainFailure<Kind>(
        slot.attempt,
        domain.kind,
        "the selected Record fact could not be read",
      );
    }
    if (cached.read.state !== "available") {
      return domainFamilyState<Kind, Payload>(
        slot.attempt,
        domain.kind,
        cached.read,
        !(cached.read.state === "not-recorded" && resolved.core.outcome !== "completed"),
      );
    }
    return domainAvailable<Kind>(
      slot.attempt,
      domain.kind,
      domain.project({
        core: resolved.core,
        payload: cached.read.value,
        blobs: cached.read.blobs,
      }),
    );
  });
  return Effect.catchAll(operation, (error) =>
    isSampleClosedError(error)
      ? Effect.fail(error)
      : Effect.succeed(domainFailure<Kind>(
        slot.attempt,
        domain.kind,
        attemptCoreFailureMessage(error),
      )),
  );
}

function attemptCoreFailureMessage(
  error: AttemptCoreUnavailable | AttemptReadFailed,
): string {
  return error.code === "analysis-attempt-core-unavailable"
    ? "the selected Attempt Core is unavailable"
    : `the selected Attempt Core could not be read: ${error.message}`;
}

function domainAvailable<Kind extends BuiltinDomainViewKind>(
  attempt: AttemptEvidenceIdentity,
  view: Kind,
  detail: BuiltinDomainDetail<Kind>,
): { readonly value: ClosedDomainEntry<Kind>; readonly issues: readonly AnalysisIssue[] } {
  return Object.freeze({
    value: Object.freeze({ attempt, state: "available" as const, view, detail }),
    issues: Object.freeze([]),
  });
}

function logicalSlotFromActiveSlot(slot: ActiveAnalysisSlot, run: AnalysisRun): LogicalSlot {
  const base = {
    runId: slot.runId,
    run,
    slotId: slot.slotId,
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    attemptOrdinal: slot.attemptOrdinal,
    executionIdentityDigest: slot.executionIdentityDigest,
  };
  if (slot.state === "included") {
    return Object.freeze({
      ...base,
      state: "included" as const,
      action: slot.action,
      relation: slot.relation,
      attempt: slot.attempt,
    });
  }
  return Object.freeze({
    ...base,
    state: slot.state,
    action: slot.action,
  });
}

function logicalSlotFromIncluded(
  slot: IncludedAnalysisSlot,
  run: AnalysisRun,
): LogicalSlot & { readonly attempt: AttemptEvidenceIdentity } {
  return Object.freeze({
    runId: slot.runId,
    run,
    slotId: slot.slotId,
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    attemptOrdinal: slot.attemptOrdinal,
    executionIdentityDigest: slot.executionIdentityDigest,
    state: "included" as const,
    action: slot.action,
    relation: slot.relation,
    attempt: slot.attempt,
  });
}

function analysisRunForSlot(snapshot: SampleSnapshot, slot: IncludedAnalysisSlot): AnalysisRun {
  const run = snapshot.runs.find((candidate) => candidate.runId === slot.runId);
  if (run === undefined) throw new Error("SampleSnapshot Slot has no selected AnalysisRun");
  return run;
}

function domainFamilyState<Kind extends BuiltinDomainViewKind, Payload>(
  identity: AttemptEvidenceIdentity,
  view: Kind,
  read: Exclude<FixedFamilyRead<Payload>, { readonly state: "available" }>,
  reportIssue = true,
): { readonly value: ClosedDomainEntry<Kind>; readonly issues: readonly AnalysisIssue[] } {
  const state = read.state === "not-recorded"
    ? "not-recorded"
    : read.state === "migration-required"
      ? "migration-required"
      : read.state === "unsupported"
        ? "unsupported"
        : "invalid";
  const code = state === "not-recorded"
    ? "missing"
    : state === "migration-required"
      ? "migration-required"
      : state === "unsupported"
        ? "unsupported"
        : "input-invalid";
  const issue = analysisIssue(code, `${view} is ${state}`, [evidenceRef(identity)]);
  const value: ClosedDomainEntry<Kind> = Object.freeze({ attempt: identity, state, view });
  return Object.freeze({
    value,
    issues: reportIssue ? Object.freeze([issue]) : Object.freeze([]),
  });
}

function domainFailure<Kind extends BuiltinDomainViewKind>(
  identity: AttemptEvidenceIdentity,
  view: Kind,
  message: string,
): { readonly value: ClosedDomainEntry<Kind>; readonly issues: readonly AnalysisIssue[] } {
  const issue = analysisIssue("reduction-failed", message, [evidenceRef(identity)]);
  const value: ClosedDomainEntry<Kind> = Object.freeze({
    attempt: identity,
    state: "failed" as const,
    view,
    detail: message,
  });
  return Object.freeze({
    value,
    issues: Object.freeze([issue]),
  });
}

function observationFromFamily<Payload>(
  member: LogicalSlot,
  read: Exclude<FixedFamilyRead<Payload>, { readonly state: "available" }>,
  label: string,
): SampleInputObservation<never> {
  if (read.state === "not-recorded") return missingObservation(member);
  if (read.state === "migration-required") {
    return migrationRequiredObservation(member, `${label} requires migration`);
  }
  if (read.state === "unsupported") return unsupportedObservation(member, `${label} is unsupported`);
  return invalidObservation(member, `${label} is invalid`);
}

function closeLifecycle(lifecycle: SampleLifecycle): void {
  if (lifecycle.closed) return;
  lifecycle.closed = true;
  for (const controller of lifecycle.inFlight) controller.abort();
  lifecycle.inFlight.clear();
  lifecycle.attempts.clear();
  lifecycle.attachments.clear();
  lifecycle.costProjections.clear();
  for (const capture of lifecycle.issueCaptures) capture.closed = true;
  lifecycle.issueCaptures.clear();
}

function valueObservation<Value>(value: Value, refs: readonly EvidenceRef[]): SampleInputObservation<Value> {
  return Object.freeze({ state: "value" as const, value, refs });
}

function missingObservation(member: LogicalSlot, message = "the selected logical Slot has no input value"): SampleInputObservation<never> {
  return issueObservation("missing", member, message);
}

function invalidObservation(
  member: LogicalSlot,
  message = "the selected logical Slot has invalid Core facts",
): SampleInputObservation<never> {
  return issueObservation("input-invalid", member, message);
}

function unsupportedObservation(member: LogicalSlot, message: string): SampleInputObservation<never> {
  return issueObservation("unsupported", member, message);
}

function migrationRequiredObservation(member: LogicalSlot, message: string): SampleInputObservation<never> {
  return issueObservation("migration-required", member, message);
}

function failedObservation(member: LogicalSlot, message: string): SampleInputObservation<never> {
  return issueObservation("reduction-failed", member, message);
}

function issueObservation(
  code: AnalysisIssue["code"],
  member: LogicalSlot,
  message: string,
): SampleInputObservation<never> {
  const refs = evidenceRefs(member);
  return Object.freeze({
    state: code === "missing"
      ? "missing" as const
      : code === "migration-required"
        ? "migration-required" as const
        : code === "unsupported"
          ? "unsupported" as const
          : "failed" as const,
    issues: Object.freeze([analysisIssue(code, message, refs)]),
    refs,
  });
}

function evidenceRefs(member: LogicalSlot): readonly EvidenceRef[] {
  return member.attempt === undefined ? Object.freeze([]) : Object.freeze([evidenceRef(member.attempt)]);
}

function evidenceRef(identity: AttemptEvidenceIdentity): EvidenceRef {
  return Object.freeze({ identity: Object.freeze({ kind: "attempt" as const, locator: identity.locator }) });
}

function analysisIssue(
  code: AnalysisIssue["code"],
  message: string,
  refs: readonly EvidenceRef[] = [],
): AnalysisIssue {
  return Object.freeze({ code, message, refs: Object.freeze([...refs]) });
}

function freezeIssues(issues: readonly AnalysisIssue[]): readonly AnalysisIssue[] {
  const values = new Map<string, AnalysisIssue>();
  for (const issue of issues) {
    const closed = Object.freeze({
      code: issue.code,
      message: issue.message,
      refs: freezeRefs(issue.refs),
    });
    const key = analysisIssueIdentity(closed);
    if (!values.has(key)) values.set(key, closed);
  }
  return Object.freeze(
    [...values.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, issue]) => issue),
  );
}

function freezeCostEntries(
  entries: readonly AnalysisCostCaptureEntry[],
): readonly AnalysisCostCaptureEntry[] {
  return Object.freeze([...entries].sort((left, right) =>
    compareUtf8(canonicalCostCaptureIdentity(left), canonicalCostCaptureIdentity(right))
  ));
}

function canonicalCostCaptureIdentity(entry: AnalysisCostCaptureEntry): string {
  return canonicalCaptureJson(Object.freeze({
    measureId: entry.measureId,
    row: entry.row,
    profileIdentity: entry.profileIdentity,
    projection: entry.projection,
  }));
}

function canonicalCaptureJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalCaptureJson).join(",")}]`;
  if (typeof value !== "object" || value === null) {
    throw new Error("Analysis cost capture contains a non-JSON value");
  }
  const fields = Object.keys(value as Record<string, unknown>)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalCaptureJson((value as Record<string, unknown>)[key])}`);
  return `{${fields.join(",")}}`;
}

function freezeRefs(refs: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const values = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    const key = `${ref.identity.kind}\u0000${ref.identity.locator}`;
    if (!values.has(key)) {
      values.set(key, Object.freeze({
        identity: Object.freeze({ kind: ref.identity.kind, locator: ref.identity.locator }),
      }));
    }
  }
  return Object.freeze(
    [...values.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, ref]) => ref),
  );
}

function analysisIssueIdentity(issue: AnalysisIssue): string {
  return JSON.stringify([
    issue.code,
    issue.message,
    issue.refs.map((ref) => [ref.identity.kind, ref.identity.locator]),
  ]);
}

function slotKey(runId: string, slotId: string): string {
  return `${runId}\u0000${slotId}`;
}

function sampleClosed(identity: SampleIdentity | undefined): SampleClosedError {
  return Object.freeze({
    code: "analysis-sample-closed" as const,
    sample: identity ?? Object.freeze({ kind: "analysis-sample" as const, id: "unknown" }),
  });
}

function isSampleClosedError(value: unknown): value is SampleClosedError {
  return typeof value === "object" && value !== null
    && (value as { readonly code?: unknown }).code === "analysis-sample-closed";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "an unknown Record failure occurred";
}

function canonicalIdentity(namespace: string, value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("DomainView identity input must be JSON-serializable");
  return `${namespace}-v1:${encoded}`;
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const first = new TextEncoder().encode(left);
  const second = new TextEncoder().encode(right);
  const length = Math.min(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}
