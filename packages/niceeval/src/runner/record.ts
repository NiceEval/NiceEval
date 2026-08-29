import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { Cause, Effect, Result, Exit, Option, Semaphore } from "effect";

import { encodeAttemptLocator, type AttemptLocator } from "../attempt-locator.ts";
import type { SealedAttemptAssertions } from "../assertions/api.ts";
import type { AssertionsProducerError } from "../assertions/record/producer.ts";
import { NiceEvalRecordAttachments } from "../record/family/catalog.ts";
import { recordHost } from "../record/host/runtime.ts";
import { discardAttemptWriteSession, stagingDatabasePathForRunSession } from "../record/host/sqlite-host.ts";
import type {
  AttemptWriteSession,
  RecordSealReceipt,
  RunWriteSession,
} from "../record/host/types.ts";
import type {
  RunId,
  SlotId,
} from "../record/model/identifiers.ts";
import type { AssertionEntryId } from "../assertions/identity.ts";
import { recordRootPaths, type RecordRoot } from "../record/platform/root.ts";
import { attemptPublicationClosure } from "../record/codec/core.ts";
import { RecordRootInvalid } from "../record/platform/errors.ts";
import { recordSqlitePath } from "../record/sqlite/index.ts";
import type {
  RecordReaderOpenError,
  RecordReaderReadError,
} from "../record/reader/errors.ts";
import type { RecordWriteError } from "../record/writer/types.ts";
import {
  bindAttemptReference,
  closeRunResource,
  createRunResource,
  createRunWriterGeneration,
  currentPublicationCutoff,
  publishOriginAttempt,
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
  recordAttemptOutcome,
} from "./record/attachments.ts";
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
import type {
  AgentRun,
  Attempt,
  DiscoveredEval,
  EvalResult,
} from "./types.ts";
import type { AttemptCostAttachment } from "../record/family/attempt-cost/definition.ts";
import { getPricingEstimateReceipt } from "./pricing-estimate-receipt.ts";

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
  sealed?: SealedAttemptAssertions;
  result?: EvalResult;
  assertionEntryIds?: readonly AssertionEntryId[];
  completed: boolean;
}

interface RunnerRecordRun extends PlannedRunnerRecordRun {
  readonly session: RunWriteSession;
  readonly target: TargetRun;
  readonly attempts: Map<SlotId, ActiveRunnerRecordAttempt>;
  readonly planSlots: Map<SlotId, ExecutionReusePlanSlot>;
  readonly gapActions: Map<SlotId, GapActionState>;
  readonly stagingDatabasePath: string;
}

export interface RunnerRecordAttempt {
  readonly slotId: SlotId;
  readonly attemptId: import("../record/model/identifiers.ts").AttemptId;
  readonly locator: AttemptLocator;
}

export type RecordAttemptLocator = AttemptLocator;

