import { attemptObservabilityPublication } from "./record/observability-publication.ts";
import { attemptNotesForResult } from "./attempt-notes.ts";
import { agentInstallFactsForResult } from "./agent-install-facts.ts";
import { judgeUsageForResult } from "./judge-usage.ts";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { Cause, Effect, Result, Exit, Option, Schema, Semaphore, Stream } from "effect";

import { encodeAttemptLocator, type AttemptLocator } from "../attempt-locator.ts";
import type { SealedAttemptAssertions } from "../assertions/api.ts";
import type { AssertionsProducerError } from "../assertions/record/producer.ts";
import { NiceEvalRecordAttachments } from "../record/family/catalog.ts";
import { recordHost } from "../record/host/runtime.ts";
import {
  appendRunSourcesBeforeAttempt,
  discardAttemptWriteSession,
  stagePlanningReference,
} from "../record/host/sqlite-host.ts";
import type { AttemptWriteSession, RecordSealReceipt, RunWriteSession } from "../record/host/types.ts";
import { RecordEntropy } from "../record/platform/services.ts";
import { RunIdSchema } from "../record/codec/identifiers.ts";
import type { RunId, SlotId } from "../record/model/identifiers.ts";
import { recordRootPaths, type RecordRoot } from "../record/platform/root.ts";
import { attemptPublicationClosure } from "../record/codec/core.ts";
import { RecordRootInvalid } from "../record/platform/errors.ts";
import { recordSqlitePath } from "../record/sqlite/index.ts";
import type { ProjectStateDatabase } from "../record/sqlite/project-state-database.ts";
import type { RecordReaderOpenError, RecordReaderReadError } from "../record/reader/errors.ts";
import type { RecordWriteError } from "../record/writer/types.ts";
import {
  bindAttemptReference,
  closeRunResource,
  currentPublicationCutoff,
  publishOriginAttempt,
  createRunWriterGeneration,
  type PublicationCutoff,
  type RunAbsenceReason,
} from "../run/storage/index.ts";
import { cacheKey } from "./fingerprint.ts";
import {
  planProjectTargetReuse,
  planProjectTargetReuseWithoutSources,
  type ExecutionReusePlan,
  type ExecutionReusePlanSlot,
  type ProjectTargetReusePlanInvalid,
  type TargetRun,
} from "./reuse-plan.ts";
import {
  readCurrentExecutionReusePlanReadbacks,
  readCurrentExecutionReusePlanResults,
  type CurrentReusedAttemptReadback,
  type CurrentReuseReadback,
  type CurrentReuseReadbackPlanInvalid,
} from "./reuse-readback.ts";
import {
  createRunnerTurnContextsAttachment,
  createRunnerSourceWritePlan,
  type RunnerSourceProducerInvalid,
} from "./source-producer.ts";
import {
  createAttemptArtifactsAttachment,
  createAttemptFileChangesAttachment,
  createAttemptObservabilityAttachments,
  createRunArtifactsAttachment,
  createRunnerAssertionsAttachment,
  createRunObservabilityAttachments,
  recordAttemptCompletion,
} from "./record/attachments.ts";
import { adapterUsageForResult } from "./adapter-usage.ts";
import { adapterAttachmentsForResult, releaseAdapterAttachments } from "./adapter-attachments.ts";
import { adapterExecutionTracesForResult, validateExecutionTracePublication } from "./adapter-execution-trace.ts";
import { executionTracesRecordCollection } from "../record/family/execution-traces/definition.ts";
import { executionTraceIndexRecordCollection } from "../record/family/execution-traces/index-definition.ts";
import { ExecutionTraceIndexProjection } from "../record/family/execution-traces/index-projection.ts";
import type { ExecutionTraceStoredRecord } from "../record/family/execution-traces/schema.ts";
import {
  planRunnerRecordRun,
  previewRunnerRunId,
  runnerRecordSlotKey,
  runnerRecordUtcMillis,
  targetForRunnerRecordRun,
  type PlannedRunnerRecordRun,
  type RunnerRecordReuseInput,
  type RunnerRecordTargetIdentityInvalid,
  type RunnerRecordTargetInputMissing,
} from "./record/planning.ts";
import type { AgentRun, Attempt, DiscoveredEval, EvalResult } from "./types.ts";
import type { AttemptCostAttachment } from "../record/family/attempt-cost/definition.ts";
import { simulatedUserActivitiesForResult } from "../simulated-user/audit.ts";
import { getPricingEstimateReceipt } from "./pricing-estimate-receipt.ts";
import type { ExternalCause } from "../shared/external-cause.ts";
import type { RunStorageCommandError } from "../run/storage/index.ts";
import type { SessionTracker } from "./session.ts";
import type { AttemptState } from "../state/protocol.ts";

export {
  prepareRunnerRecordReuse,
  type RunnerRecordReuseInput,
  type RunnerRecordReusePreparationInput,
  type RunnerRecordReuseSlotInput,
  type RunnerRecordTargetIdentityInvalid,
  type RunnerRecordTargetInputMissing,
} from "./record/planning.ts";

type GapActionState = "pending" | "reserved" | "executed" | "not-dispatched" | "interrupted";

interface ActiveRunnerRecordAttempt {
  readonly attempt: Attempt;
  readonly session: AttemptWriteSession;
  readonly public: RunnerRecordAttempt;
  sealed: SealedAttemptAssertions | undefined;
  completed: boolean;
}

interface RunnerRecordRun extends PlannedRunnerRecordRun {
  readonly session: RunWriteSession;
  readonly target: TargetRun;
  readonly attempts: Map<SlotId, ActiveRunnerRecordAttempt>;
  /** Run-owned source snapshots only; never retain an Attempt result or collector. */
  readonly planSlots: Map<SlotId, ExecutionReusePlanSlot>;
  readonly gapActions: Map<SlotId, GapActionState>;
  readonly absenceReasons: Map<SlotId, RunAbsenceReason>;
  readonly writerGeneration: string;
}

export interface RunnerRecordAttempt {
  readonly slotId: SlotId;
  readonly attemptId: import("../record/model/identifiers.ts").AttemptId;
  readonly locator: AttemptLocator;
}

export type RecordAttemptLocator = AttemptLocator;

function createAttemptCostAttachment(result: EvalResult): AttemptCostAttachment {
  const receipt = getPricingEstimateReceipt(result);
  const activities = simulatedUserActivitiesForResult(result);
  const calls = activities.flatMap((activity) => activity.generations);
  const priced = calls.filter((call): call is typeof call & { readonly costUSD: number } => call.costUSD !== null);
  const reportedCalls = priced.filter((call) => call.priceSource?.kind === "reported").length;
  const builtinCatalogCalls = priced.filter((call) => call.priceSource?.kind === "builtin-catalog").length;
  function simulatedUserCostState() {
    if (calls.length === 0 || priced.length === calls.length) return "complete" as const;
    if (priced.length > 0) return "partial" as const;
    return "unpriced" as const;
  }
  function simulatedUserAmount(): number | null {
    if (calls.length === 0) return 0;
    if (priced.length === 0) return null;
    return priced.reduce((sum, call) => sum + call.costUSD, 0);
  }
  return {
    ...(activities.length === 0
      ? {}
      : {
          simulatedUser: {
            source: "simulated-user" as const,
            state: simulatedUserCostState(),
            amountUSD: simulatedUserAmount(),
            calls: calls.length,
            ...(reportedCalls === 0 ? {} : { costBasis: reportedCalls === priced.length ? "reported" : "mixed" }),
            ...(builtinCatalogCalls === 0 ? {} : { builtinCatalogCalls }),
          },
        }),
    ...(result.usage?.costUSD === undefined
      ? {}
      : {
          observed: { kind: "observed" as const, amountUSD: result.usage.costUSD },
        }),
    ...(receipt === undefined
      ? {}
      : {
          estimated: {
            kind: "estimated" as const,
            amountUSD: receipt.amountUSD,
            model: receipt.model,
            priceSource: receipt.priceSource,
            charges: receipt.charges,
          },
        }),
  };
}

export interface RunnerRecordAttemptInvalid {
  readonly code: "runner-record-attempt-invalid";
}

export interface RunnerRecordUnsealedAttempt {
  readonly code: "runner-record-attempt-unsealed";
  readonly slotId: SlotId;
}

export interface RunnerRecordMembershipStateInvalid {
  readonly code: "runner-record-membership-state-invalid";
  readonly slotId: SlotId;
}

export interface RunnerRecordAttemptPublicationFailed {
  readonly code: "runner-record-attempt-publication-failed";
  readonly locator: AttemptLocator;
  readonly cause: RunnerRecordWriteError | RunStorageCommandError;
  readonly message: string;
}

/** A seal return without its durable marker is never a publish receipt. */
export interface RunnerRecordPublishStateInvalid {
  readonly code: "runner-record-publish-state-invalid";
  readonly runId: RunId;
}

export interface RunnerRecordAssertionsInvalid {
  readonly code: "runner-record-assertions-invalid";
  readonly issue: AssertionsProducerError;
}

export interface RunnerRecordObservabilityInvalid {
  readonly code: "runner-record-observability-invalid";
  readonly owner: "attempt" | "run";
  readonly stage: "capture" | "attachment";
}

export interface RunnerRecordSourcesInvalid {
  readonly code: "runner-record-sources-invalid";
  readonly issue: RunnerSourceProducerInvalid;
}

export interface RunnerRecordArtifactsInvalid {
  readonly code: "runner-record-artifacts-invalid";
  readonly owner: "attempt" | "run";
  readonly reason: "trace-serialization-failed" | "attachment-closure-invalid";
}

export type RunnerRecordWriteError =
  | RecordWriteError
  | RunnerRecordAttemptInvalid
  | RunnerRecordUnsealedAttempt
  | RunnerRecordMembershipStateInvalid
  | RunnerRecordAttemptPublicationFailed
  | RunnerRecordPublishStateInvalid
  | RunnerRecordTargetIdentityInvalid
  | RunnerRecordAssertionsInvalid
  | RunnerRecordObservabilityInvalid
  | RunnerRecordSourcesInvalid
  | RunnerRecordArtifactsInvalid;

export type RunnerRecordOpenError =
  | RecordReaderOpenError
  | RecordWriteError
  | RecordReaderReadError
  | ProjectTargetReusePlanInvalid
  | RunnerRecordTargetInputMissing
  | RunnerRecordTargetIdentityInvalid
  | RunnerRecordMembershipStateInvalid
  | RunnerSessionOpenFailed;

export interface RunnerSessionOpenFailed {
  readonly code: "runner-session-open-failed";
  readonly cause: RecordReaderReadError | CurrentReuseReadbackPlanInvalid | RunStorageCommandError | ExternalCause;
}

export interface RunnerRecordCoordinator {
  readonly reusePlan: ExecutionReusePlan;
  readonly readCarriedResults: () => Effect.Effect<
    readonly CurrentReusedAttemptReadback[],
    RecordReaderReadError | CurrentReuseReadbackPlanInvalid
  >;
  readonly runIdsByExperiment: ReadonlyMap<string, string>;
  readonly writerGenerationFor: (experimentId: string) => string | undefined;
  readonly publicationCutoff: () => Effect.Effect<PublicationCutoff, unknown, ProjectStateDatabase>;
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  readonly adoptLatePublishedAttempt: (
    attempt: Attempt,
  ) => Effect.Effect<
    boolean,
    RecordReaderOpenError | RecordReaderReadError | ProjectTargetReusePlanInvalid | RunnerRecordWriteError,
    import("effect").Scope.Scope | import("../coordination/record-leases.ts").RecordCoordination | ProjectStateDatabase
  >;
  readonly reserveAttempt: (
    attempt: Attempt,
  ) => Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError, ProjectStateDatabase>;
  readonly noteSealedOrMarkIncomplete: (
    attempt: Attempt,
    sealed: SealedAttemptAssertions,
  ) => Effect.Effect<void, never>;
  readonly completeAttemptOrMarkIncomplete: (
    attempt: Attempt,
    result: EvalResult,
    attemptState?: AttemptState,
  ) => Effect.Effect<RunnerRecordAttempt | undefined, never, ProjectStateDatabase>;
  readonly markNotDispatched: (attempt: Attempt, reason: RunAbsenceReason) => void;
  readonly publish: (
    completedAt: number,
    mode: "normal" | "interrupted",
  ) => Effect.Effect<readonly RecordSealReceipt[], RunnerRecordWriteError, ProjectStateDatabase>;
}