function createAttemptCostAttachment(result: EvalResult): AttemptCostAttachment {
  const receipt = getPricingEstimateReceipt(result);
  return Object.freeze({
    ...(result.usage?.costUSD === undefined ? {} : {
      observed: Object.freeze({ kind: "observed" as const, amountUSD: result.usage.costUSD }),
    }),
    ...(receipt === undefined ? {} : {
      estimated: Object.freeze({
        kind: "estimated" as const,
        amountUSD: receipt.amountUSD,
        model: receipt.model,
        priceSource: receipt.priceSource,
        charges: receipt.charges,
      }),
    }),
  });
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
  | RunnerRecordMembershipStateInvalid;

export interface RunnerRecordCoordinator {
  readonly reusePlan: ExecutionReusePlan;
  readonly readCarriedResults: () => Effect.Effect<
    readonly CurrentReusedAttemptReadback[],
    RecordReaderReadError | CurrentReuseReadbackPlanInvalid
  >;
  readonly runIdsByExperiment: ReadonlyMap<string, string>;
  readonly publicationCutoff: () => PublicationCutoff;
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  readonly adoptLatePublishedAttempt: (
    attempt: Attempt,
  ) => Effect.Effect<
    boolean,
    RecordReaderOpenError | RecordReaderReadError | ProjectTargetReusePlanInvalid | RunnerRecordWriteError,
    import("effect").Scope.Scope
      | import("../coordination/record-leases.ts").RecordCoordination
  >;
  readonly reserveAttempt: (
    attempt: Attempt,
  ) => Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError>;
  readonly noteSealedOrMarkIncomplete: (
    attempt: Attempt,
    sealed: SealedAttemptAssertions,
  ) => Effect.Effect<void, never>;
  readonly completeAttemptOrMarkIncomplete: (
    attempt: Attempt,
    result: EvalResult,
  ) => Effect.Effect<RunnerRecordAttempt | undefined, never>;
  readonly markNotDispatched: (attempt: Attempt) => void;
  readonly publish: (
    completedAt: number,
    mode: "normal" | "interrupted",
  ) => Effect.Effect<readonly RecordSealReceipt[], RunnerRecordWriteError>;
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
}): Effect.Effect<A, E | RunnerRecordOpenError, R | import("effect").Scope.Scope | import("../coordination/record-leases.ts").RecordCoordination> {
  return Effect.scoped(Effect.gen(function* () {
    const startedAt = runnerRecordUtcMillis(input.startedAt);
    if (Result.isFailure(startedAt)) return yield* Effect.fail(startedAt.failure);
    const planned = yield* Effect.forEach(input.runs, (run) => planRunnerRecordRun({
      run,
      evals: input.evals,
      reuse: input.reuse,
    }), { concurrency: 1 });
    const previewRuns: TargetRun[] = [];
    for (const plan of planned) {
      const runId = previewRunnerRunId(plan.run);
      if (Result.isFailure(runId)) return yield* Effect.fail(runId.failure);
      previewRuns.push(targetForRunnerRecordRun({ planned: plan, runId: runId.success, startedAt: startedAt.success }));
    }
    const target = Object.freeze({
      invocationId: `preview-${createHash("sha256").update(String(input.startedAt), "utf8").digest("hex")}`,
      runs: Object.freeze(previewRuns),
    });
    const rootPath = recordRootPaths(input.recordRoot)?.portableRoot;
    if (rootPath === undefined) return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
    const recordDatabase = recordSqlitePath(rootPath);
    if (!existsSync(recordDatabase)) {
      const reusePlan = yield* planProjectTargetReuseWithoutSources({ target, policy: input.reuse.policy });
      return yield* input.use({
        reusePlan,
        readReadbacks: () => Effect.succeed(Object.freeze([])),
      });
    }
    const reader = yield* recordHost.openRead({ root: input.recordRoot });
    const reusePlan = yield* planProjectTargetReuse({ reader, target, policy: input.reuse.policy });
    return yield* input.use({
      reusePlan,
      readReadbacks: () => readCurrentExecutionReusePlanReadbacks({ reader, plan: reusePlan }),
    });
  }));
}

function attemptInvalid(): RunnerRecordAttemptInvalid {
  return Object.freeze({ code: "runner-record-attempt-invalid" as const });
}

function unsealedAttempt(slotId: SlotId): RunnerRecordUnsealedAttempt {
  return Object.freeze({ code: "runner-record-attempt-unsealed" as const, slotId });
}

function membershipStateInvalid(slotId: SlotId): RunnerRecordMembershipStateInvalid {
  return Object.freeze({ code: "runner-record-membership-state-invalid" as const, slotId });
}

function publishStateInvalid(runId: RunId): RunnerRecordPublishStateInvalid {
  return Object.freeze({ code: "runner-record-publish-state-invalid" as const, runId });
}

/**
 * Opens one new per-Experiment Run session, selects only sealed historical
 * Runs, and writes carry references before dispatch. No global Record writer
 * lock or superseded draft/attachment contract participates in this boundary.
 */