/** Current preview preserves the read Scope and never creates a Run row. */
export function withRunnerCurrentReusePreview<A, E, R>(input: {
  readonly recordRoot: RecordRoot;
  readonly startedAt: number;
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly reuse: RunnerRecordReuseInput;
  readonly use: (preview: {
    readonly reusePlan: ExecutionReusePlan;
    readonly readReadbacks: () => Effect.Effect<
      readonly CurrentReuseReadback[],
      RecordReaderReadError | CurrentReuseReadbackPlanInvalid
    >;
  }) => Effect.Effect<A, E, R>;
}): Effect.Effect<
  A,
  E | RunnerRecordOpenError,
  | R
  | import("effect").Scope.Scope
  | import("../coordination/record-leases.ts").RecordCoordination
  | ProjectStateDatabase
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const startedAt = runnerRecordUtcMillis(input.startedAt);
      if (Result.isFailure(startedAt)) return yield* Effect.fail(startedAt.failure);
      const planned = yield* Effect.forEach(
        input.runs,
        (run) =>
          planRunnerRecordRun({
            run,
            evals: input.evals,
            reuse: input.reuse,
          }),
        { concurrency: 1 },
      );
      const previewRuns: TargetRun[] = [];
      for (const plan of planned) {
        const runId = previewRunnerRunId(plan.run);
        if (Result.isFailure(runId)) return yield* Effect.fail(runId.failure);
        previewRuns.push(
          targetForRunnerRecordRun({ planned: plan, runId: runId.success, startedAt: startedAt.success }),
        );
      }
      const target = {
        invocationId: `preview-${createHash("sha256").update(String(input.startedAt), "utf8").digest("hex")}`,
        runs: previewRuns,
      };
      const rootPath = recordRootPaths(input.recordRoot)?.portableRoot;
      if (rootPath === undefined) return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
      const recordDatabase = recordSqlitePath(rootPath);
      if (!existsSync(recordDatabase)) {
        const reusePlan = yield* planProjectTargetReuseWithoutSources({ target, policy: input.reuse.policy });
        return yield* input.use({
          reusePlan,
          readReadbacks: () => Effect.succeed([]),
        });
      }
      const { reusePlan, readbacks } = yield* Effect.scoped(
        Effect.gen(function* () {
          const reader = yield* recordHost.openRead({ root: input.recordRoot });
          const reusePlan = yield* planProjectTargetReuse({ reader, target, policy: input.reuse.policy });
          const readbacks = yield* readCurrentExecutionReusePlanReadbacks({ reader, plan: reusePlan }).pipe(
            Effect.mapError((cause): RunnerSessionOpenFailed => ({ code: "runner-session-open-failed", cause })),
          );
          return { reusePlan, readbacks };
        }),
      );
      return yield* input.use({
        reusePlan,
        readReadbacks: () => Effect.succeed(readbacks),
      });
    }),
  );
}

function attemptInvalid(): RunnerRecordAttemptInvalid {
  return { code: "runner-record-attempt-invalid" as const };
}

function unsealedAttempt(slotId: SlotId): RunnerRecordUnsealedAttempt {
  return { code: "runner-record-attempt-unsealed" as const, slotId };
}

function membershipStateInvalid(slotId: SlotId): RunnerRecordMembershipStateInvalid {
  return { code: "runner-record-membership-state-invalid" as const, slotId };
}

function* executionTracePublicationBatches<Row>(rows: Iterable<Row>): Generator<readonly Row[]> {
  let batch: Row[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (batch.length > 0 && (batch.length >= 64 || bytes + size > 256 * 1024)) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += size;
  }
  if (batch.length > 0) yield batch;
}

function attemptPublicationFailed(
  locator: AttemptLocator,
  cause: RunnerRecordWriteError | RunStorageCommandError,
): RunnerRecordAttemptPublicationFailed {
  const detail = "message" in cause ? cause.message : cause.code;
  return {
    code: "runner-record-attempt-publication-failed" as const,
    locator,
    cause,
    message: `Attempt publication failed for ${locator}: ${detail}`,
  };
}

function publishStateInvalid(runId: RunId): RunnerRecordPublishStateInvalid {
  return { code: "runner-record-publish-state-invalid" as const, runId };
}

/**
 * Opens one new per-Experiment Run session, selects only sealed historical
 * Runs, and writes carry references before dispatch. No global Record writer
 * lock or superseded draft/attachment contract participates in this boundary.
 */
export function openRunnerRecordCoordinator<E>(input: {
  readonly recordRoot: RecordRoot;
  readonly startedAt: number;
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly reuse: RunnerRecordReuseInput;
  readonly session: SessionTracker | undefined;
  readonly preflight: (plan: ExecutionReusePlan) => Effect.Effect<void, E>;
}): Effect.Effect<
  RunnerRecordCoordinator,
  RunnerRecordOpenError | E,
  | import("effect").Scope.Scope
  | import("../record/platform/services.ts").RecordEntropy
  | import("../coordination/record-leases.ts").RecordCoordination
  | ProjectStateDatabase
> {
  return Effect.gen(function* () {
    const rootPath = recordRootPaths(input.recordRoot)?.portableRoot;
    if (rootPath === undefined) return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
    const seenExperiments = new Set<string>();
    for (const run of input.runs) {
      if (seenExperiments.has(run.experimentId)) {
        return yield* Effect.fail({
          code: "runner-record-target-identity-invalid" as const,
          kind: "invocation" as const,
          value: `duplicate experimentId ${JSON.stringify(run.experimentId)}`,
        });
      }
      seenExperiments.add(run.experimentId);
    }
    const startedAt = runnerRecordUtcMillis(input.startedAt);
    if (Result.isFailure(startedAt)) return yield* Effect.fail(startedAt.failure);
    const planned = yield* Effect.forEach(
      input.runs,
      (run) =>
        planRunnerRecordRun({
          run,
          evals: input.evals,
          reuse: input.reuse,
        }),
      { concurrency: 1 },
    );
    const invocationId =
      input.session?.sessionId ??
      createHash("sha256")
        .update(`${input.startedAt}\u0000${planned.map((entry) => entry.run.experimentId).join("\u0000")}`, "utf8")
        .digest("hex");
    const entropy = yield* RecordEntropy;
    const candidates = yield* Effect.forEach(planned, (plan) =>
      Effect.gen(function* () {
        const raw = yield* entropy.uuid;
        const decoded = Schema.decodeUnknownResult(RunIdSchema)(raw);
        if (Result.isFailure(decoded))
          return yield* Effect.fail({
            code: "runner-record-target-identity-invalid" as const,
            kind: "invocation" as const,
            value: raw,
          });
        return {
          plan,
          runId: decoded.success,
          target: targetForRunnerRecordRun({ planned: plan, runId: decoded.success, startedAt: startedAt.success }),
          writerGeneration: createRunWriterGeneration(`${invocationId}:${plan.experimentId}`),
        };
      }),
    );
    const target = { invocationId, runs: candidates.map((candidate) => candidate.target) };
    const { reusePlan, carriedResults } = yield* Effect.scoped(
      Effect.gen(function* () {
        if (!existsSync(recordSqlitePath(rootPath))) {
          const reusePlan = yield* planProjectTargetReuseWithoutSources({ target, policy: input.reuse.policy });
          return { reusePlan, carriedResults: [] };
        }
        const reader = yield* recordHost.openRead({ root: input.recordRoot });
        const reusePlan = yield* planProjectTargetReuse({ reader, target, policy: input.reuse.policy });
        const carriedResults = yield* readCurrentExecutionReusePlanResults({ reader, plan: reusePlan }).pipe(
          Effect.mapError((cause): RunnerSessionOpenFailed => ({ code: "runner-session-open-failed", cause })),
        );
        return { reusePlan, carriedResults };
      }),
    );
    yield* input.preflight(reusePlan);

    // Register the complete durable owner before admitting any mutable aggregate.
    // A concurrent portable gate must see this Invocation even during Run setup.
    if (input.session !== undefined) {
      const startedAtIso = new Date(input.startedAt).toISOString();
      yield* input.session
        .start({
          runIds: new Map(candidates.map(({ plan, runId }) => [plan.experimentId, String(runId)])),
          agentRuns: input.runs,
          startedAt: startedAtIso,
          invocationRuns: candidates.map(({ plan, runId, writerGeneration }) => ({
            runId: String(runId),
            experimentId: plan.experimentId,
            writerGeneration,
            startedAt: startedAtIso,
            expectedSlots: plan.expectedSlots.map((slot) => ({
              slotId: String(slot.slotId),
              evalId: String(slot.evalId),
              attemptOrdinal: slot.attemptOrdinal,
              executionIdentityDigest: String(slot.executionIdentityDigest),
            })),
          })),

          carriedAttemptsByKey: undefined,
          pid: undefined,
        })
        .pipe(
          Effect.mapError(
            (cause): RunnerSessionOpenFailed => ({
              code: "runner-session-open-failed",
              cause,
            }),
          ),
        );
    }
    const openedRuns = yield* Effect.forEach(
      candidates,
      ({ plan, runId, target, writerGeneration }) =>
        recordHost
          .createRun({
            root: input.recordRoot,
            runId,
            experimentId: plan.experimentId,
            context: plan.context,
            startedAt: startedAt.success,
            expectedSlots: plan.expectedSlots,
            writerGeneration,
          })
          .pipe(Effect.map((session) => ({ plan, session, target, writerGeneration }))),
      { concurrency: 1 },
    );
    const byRun = new Map<AgentRun, RunnerRecordRun>();
    const byRecordRunId = new Map<RunId, RunnerRecordRun>();
    const runIdsByExperiment = new Map<string, string>();
    for (const { plan, session, target, writerGeneration } of openedRuns) {
      // Run-owned presentation snapshot; it never enters identity, reuse or the source barrier.
      yield* session.attach(NiceEvalRecordAttachments.experimentPresentation, {
        experimentId: plan.experimentId,
        displayName: plan.run.displayName,
      });
      yield* session.attach(NiceEvalRecordAttachments.identityManifests, {
        entries: [
          ...new Map(
            plan.slotEntries.flatMap((entry) =>
              entry.reuse.identityManifest === undefined
                ? []
                : [[entry.evalDef.id, entry.reuse.identityManifest] as const],
            ),
          ).values(),
        ].sort(function compareEvalIds(a, b) {
          if (a.evalId < b.evalId) return -1;
          if (a.evalId > b.evalId) return 1;
          return 0;
        }),
      });
      const recordRun: RunnerRecordRun = {
        ...plan,
        session,
        target,
        attempts: new Map(),
        planSlots: new Map(),
        gapActions: new Map(),
        absenceReasons: new Map(),
        writerGeneration,
      };
      byRun.set(plan.run, recordRun);
      byRecordRunId.set(session.runId, recordRun);
      runIdsByExperiment.set(plan.run.experimentId, session.runId);
    }
    const carriedAttemptsByKey = new Map<string, Set<number>>();
    for (const slot of reusePlan.slots) {
      const recordRun = byRecordRunId.get(slot.runId);
      if (recordRun === undefined) return yield* Effect.fail(membershipStateInvalid(slot.slotId));
      recordRun.planSlots.set(slot.slotId, slot);
      if (slot.state === "reuse") {
        yield* stagePlanningReference(recordRun.session, {
          slotId: slot.slotId,
          action: "carried",
          reference: slot.source.reference,
        });
        yield* bindAttemptReference(rootPath, {
          runId: String(recordRun.session.runId),
          writerGeneration: recordRun.writerGeneration,
          slotId: String(slot.slotId),
          action: "carried",
          publicationIdentity: slot.source.reference.publicationIdentity,
          deadlineEpochMs: Date.now() + 30_000,
        }).pipe(Effect.mapError((cause): RunnerSessionOpenFailed => ({ code: "runner-session-open-failed", cause })));
        const entry = recordRun.slots.get(runnerRecordSlotKey(slot.evalId, slot.attempt));
        if (entry === undefined) return yield* Effect.fail(membershipStateInvalid(slot.slotId));
        const key = cacheKey(recordRun.run, entry.evalDef.id);
        const carried = carriedAttemptsByKey.get(key) ?? new Set<number>();
        carried.add(entry.attempt);
        carriedAttemptsByKey.set(key, carried);
      } else {
        recordRun.gapActions.set(slot.slotId, "pending");
      }
    }
    if (input.session !== undefined) {
      yield* input.session.applyCarriedAttempts(input.runs, carriedAttemptsByKey).pipe(
        Effect.mapError(
          (cause): RunnerSessionOpenFailed => ({
            code: "runner-session-open-failed",
            cause,
          }),
        ),
      );
    }

    let invocationWriteFailure: RunnerRecordWriteError | undefined;
    const writeFailuresByRun = new Map<RunnerRecordRun, RunnerRecordWriteError>();
    const noteFailure = (error: RunnerRecordWriteError, recordRun?: RunnerRecordRun): void => {
      if (recordRun === undefined) {
        if (invocationWriteFailure === undefined) invocationWriteFailure = error;
        return;
      }
      if (!writeFailuresByRun.has(recordRun)) writeFailuresByRun.set(recordRun, error);
    };
    const lock = yield* Semaphore.make(1);
    const runForAttempt = (attempt: Attempt): RunnerRecordRun | undefined => byRun.get(attempt.run);
    const targetForAttempt = (
      attempt: Attempt,
    ):
      | {
          readonly recordRun: RunnerRecordRun;
          readonly slotId: SlotId;
          readonly plan: ExecutionReusePlanSlot;
        }
      | undefined => {
      const recordRun = runForAttempt(attempt);
      if (recordRun === undefined) return undefined;
      const entry = recordRun.slots.get(runnerRecordSlotKey(attempt.evalDef.id, attempt.attempt));
      if (entry === undefined) return undefined;
      const plan = recordRun.planSlots.get(entry.slot.slotId);
      return plan === undefined ? undefined : { recordRun, slotId: entry.slot.slotId, plan };
    };

    const adoptLatePublishedAttempt = (attempt: Attempt) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const current = targetForAttempt(attempt);
          if (
            current === undefined ||
            current.plan.state !== "gap" ||
            current.recordRun.gapActions.get(current.slotId) !== "pending"
          )
            return false;
          const refreshed = yield* Effect.scoped(
            Effect.gen(function* () {
              const freshReader = yield* recordHost.openRead({ root: input.recordRoot });
              return yield* planProjectTargetReuse({ reader: freshReader, target, policy: input.reuse.policy });
            }),
          );
          const replacement = refreshed.slots.find(
            (slot) => slot.runId === current.recordRun.target.runId && slot.slotId === current.slotId,
          );
          if (replacement?.state !== "reuse") return false;
          yield* stagePlanningReference(current.recordRun.session, {
            slotId: current.slotId,
            action: "carried",
            reference: replacement.source.reference,
          });
          yield* bindAttemptReference(rootPath, {
            runId: String(current.recordRun.session.runId),
            writerGeneration: current.recordRun.writerGeneration,
            slotId: String(current.slotId),
            action: "carried",
            publicationIdentity: replacement.source.reference.publicationIdentity,
            deadlineEpochMs: Date.now() + 30_000,
          }).pipe(Effect.mapError(() => publishStateInvalid(current.recordRun.session.runId)));
          current.recordRun.planSlots.set(current.slotId, replacement);
          current.recordRun.gapActions.delete(current.slotId);
          return true;
        }),
      );

    const reserveAttempt = (
      attempt: Attempt,
    ): Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError, ProjectStateDatabase> => {
      const targetSlot = targetForAttempt(attempt);
      return lock
        .withPermits(1)(
          Effect.gen(function* () {
            if (
              targetSlot === undefined ||
              targetSlot.plan.state !== "gap" ||
              targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "pending"
            ) {
              return yield* Effect.fail(attemptInvalid());
            }
            const session = yield* targetSlot.recordRun.session.createAttempt({ slotId: targetSlot.slotId });
            const publicAttempt = {
              slotId: targetSlot.slotId,
              attemptId: session.attemptId,
              locator: encodeAttemptLocator(session.attemptId),
            };
            targetSlot.recordRun.attempts.set(targetSlot.slotId, {
              attempt,
              session,
              public: publicAttempt,
              completed: false,

              sealed: undefined,
            });
            targetSlot.recordRun.gapActions.set(targetSlot.slotId, "reserved");
            return publicAttempt;
          }),
        )
        .pipe(
          Effect.tapError((error) =>
            Effect.sync(() => noteFailure(error, targetSlot?.recordRun ?? runForAttempt(attempt))),
          ),
        );
    };

    const noteSealedOrMarkIncomplete = (
      attempt: Attempt,
      sealed: SealedAttemptAssertions,
    ): Effect.Effect<void, never> =>
      Effect.sync(() => {
        const targetSlot = targetForAttempt(attempt);
        const active = targetSlot === undefined ? undefined : targetSlot.recordRun.attempts.get(targetSlot.slotId);
        if (
          targetSlot === undefined ||
          targetSlot.plan.state !== "gap" ||
          targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "reserved" ||
          active === undefined ||
          active.attempt !== attempt ||
          active.sealed !== undefined
        ) {
          noteFailure(attemptInvalid(), targetSlot?.recordRun ?? runForAttempt(attempt));
          return;
        }
        active.sealed = sealed;
      });

    const completeAttempt = (
      attempt: Attempt,
      result: EvalResult,
      attemptState?: AttemptState,
    ): Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError, ProjectStateDatabase> =>
      Effect.suspend<RunnerRecordAttempt, RunnerRecordWriteError, ProjectStateDatabase>(() => {
        const targetSlot = targetForAttempt(attempt);
        const active = targetSlot === undefined ? undefined : targetSlot.recordRun.attempts.get(targetSlot.slotId);
        if (
          targetSlot === undefined ||
          targetSlot.plan.state !== "gap" ||
          targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "reserved" ||
          active === undefined ||
          active.attempt !== attempt ||
          active.completed
        ) {
          return Effect.fail(attemptInvalid());
        }
        const assertions = active.sealed === undefined ? undefined : createRunnerAssertionsAttachment(active.sealed);
        if (assertions !== undefined && Result.isFailure(assertions)) return Effect.fail(assertions.failure);
        if (active.sealed === undefined || assertions === undefined || Result.isFailure(assertions)) {
          return Effect.fail(membershipStateInvalid(targetSlot.slotId));
        }
        return Effect.gen(function* () {
          const sourcePlan = createRunnerSourceWritePlan([
            {
              slotId: targetSlot.slotId,
              result,
              assertionEntryIds: assertions.success.entryIds,
            },
          ]);
          if (Result.isFailure(sourcePlan)) {
            return yield* Effect.fail({
              code: "runner-record-sources-invalid" as const,
              issue: sourcePlan.failure,
            });
          }
          yield* appendRunSourcesBeforeAttempt(
            targetSlot.recordRun.session,
            active.session,
            sourcePlan.success.sources,
          );
          const sourceSites = sourcePlan.success.sourceSitesBySlot.get(targetSlot.slotId);
          const closedAssertions = createRunnerAssertionsAttachment(active.sealed!, {
            entryIds: assertions.success.entryIds,
            sourceSites,
          });
          if (Result.isFailure(closedAssertions)) return yield* Effect.fail(closedAssertions.failure);
          yield* active.session.records.write(
            NiceEvalRecordAttachments.assertions,
            closedAssertions.success.attachment,
          );
          yield* active.session.records.write(
            NiceEvalRecordAttachments.attemptCost,
            createAttemptCostAttachment(result),
          );
          const sourceReceipts = yield* createAttemptObservabilityAttachments({
            result,
            sealed: active.sealed!,
            entryIds: closedAssertions.success.entryIds,
          });
          const observability = attemptObservabilityPublication();
          if (sourceReceipts.agentTurns !== undefined) {
            yield* observability.write(
              active.session.records.write(NiceEvalRecordAttachments.agentTurns, sourceReceipts.agentTurns),
            );
          }
          if (sourceReceipts.sandboxCommands !== undefined) {
            yield* observability.write(
              active.session.records.write(NiceEvalRecordAttachments.sandboxCommands, sourceReceipts.sandboxCommands),
            );
          }
          yield* observability.write(
            active.session.records.write(
              NiceEvalRecordAttachments.runnerActivities.attempt,
              sourceReceipts.runnerActivities,
            ),
          );
          const turnContexts = createRunnerTurnContextsAttachment({ result, sourcePlan: sourcePlan.success });
          if (Result.isFailure(turnContexts)) {
            return yield* Effect.fail({
              code: "runner-record-sources-invalid" as const,
              issue: turnContexts.failure,
            });
          }
          if (turnContexts.success !== undefined) {
            yield* observability.write(
              active.session.records.write(NiceEvalRecordAttachments.turnContexts, turnContexts.success),
            );
          }
          const fileChanges = createAttemptFileChangesAttachment(result);
          if (fileChanges !== undefined) {
            yield* active.session.records.write(NiceEvalRecordAttachments.fileChanges, fileChanges);
          }
          const attachmentSnapshot = adapterAttachmentsForResult(result);
          const artifacts = createAttemptArtifactsAttachment(result, attachmentSnapshot);
          const judgeUsage = judgeUsageForResult(result, closedAssertions.success.entryIds);
          if (judgeUsage !== undefined)
            yield* active.session.records.write(NiceEvalRecordAttachments.judgeUsage, judgeUsage);
          yield* active.session.records.write(NiceEvalRecordAttachments.attemptNotes, attemptNotesForResult(result));
          const agentInstall = agentInstallFactsForResult(result);
          if (agentInstall !== undefined) {
            yield* observability.write(
              active.session.records.write(NiceEvalRecordAttachments.agentInstall, agentInstall),
            );
          }
          const adapterUsage = adapterUsageForResult(result);
          const executionTraces = adapterExecutionTracesForResult(result);
          if (executionTraces?.storageFailure !== undefined) {
            return yield* Effect.fail(attemptPublicationFailed(active.public.locator, executionTraces.storageFailure));
          }
          if (adapterUsage !== undefined) {
            yield* observability.write(
              active.session.records.write(NiceEvalRecordAttachments.adapterUsage, adapterUsage),
            );
          }
          if (artifacts !== undefined) {
            yield* active.session.records.write(NiceEvalRecordAttachments.artifacts.attempt, artifacts);
          }
          if (executionTraces !== undefined && executionTraces.traces.length > 0) {
            validateExecutionTracePublication(executionTraces, attachmentSnapshot?.artifacts ?? []);
            const { traces, failure } = executionTraces;
            yield* Effect.acquireUseRelease(
              Effect.sync(() => new ExecutionTraceIndexProjection()),
              (projection) =>
                Effect.gen(function* () {
                  function* facts(): Generator<ExecutionTraceStoredRecord> {
                    let ordinal = 0;
                    for (const trace of traces) {
                      for (const record of trace.records) {
                        projection.add(record, ordinal++);
                        yield record;
                      }
                    }
                  }
                  yield* Stream.runForEach(
                    Stream.fromIterable(executionTracePublicationBatches(facts()), { chunkSize: 1 }),
                    (batch) =>
                      active.session.records.appendAll(executionTracesRecordCollection, Stream.fromIterable(batch)),
                  );
                  yield* active.session.records.close(
                    executionTracesRecordCollection,
                    failure === undefined
                      ? { state: "complete" }
                      : { state: "partial", limitations: [{ code: "capture-failed", stage: "adapter" }] },
                  );
                  projection.finish();
                  yield* Stream.runForEach(
                    Stream.fromIterable(executionTracePublicationBatches(projection.rows()), { chunkSize: 1 }),
                    (batch) =>
                      active.session.records.appendAll(executionTraceIndexRecordCollection, Stream.fromIterable(batch)),
                  );
                  yield* active.session.records.close(executionTraceIndexRecordCollection, { state: "complete" });
                }),
              (projection) =>
                Effect.sync(() => {
                  projection.close();
                  for (const trace of traces) if (trace.mode === "stream") trace.staging.close();
                }),
            );
          }
          const diagnosticFailures = observability.failureCount;
          yield* observability.write(
            active.session.records.write(NiceEvalRecordAttachments.runnerDiagnostics.attempt, (build) =>
              observability.diagnostics(sourceReceipts.runnerDiagnostics(build)),
            ),
          );
          if (observability.failureCount > diagnosticFailures) {
            // If the diagnostic attachment itself failed, publish the bounded
            // encoding diagnostics alone rather than losing the Attempt.
            yield* active.session.records.write(
              NiceEvalRecordAttachments.runnerDiagnostics.attempt,
              observability.diagnostics(),
            );
          }
          // Once completion can close the writer, finish publishing and settle the
          // reservation before interruption can send it to the discard path.
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* active.session.complete(recordAttemptCompletion(result));
              const closureBytes = new TextEncoder().encode(
                JSON.stringify(
                  attemptPublicationClosure({
                    runId: String(targetSlot.recordRun.session.runId),
                    experimentId: targetSlot.recordRun.experimentId,
                    context: targetSlot.recordRun.context,
                    startedAt: targetSlot.recordRun.target.startedAt,
                    completedAt: Date.now(),
                    expectedSlots: targetSlot.recordRun.expectedSlots,
                  }),
                ),
              );
              yield* publishOriginAttempt(rootPath, {
                runId: String(targetSlot.recordRun.session.runId),
                writerGeneration: targetSlot.recordRun.writerGeneration,
                slotId: String(targetSlot.slotId),
                attemptId: String(active.public.attemptId),
                attemptLocator: String(active.public.locator),
                closureBytes,
                closureDigest: createHash("sha256").update(closureBytes).digest("hex"),
                attemptState,
                deadlineEpochMs: Date.now() + 30_000,
              }).pipe(Effect.mapError((cause) => attemptPublicationFailed(active.public.locator, cause)));
              active.sealed = undefined;
              active.completed = true;
              targetSlot.recordRun.gapActions.set(targetSlot.slotId, "executed");
              targetSlot.recordRun.attempts.delete(targetSlot.slotId);
              return active.public;
            }),
          );
        });
      });

    const attachRunFacts = (
      recordRun: RunnerRecordRun,
      _mode: "normal" | "interrupted",
    ): Effect.Effect<void, RunnerRecordWriteError> =>
      Effect.gen(function* () {
        const writeRecord = (
          effect: Effect.Effect<void, RecordWriteError, never>,
        ): Effect.Effect<void, RecordWriteError, never> => effect;

        const sourceReceipts = yield* createRunObservabilityAttachments(recordRun.run);
        if (sourceReceipts.runnerActivities !== undefined) {
          yield* writeRecord(
            recordRun.session.records.write(
              NiceEvalRecordAttachments.runnerActivities.run,
              sourceReceipts.runnerActivities,
            ),
          );
        }
        if (sourceReceipts.runnerDiagnostics !== undefined) {
          yield* writeRecord(
            recordRun.session.records.write(
              NiceEvalRecordAttachments.runnerDiagnostics.run,
              sourceReceipts.runnerDiagnostics,
            ),
          );
        }
        yield* writeRecord(
          recordRun.session.records.write(NiceEvalRecordAttachments.artifacts.run, createRunArtifactsAttachment()),
        );
      });

    const pendingGap = (recordRun: RunnerRecordRun): SlotId | undefined => {
      for (const [slotId, state] of recordRun.gapActions) {
        if (state === "pending") return slotId;
      }
      return undefined;
    };

    return {
      reusePlan,
      readCarriedResults: () => Effect.succeed(carriedResults),
      runIdsByExperiment: new Map(runIdsByExperiment),
      writerGenerationFor: (experimentId) =>
        openedRuns.find(({ plan }) => plan.run.experimentId === experimentId)?.writerGeneration,
      publicationCutoff: () => currentPublicationCutoff(rootPath),
      carriedAttemptsByKey: new Map(
        [...carriedAttemptsByKey].map(([key, attempts]) => [key, new Set(attempts)] as const),
      ),
      adoptLatePublishedAttempt,
      reserveAttempt,
      noteSealedOrMarkIncomplete,
      completeAttemptOrMarkIncomplete: (attempt: Attempt, result: EvalResult, attemptState?: AttemptState) =>
        completeAttempt(attempt, result, attemptState).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              const target = targetForAttempt(attempt);
              const active = target === undefined ? undefined : target.recordRun.attempts.get(target.slotId);
              noteFailure(
                error.code === "runner-record-assertions-invalid" ||
                  error.code === "runner-record-attempt-publication-failed" ||
                  active === undefined
                  ? error
                  : attemptPublicationFailed(active.public.locator, error),
                target?.recordRun ?? runForAttempt(attempt),
              );
              return undefined;
            }),
          ),
          Effect.ensuring(Effect.promise(() => releaseAdapterAttachments(result))),
        ),
      markNotDispatched: (attempt: Attempt, reason: RunAbsenceReason) => {
        const targetSlot = targetForAttempt(attempt);
        if (
          targetSlot !== undefined &&
          targetSlot.plan.state === "gap" &&
          targetSlot.recordRun.gapActions.get(targetSlot.slotId) === "pending"
        ) {
          targetSlot.recordRun.gapActions.set(targetSlot.slotId, "not-dispatched");
          targetSlot.recordRun.absenceReasons.set(targetSlot.slotId, reason);
        }
      },
      publish: (completedAt: number, mode: "normal" | "interrupted") =>
        Effect.gen(function* () {
          const recordRuns = [...byRun.values()];
          if (invocationWriteFailure !== undefined) return yield* Effect.fail(invocationWriteFailure);
          if (mode === "normal") {
            // A normal finish remains invocation-strict: a failure which can be
            // attributed to one Run still fails the call rather than allowing a
            // partial receipt to disguise it as ordinary completion.
            for (const recordRun of recordRuns) {
              const failure = writeFailuresByRun.get(recordRun);
              if (failure !== undefined) return yield* Effect.fail(failure);
            }
          }
          const completion = runnerRecordUtcMillis(completedAt);
          if (Result.isFailure(completion)) return yield* Effect.fail(completion.failure);

          // A controlled interruption closes every reserved Attempt as
          // `interrupted` and every never-started gap as an interrupted terminal
          // Member. Only a Run-local writer failure remains non-publishable.
          // Abrupt process loss still has no opportunity to create `complete`.
          const incompleteRuns =
            mode === "interrupted"
              ? new Set(recordRuns.filter((recordRun) => writeFailuresByRun.has(recordRun)))
              : new Set<RunnerRecordRun>();

          if (mode === "normal") {
            // Normal completion is deliberately invocation-strict. A pending
            // gap means the scheduler failed to account for a Slot; a reserved
            // or otherwise unsettled Attempt is likewise not publishable.
            for (const recordRun of recordRuns) {
              const unsettledSlot = [...recordRun.gapActions.keys()].find((slotId) => {
                const active = recordRun.attempts.get(slotId);
                return recordRun.gapActions.get(slotId) === "reserved" || (active !== undefined && !active.completed);
              });
              if (unsettledSlot !== undefined) return yield* Effect.fail(unsealedAttempt(unsettledSlot));
              const unaccountedSlot = pendingGap(recordRun);
              if (unaccountedSlot !== undefined) return yield* Effect.fail(unsealedAttempt(unaccountedSlot));
            }
          } else {
            for (const recordRun of recordRuns) {
              if (incompleteRuns.has(recordRun)) continue;
              for (const [slotId, state] of recordRun.gapActions) {
                if (state === "pending") recordRun.gapActions.set(slotId, "interrupted");
                if (state === "reserved") {
                  const active = recordRun.attempts.get(slotId);
                  if (active === undefined) return yield* Effect.fail(membershipStateInvalid(slotId));
                  yield* discardAttemptWriteSession(active.session);
                  recordRun.attempts.delete(slotId);
                  recordRun.gapActions.set(slotId, "interrupted");
                }
              }
            }
          }

          const publishableRuns = recordRuns.filter((recordRun) => !incompleteRuns.has(recordRun));
          const publishOne = (
            recordRun: RunnerRecordRun,
          ): Effect.Effect<RecordSealReceipt, RunnerRecordWriteError, ProjectStateDatabase> =>
            Effect.gen(function* () {
              yield* attachRunFacts(recordRun, mode);
              function gapAbsenceReason(slotId: SlotId, state: GapActionState): RunAbsenceReason {
                if (mode === "interrupted") return "interrupted-before-publication";
                if (state === "not-dispatched") return recordRun.absenceReasons.get(slotId) ?? "dispatch-failed";
                return "dispatch-failed";
              }
              for (const [slotId, state] of recordRun.gapActions) {
                if (state === "not-dispatched" || state === "interrupted") {
                  const absenceReason = gapAbsenceReason(slotId, state);
                  yield* recordRun.session.recordTerminalMember({ slotId, action: state, absenceReason });
                }
              }
              const sealed = yield* recordRun.session.seal({ completedAt: completion.success });
              const absences = [...recordRun.gapActions].flatMap(([slotId, state]) => {
                if (state === "executed") return [];
                const reason = gapAbsenceReason(slotId, state);
                return [{ slotId: String(slotId), reason }];
              });
              yield* closeRunResource(rootPath, {
                runId: String(recordRun.session.runId),
                writerGeneration: recordRun.writerGeneration,
                state: mode === "interrupted" ? "interrupted" : "completed",
                completedAt: new Date(completedAt).toISOString(),
                absences,
                deadlineEpochMs: Date.now() + 30_000,
              }).pipe(Effect.mapError(() => publishStateInvalid(recordRun.session.runId)));
              return sealed;
            });

          if (mode === "normal") {
            // Normal completion remains typed and strict: the first Run failure
            // is an invocation failure, never a partial success receipt.
            return yield* Effect.forEach(publishableRuns, publishOne, { concurrency: 1 });
          }

          // SIGINT is different: each clean sibling receives its own complete
          // attempt. We deliberately observe an Exit per Run so one Attachment
          // or seal error cannot short-circuit subsequent safe siblings.
          const receipts: RecordSealReceipt[] = [];
          for (const recordRun of publishableRuns) {
            const exit = yield* Effect.exit(publishOne(recordRun));
            if (Exit.isSuccess(exit)) {
              receipts.push(exit.value);
            } else {
              const failure = Cause.findErrorOption(exit.cause);
              if (Option.isSome(failure)) {
                noteFailure(failure.value, recordRun);
              } else {
                noteFailure(publishStateInvalid(recordRun.session.runId), recordRun);
              }
            }
          }
          return receipts;
        }),
    };
  });
}