export function openRunnerRecordCoordinator(input: {
  readonly recordRoot: RecordRoot;
  readonly startedAt: number;
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly reuse: RunnerRecordReuseInput;
}): Effect.Effect<
  RunnerRecordCoordinator,
  RunnerRecordOpenError,
  import("effect").Scope.Scope
    | import("../record/platform/services.ts").RecordEntropy
    | import("../coordination/record-leases.ts").RecordCoordination
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
    const planned = yield* Effect.forEach(input.runs, (run) => planRunnerRecordRun({
      run,
      evals: input.evals,
      reuse: input.reuse,
    }), { concurrency: 1 });
    const invocationId = createHash("sha256")
      .update(`${input.startedAt}\u0000${planned.map((entry) => entry.run.experimentId).join("\u0000")}`, "utf8")
      .digest("hex");
    const writerGeneration = createRunWriterGeneration(invocationId);
    const openedRuns = yield* Effect.forEach(planned, (plan) => recordHost.createRun({
      root: input.recordRoot,
      experimentId: plan.experimentId,
      context: plan.context,
      startedAt: startedAt.success,
      expectedSlots: plan.expectedSlots,
    }).pipe(Effect.map((session) => {
      createRunResource(rootPath, {
        runId: String(session.runId),
        invocationId,
        experimentId: plan.experimentId,
        writerGeneration,
        startedAt: new Date(input.startedAt).toISOString(),
        expectedSlots: plan.expectedSlots.map((slot) => ({
          slotId: String(slot.slotId),
          evalId: String(slot.evalId),
          attemptOrdinal: slot.attemptOrdinal,
          executionIdentityDigest: String(slot.executionIdentityDigest),
        })),
        deadlineEpochMs: Date.now() + 30_000,
      });
      return Object.freeze({ plan, session });
    })), { concurrency: 1 });
    const reader = yield* recordHost.openRead({ root: input.recordRoot });

    const byRun = new Map<AgentRun, RunnerRecordRun>();
    const byRecordRunId = new Map<RunId, RunnerRecordRun>();
    const runIdsByExperiment = new Map<string, string>();
    const targetRuns: TargetRun[] = [];
    for (const { plan, session } of openedRuns) {
      const target = targetForRunnerRecordRun({
        planned: plan,
        runId: session.runId,
        startedAt: startedAt.success,
      });
      const recordRun: RunnerRecordRun = {
        ...plan,
        session,
        target,
        attempts: new Map(),
        planSlots: new Map(),
        gapActions: new Map(),
        stagingDatabasePath: stagingDatabasePathForRunSession(session)!,
      };
      byRun.set(plan.run, recordRun);
      byRecordRunId.set(session.runId, recordRun);
      runIdsByExperiment.set(plan.run.experimentId, session.runId);
      targetRuns.push(target);
    }
    const target = Object.freeze({
      invocationId,
      runs: Object.freeze(targetRuns),
    });
    const reusePlan = yield* planProjectTargetReuse({ reader, target, policy: input.reuse.policy });
    const carriedAttemptsByKey = new Map<string, Set<number>>();
    for (const slot of reusePlan.slots) {
      const recordRun = byRecordRunId.get(slot.runId);
      if (recordRun === undefined) return yield* Effect.fail(membershipStateInvalid(slot.slotId));
      recordRun.planSlots.set(slot.slotId, slot);
      if (slot.state === "reuse") {
        yield* recordRun.session.referenceAttempt({
          slotId: slot.slotId,
          action: "carried",
          attempt: slot.source.attempt,
        });
        bindAttemptReference(rootPath, {
            runId: String(recordRun.session.runId),
            writerGeneration,
            slotId: String(slot.slotId),
            action: "carried",
            publicationIdentity: slot.source.attempt.publicationIdentity,
            deadlineEpochMs: Date.now() + 30_000,
          });
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
    const targetForAttempt = (attempt: Attempt): {
      readonly recordRun: RunnerRecordRun;
      readonly slotId: SlotId;
      readonly plan: ExecutionReusePlanSlot;
    } | undefined => {
      const recordRun = runForAttempt(attempt);
      if (recordRun === undefined) return undefined;
      const entry = recordRun.slots.get(
        runnerRecordSlotKey(attempt.evalDef.id, attempt.attempt),
      );
      if (entry === undefined) return undefined;
      const plan = recordRun.planSlots.get(entry.slot.slotId);
      return plan === undefined ? undefined : { recordRun, slotId: entry.slot.slotId, plan };
    };

    const adoptLatePublishedAttempt = (attempt: Attempt) => lock.withPermits(1)(Effect.gen(function* () {
      const current = targetForAttempt(attempt);
      if (
        current === undefined
        || current.plan.state !== "gap"
        || current.recordRun.gapActions.get(current.slotId) !== "pending"
      ) return false;
      const freshReader = yield* recordHost.openRead({ root: input.recordRoot });
      const refreshed = yield* planProjectTargetReuse({
        reader: freshReader,
        target,
        policy: input.reuse.policy,
      });
      const replacement = refreshed.slots.find((slot) =>
        slot.runId === current.recordRun.target.runId && slot.slotId === current.slotId);
      if (replacement?.state !== "reuse") return false;
        yield* current.recordRun.session.referenceAttempt({
        slotId: current.slotId,
        action: "carried",
          attempt: replacement.source.attempt,
        });
      bindAttemptReference(rootPath, {
          runId: String(current.recordRun.session.runId),
          writerGeneration,
          slotId: String(current.slotId),
          action: "carried",
          publicationIdentity: replacement.source.attempt.publicationIdentity,
          deadlineEpochMs: Date.now() + 30_000,
        });
      current.recordRun.planSlots.set(current.slotId, replacement);
      current.recordRun.gapActions.delete(current.slotId);
      return true;
    }));

    const reserveAttempt = (attempt: Attempt): Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError> => {
      const targetSlot = targetForAttempt(attempt);
      return lock.withPermits(1)(Effect.gen(function* () {
        if (
          targetSlot === undefined
          || targetSlot.plan.state !== "gap"
          || targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "pending"
        ) {
          return yield* Effect.fail(attemptInvalid());
        }
        const session = yield* targetSlot.recordRun.session.createAttempt({ slotId: targetSlot.slotId });
        const publicAttempt = Object.freeze({
          slotId: targetSlot.slotId,
          attemptId: session.attemptId,
          locator: encodeAttemptLocator(session.attemptId),
        });
        targetSlot.recordRun.attempts.set(targetSlot.slotId, {
          attempt,
          session,
          public: publicAttempt,
          completed: false,
        });
        targetSlot.recordRun.gapActions.set(targetSlot.slotId, "reserved");
        return publicAttempt;
      })).pipe(Effect.tapError((error) =>
        Effect.sync(() => noteFailure(error, targetSlot?.recordRun ?? runForAttempt(attempt))),
      ));
    };

    const noteSealedOrMarkIncomplete = (
      attempt: Attempt,
      sealed: SealedAttemptAssertions,
    ): Effect.Effect<void, never> => Effect.sync(() => {
      const targetSlot = targetForAttempt(attempt);
      const active = targetSlot === undefined
        ? undefined
        : targetSlot.recordRun.attempts.get(targetSlot.slotId);
      if (
        targetSlot === undefined
        || targetSlot.plan.state !== "gap"
        || targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "reserved"
        || active === undefined
        || active.attempt !== attempt
        || active.sealed !== undefined
      ) {
        noteFailure(attemptInvalid(), targetSlot?.recordRun ?? runForAttempt(attempt));
        return;
      }
      active.sealed = sealed;
    });

    const completeAttempt = (
      attempt: Attempt,
      result: EvalResult,
    ): Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError> => Effect.suspend<
      RunnerRecordAttempt,
      RunnerRecordWriteError,
      never
    >(() => {
      const targetSlot = targetForAttempt(attempt);
      const active = targetSlot === undefined
        ? undefined
        : targetSlot.recordRun.attempts.get(targetSlot.slotId);
      if (
        targetSlot === undefined
        || targetSlot.plan.state !== "gap"
        || targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "reserved"
        || active === undefined
        || active.attempt !== attempt
        || active.completed
      ) {
        return Effect.fail(attemptInvalid());
      }
      const assertions = active.sealed === undefined
        ? undefined
        : createRunnerAssertionsAttachment(active.sealed);
      if (assertions !== undefined && Result.isFailure(assertions)) return Effect.fail(assertions.failure);
      if (active.sealed === undefined || assertions === undefined || Result.isFailure(assertions)) {
        return Effect.fail(membershipStateInvalid(targetSlot.slotId));
      }
      return Effect.gen(function* () {
        const sourcePlan = createRunnerSourceWritePlan([Object.freeze({
          slotId: targetSlot.slotId,
          result,
          assertionEntryIds: assertions.success.entryIds,
        })]);
        if (Result.isFailure(sourcePlan)) {
          return yield* Effect.fail(Object.freeze({
            code: "runner-record-sources-invalid" as const,
            issue: sourcePlan.failure,
          }));
        }
        const closedAssertions = createRunnerAssertionsAttachment(active.sealed!, {
          entryIds: assertions.success.entryIds,
          sourceSites: sourcePlan.success.sourceSitesBySlot.get(targetSlot.slotId),
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
        const sourceReceipts = yield* createAttemptObservabilityAttachments({ result, sealed: active.sealed! });
        if (sourceReceipts.agentTurns !== undefined) {
          yield* active.session.records.write(NiceEvalRecordAttachments.agentTurns, sourceReceipts.agentTurns);
        }
        if (sourceReceipts.sandboxCommands !== undefined) {
          yield* active.session.records.write(NiceEvalRecordAttachments.sandboxCommands, sourceReceipts.sandboxCommands);
        }
        yield* active.session.records.write(
          NiceEvalRecordAttachments.runnerActivities.attempt,
          sourceReceipts.runnerActivities,
        );
        yield* active.session.records.write(
          NiceEvalRecordAttachments.runnerDiagnostics.attempt,
          sourceReceipts.runnerDiagnostics,
        );
        const turnContexts = createRunnerTurnContextsAttachment({ result, sourcePlan: sourcePlan.success });
        if (Result.isFailure(turnContexts)) {
          return yield* Effect.fail(Object.freeze({
            code: "runner-record-sources-invalid" as const,
            issue: turnContexts.failure,
          }));
        }
        if (turnContexts.success !== undefined) {
          yield* active.session.records.write(NiceEvalRecordAttachments.turnContexts, turnContexts.success);
        }
        const fileChanges = createAttemptFileChangesAttachment(result);
        if (fileChanges !== undefined) {
          yield* active.session.records.write(NiceEvalRecordAttachments.fileChanges, fileChanges);
        }
        const artifacts = createAttemptArtifactsAttachment(result);
        if (artifacts !== undefined) {
          yield* active.session.records.write(NiceEvalRecordAttachments.artifacts.attempt, artifacts);
        }
        yield* active.session.complete(recordAttemptOutcome(result));
        const closureBytes = new TextEncoder().encode(JSON.stringify(attemptPublicationClosure(
          Object.freeze({
            runId: String(targetSlot.recordRun.session.runId),
            experimentId: targetSlot.recordRun.experimentId,
            context: targetSlot.recordRun.context,
            startedAt: targetSlot.recordRun.target.startedAt,
            completedAt: Date.now(),
            expectedSlots: targetSlot.recordRun.expectedSlots,
          }),
        )));
        yield* Effect.try({
          try: () => publishOriginAttempt(rootPath, {
            stagingDatabasePath: targetSlot.recordRun.stagingDatabasePath,
            runId: String(targetSlot.recordRun.session.runId),
            writerGeneration,
            slotId: String(targetSlot.slotId),
            attemptId: String(active.public.attemptId),
            attemptLocator: String(active.public.locator),
            closureBytes,
            closureDigest: createHash("sha256").update(closureBytes).digest("hex"),
            deadlineEpochMs: Date.now() + 30_000,
          }),
          catch: () => publishStateInvalid(targetSlot.recordRun.session.runId),
        });
        active.result = result;
        active.assertionEntryIds = assertions.success.entryIds;
        active.completed = true;
        targetSlot.recordRun.gapActions.set(targetSlot.slotId, "executed");
        return active.public;
      });
    });

    const attachRunFacts = (
      recordRun: RunnerRecordRun,
      mode: "normal" | "interrupted",
    ): Effect.Effect<void, RunnerRecordWriteError> => Effect.gen(function* () {
      const writeRecord = (
        effect: Effect.Effect<void, RecordWriteError, never>,
      ): Effect.Effect<void, RecordWriteError, never> => effect;
      const origins = [] as {
        readonly slotId: SlotId;
        readonly active: ActiveRunnerRecordAttempt;
        readonly result: EvalResult;
        readonly sealed: SealedAttemptAssertions;
        readonly assertionEntryIds: readonly AssertionEntryId[];
      }[];
      for (const [slotId, state] of recordRun.gapActions) {
        if (state !== "executed") continue;
        const active = recordRun.attempts.get(slotId);
        if (active === undefined) return yield* Effect.fail(membershipStateInvalid(slotId));
        const result = active.result;
        const sealed = active?.sealed;
        const assertionEntryIds = active?.assertionEntryIds;
        if (result === undefined || sealed === undefined || assertionEntryIds === undefined) continue;
        origins.push(Object.freeze({ slotId, active, result, sealed, assertionEntryIds }));
      }

      const sources = createRunnerSourceWritePlan(origins.map(({ slotId, result, assertionEntryIds }) => Object.freeze({
        slotId,
        result,
        assertionEntryIds,
      })));
      if (Result.isFailure(sources)) {
        return yield* Effect.fail(Object.freeze({
          code: "runner-record-sources-invalid" as const,
          issue: sources.failure,
        }));
      }
      yield* writeRecord(recordRun.session.records.write(
        NiceEvalRecordAttachments.sources,
        sources.success.sources,
      ));

      const sourceReceipts = yield* createRunObservabilityAttachments(recordRun.run);
      if (sourceReceipts.runnerActivities !== undefined) {
        yield* writeRecord(recordRun.session.records.write(
          NiceEvalRecordAttachments.runnerActivities.run,
          sourceReceipts.runnerActivities,
        ));
      }
      if (sourceReceipts.runnerDiagnostics !== undefined) {
        yield* writeRecord(recordRun.session.records.write(
          NiceEvalRecordAttachments.runnerDiagnostics.run,
          sourceReceipts.runnerDiagnostics,
        ));
      }
      yield* writeRecord(recordRun.session.records.write(
        NiceEvalRecordAttachments.artifacts.run,
        createRunArtifactsAttachment(),
      ));
    });

    const pendingGap = (recordRun: RunnerRecordRun): SlotId | undefined => {
      for (const [slotId, state] of recordRun.gapActions) {
        if (state === "pending") return slotId;
      }
      return undefined;
    };

    return Object.freeze({
      reusePlan,
      readCarriedResults: () => readCurrentExecutionReusePlanResults({ reader, plan: reusePlan }),
      runIdsByExperiment: new Map(runIdsByExperiment),
      publicationCutoff: () => currentPublicationCutoff(rootPath),
      carriedAttemptsByKey: new Map([...carriedAttemptsByKey].map(([key, attempts]) =>
        [key, new Set(attempts)] as const,
      )),
      adoptLatePublishedAttempt,
      reserveAttempt,
      noteSealedOrMarkIncomplete,
      completeAttemptOrMarkIncomplete: (attempt: Attempt, result: EvalResult) => completeAttempt(attempt, result).pipe(
        Effect.catch((error) => Effect.sync(() => {
          noteFailure(error, targetForAttempt(attempt)?.recordRun ?? runForAttempt(attempt));
          return undefined;
        })),
      ),
      markNotDispatched: (attempt: Attempt) => {
        const targetSlot = targetForAttempt(attempt);
        if (
          targetSlot !== undefined
          && targetSlot.plan.state === "gap"
          && targetSlot.recordRun.gapActions.get(targetSlot.slotId) === "pending"
        ) {
          targetSlot.recordRun.gapActions.set(targetSlot.slotId, "not-dispatched");
        }
      },
      publish: (completedAt: number, mode: "normal" | "interrupted") => Effect.gen(function* () {
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
        const incompleteRuns = mode === "interrupted"
          ? new Set(recordRuns.filter((recordRun) => writeFailuresByRun.has(recordRun)))
          : new Set<RunnerRecordRun>();

        if (mode === "normal") {
          // Normal completion is deliberately invocation-strict. A pending
          // gap means the scheduler failed to account for a Slot; a reserved
          // or otherwise unsettled Attempt is likewise not publishable.
          for (const recordRun of recordRuns) {
            const unsettledSlot = [...recordRun.gapActions.keys()].find((slotId) => {
              const active = recordRun.attempts.get(slotId);
              return recordRun.gapActions.get(slotId) === "reserved"
                || (active !== undefined && !active.completed);
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
        const publishOne = (recordRun: RunnerRecordRun): Effect.Effect<
          RecordSealReceipt,
          RunnerRecordWriteError
        > => Effect.gen(function* () {
          yield* attachRunFacts(recordRun, mode);
          for (const [slotId, state] of recordRun.gapActions) {
            if (state === "not-dispatched" || state === "interrupted") {
              const absenceReason: RunAbsenceReason = mode === "interrupted"
                ? "interrupted-before-publication"
                : state === "not-dispatched"
                  ? "early-exit-satisfied"
                  : "dispatch-failed";
              yield* recordRun.session.recordTerminalMember({ slotId, action: state, absenceReason });
            }
          }
          const sealed = yield* recordRun.session.seal({ completedAt: completion.success });
          const absences = [...recordRun.gapActions].flatMap(([slotId, state]) => {
            if (state === "executed" && recordRun.attempts.get(slotId)?.completed === true) return [];
            const reason: RunAbsenceReason = mode === "interrupted"
              ? "interrupted-before-publication"
              : state === "not-dispatched"
                ? "early-exit-satisfied"
                : "dispatch-failed";
            return [{ slotId: String(slotId), reason }];
          });
          closeRunResource(rootPath, {
            stagingDatabasePath: recordRun.stagingDatabasePath,
            runId: String(recordRun.session.runId),
            writerGeneration,
            state: mode === "interrupted" ? "interrupted" : "completed",
            completedAt: new Date(completedAt).toISOString(),
            absences,
            deadlineEpochMs: Date.now() + 30_000,
          });
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
        return Object.freeze(receipts);
      }),
    });
  });
}
