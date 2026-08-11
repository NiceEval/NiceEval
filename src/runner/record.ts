import { Effect, Either, Schema } from "effect";
import { resolve as resolvePath } from "node:path";

import {
  EvaluationRecordContractV1,
  type EvaluationRecordContractInvalidV1,
  type EvaluationRecordOriginDraftMissingV1,
  type EvaluationRecordPlanInvalidV1,
  type EvaluationSlotV1,
  type EvaluationsPayloadV1,
} from "../eval/record/index.ts";
import {
  evaluationRecordOriginInputFromAssertionsV1,
  type SealedAttemptAssertionsV1,
} from "./assertions.ts";
import { SlotIdSchema, UtcMillisSchema } from "../record/codec/identifiers.ts";
import type { AttemptId, SlotId, UtcMillis } from "../record/model/identifiers.ts";
import type { AttemptLocator } from "../record/locator.ts";
import { makeRecordRoot, type RecordRootConstructionError } from "../record/platform/root.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type { FrozenRecordAttempt } from "../record/reader/types.ts";
import { openRecordWriteSession } from "../record/writer/runtime.ts";
import type {
  OpenRecordWriteSessionError,
  OpenRecordWriteSessionRequirements,
  RecordAttemptDraft,
  RecordPublishReceipt,
  RecordRunDraft,
  RecordWriteError,
} from "../record/writer/types.ts";
import { digestOf } from "../sandbox/identity.ts";
import { cacheKey } from "./fingerprint.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";
import type {
  AgentRun,
  Attempt,
  DiscoveredEval,
  RunnerRecordAttachmentProducers,
  RunnerRecordCarryReferences,
} from "./types.ts";

interface PlannedRunnerRecordSlot {
  readonly evalDef: DiscoveredEval;
  readonly attempt: number;
  readonly slotId: SlotId;
}

interface PlannedRunnerRecordRun {
  readonly run: AgentRun;
  readonly expectedSlots: readonly SlotId[];
  readonly evaluations: EvaluationsPayloadV1;
  readonly slots: ReadonlyMap<string, SlotId>;
  readonly slotEntries: readonly PlannedRunnerRecordSlot[];
}

interface ActiveRunnerRecordAttempt {
  readonly public: RunnerRecordAttempt;
  readonly draft: RecordAttemptDraft;
  sealed: boolean;
}

interface RunnerRecordRun extends PlannedRunnerRecordRun {
  readonly draft: RecordRunDraft;
  readonly attempts: Map<SlotId, ActiveRunnerRecordAttempt>;
}

export interface RunnerRecordAttempt {
  readonly slotId: SlotId;
  readonly attemptId: AttemptId;
  readonly locator: AttemptLocator;
}

export interface RunnerRecordCarryGap {
  readonly run: AgentRun;
  readonly evalDef: DiscoveredEval;
  readonly attempt: number;
  readonly slotId: SlotId;
  readonly reason: "carry-source-unavailable";
}

export interface RunnerRecordAttemptInvalid {
  readonly code: "runner-record-attempt-invalid";
}

export interface RunnerRecordUnsealedAttempt {
  readonly code: "runner-record-attempt-unsealed";
  readonly slotId: SlotId;
}

/** A planned Slot was neither exactly referenced nor sealed as a fresh origin. */
export type RunnerRecordWriteError<AttachmentError> =
  | EvaluationRecordContractInvalidV1
  | EvaluationRecordPlanInvalidV1
  | EvaluationRecordOriginDraftMissingV1
  | RecordWriteError
  | RunnerRecordAttemptInvalid
  | RunnerRecordUnsealedAttempt
  | AttachmentError;

export type RunnerRecordOpenError<AttachmentError> =
  | RecordRootConstructionError
  | OpenRecordWriteSessionError
  | RecordReaderReadError
  | EvaluationRecordContractInvalidV1
  | EvaluationRecordPlanInvalidV1
  | RecordWriteError
  | AttachmentError;

export interface RunnerRecordCoordinator<AttachmentError, AttachmentRequirements> {
  /** Allocate the one durable Attempt identity immediately before execution. */
  readonly startAttempt: (
    attempt: Attempt,
  ) => Effect.Effect<
    RunnerRecordAttempt,
    RecordWriteError | RunnerRecordAttemptInvalid
  >;
  /** Write one sealed Assert-first origin to that pre-created Attempt. */
  readonly captureSealed: (
    recordAttempt: RunnerRecordAttempt,
    attempt: Attempt,
    sealed: SealedAttemptAssertionsV1,
  ) => Effect.Effect<void, RunnerRecordWriteError<AttachmentError>, AttachmentRequirements>;
  /**
   * Adapter for runAttemptEffect's seal callback. It preserves typed write
   * failures until publish, while allowing its Assert-first finalizer to finish
   * the original interruption path without masking it.
   */
  readonly captureSealedOrMarkIncomplete: (
    recordAttempt: RunnerRecordAttempt,
    attempt: Attempt,
    sealed: SealedAttemptAssertionsV1,
  ) => Effect.Effect<void, never, AttachmentRequirements>;
  /** Publish only after ordinary invocation completion and all started origins sealed. */
  readonly publish: (
    completedAt: number,
  ) => Effect.Effect<
    readonly RecordPublishReceipt[],
    RunnerRecordWriteError<AttachmentError>,
    AttachmentRequirements
  >;
  /** Only exact frozen sources are admitted as carried Slots. */
  readonly acceptedCarriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  /** Legacy carry candidates without an exact source are returned to dispatch. */
  readonly carryGaps: readonly RunnerRecordCarryGap[];
}

function slotKey(evalId: string, attempt: number): string {
  return `${evalId}\u0000${attempt}`;
}

function asSlotId(value: string): SlotId {
  const decoded = Schema.decodeUnknownEither(SlotIdSchema)(value);
  if (Either.isLeft(decoded)) {
    throw new Error(`Runner produced an invalid Record SlotId: ${value}`);
  }
  return decoded.right;
}

function asUtcMillis(value: number): UtcMillis {
  const decoded = Schema.decodeUnknownEither(UtcMillisSchema)(value);
  if (Either.isLeft(decoded)) {
    throw new Error(`Runner produced an invalid Record timestamp: ${value}`);
  }
  return decoded.right;
}

function slotIdFor(input: {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
}): SlotId {
  return asSlotId(`slot-${digestOf(input)}`);
}

function nonEmptySlots(
  slots: readonly EvaluationSlotV1[],
): readonly [EvaluationSlotV1, ...EvaluationSlotV1[]] {
  const [first, ...rest] = slots;
  if (first === undefined) {
    throw new Error("Runner planned an Eval without Record Slots");
  }
  return Object.freeze([first, ...rest]);
}

/** The current Record locator is the exact durable AttemptId, not a hash alias. */
function locatorForAttemptId(attemptId: AttemptId): AttemptLocator {
  return `@${attemptId}` as AttemptLocator;
}

function planRun(input: {
  readonly run: AgentRun;
  readonly evals: readonly DiscoveredEval[];
}): PlannedRunnerRecordRun {
  const slots = new Map<string, SlotId>();
  const slotEntries: PlannedRunnerRecordSlot[] = [];
  const definitions = selectedEvalsForRun(input.evals, input.run).map((evalDef) => {
    const evaluationSlots: EvaluationSlotV1[] = [];
    for (let attempt = 0; attempt < input.run.attempts; attempt += 1) {
      const key = slotKey(evalDef.id, attempt);
      const slotId = slotIdFor({
        experimentId: input.run.experimentId,
        evalId: evalDef.id,
        attempt,
      });
      if (slots.has(key)) {
        throw new Error(`Runner planned a duplicate Record Slot for ${evalDef.id}`);
      }
      slots.set(key, slotId);
      slotEntries.push(Object.freeze({ evalDef, attempt, slotId }));
      evaluationSlots.push(Object.freeze({ slotId, attempt }));
    }
    return Object.freeze({
      evalId: evalDef.id,
      evaluationKind: evalDef.evaluationKind,
      slots: nonEmptySlots(evaluationSlots),
    });
  });

  return Object.freeze({
    run: input.run,
    expectedSlots: Object.freeze([...slots.values()].sort()),
    evaluations: Object.freeze({
      experimentId: input.run.experimentId,
      evaluations: Object.freeze(definitions),
    }),
    slots,
    slotEntries: Object.freeze(slotEntries),
  });
}

function attemptInvalid(): RunnerRecordAttemptInvalid {
  return Object.freeze({ code: "runner-record-attempt-invalid" as const });
}

function unsealedAttempt(slotId: SlotId): RunnerRecordUnsealedAttempt {
  return Object.freeze({
    code: "runner-record-attempt-unsealed" as const,
    slotId,
  });
}

/**
 * Opens one scoped Record writer before expensive work. It intentionally never
 * searches historic Runs: references are accepted only when the carry planner
 * supplies an exact FrozenRecordAttempt from this session's frozen view.
 */
export function openRunnerRecordCoordinator<AttachmentError, AttachmentRequirements>(input: {
  readonly niceevalRoot: string;
  readonly startedAt: number;
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  readonly carryReferences?: RunnerRecordCarryReferences;
  readonly attachments?: RunnerRecordAttachmentProducers<
    AttachmentError,
    AttachmentRequirements
  >;
}): Effect.Effect<
  RunnerRecordCoordinator<AttachmentError, AttachmentRequirements>,
  RunnerRecordOpenError<AttachmentError>,
  OpenRecordWriteSessionRequirements | AttachmentRequirements
> {
  return Effect.gen(function* () {
    const rootResult = makeRecordRoot(resolvePath(input.niceevalRoot, "record"));
    if (Either.isLeft(rootResult)) {
      return yield* Effect.fail(rootResult.left);
    }

    const session = yield* openRecordWriteSession({ root: rootResult.right });
    const byRun = new Map<AgentRun, RunnerRecordRun>();
    const carryGaps: RunnerRecordCarryGap[] = [];
    const acceptedCarriedAttemptsByKey = new Map<string, Set<number>>();

    for (const planned of input.runs.map((run) => planRun({ run, evals: input.evals }))) {
      const draft = yield* session.createRun({
        startedAt: asUtcMillis(input.startedAt),
        expectedSlots: planned.expectedSlots,
      });
      const recordRun: RunnerRecordRun = {
        ...planned,
        draft,
        attempts: new Map(),
      };

      const references: Array<{ readonly slotId: SlotId; readonly attempt: FrozenRecordAttempt }> = [];
      for (const entry of planned.slotEntries) {
        const carried = input.carriedAttemptsByKey.get(cacheKey(planned.run, entry.evalDef.id));
        if (!carried?.has(entry.attempt)) continue;
        const source = input.carryReferences === undefined
          ? undefined
          : yield* input.carryReferences.sourceForCarriedSlot({
              run: planned.run,
              evalDef: entry.evalDef,
              attempt: entry.attempt,
              slotId: entry.slotId,
              view: session.view,
            });
        if (source === undefined) {
          carryGaps.push(Object.freeze({
            run: planned.run,
            evalDef: entry.evalDef,
            attempt: entry.attempt,
            slotId: entry.slotId,
            reason: "carry-source-unavailable" as const,
          }));
        } else {
          references.push(Object.freeze({ slotId: entry.slotId, attempt: source }));
          const key = cacheKey(planned.run, entry.evalDef.id);
          const accepted = acceptedCarriedAttemptsByKey.get(key) ?? new Set<number>();
          accepted.add(entry.attempt);
          acceptedCarriedAttemptsByKey.set(key, accepted);
        }
      }

      const runWrites = yield* Effect.sync(() =>
        input.attachments?.runWrites?.({ run: planned.run, evals: input.evals }) ?? [],
      );
      const plan = yield* EvaluationRecordContractV1.preparePlan({
        startedAt: asUtcMillis(input.startedAt),
        completedAt: asUtcMillis(input.startedAt),
        expectedSlots: planned.expectedSlots,
        evaluations: planned.evaluations,
        originAttempts: [],
        references,
        runWrites,
      });
      yield* EvaluationRecordContractV1.writePlanRunToDraft(draft, plan);
      yield* EvaluationRecordContractV1.writePlanReferencesToDraft(draft, plan);
      byRun.set(planned.run, recordRun);
    }

    let writeFailure: { readonly error: RunnerRecordWriteError<AttachmentError> } | undefined;

    const startAttempt = (
      attempt: Attempt,
    ): Effect.Effect<RunnerRecordAttempt, RecordWriteError | RunnerRecordAttemptInvalid> =>
      Effect.suspend<
        RunnerRecordAttempt,
        RecordWriteError | RunnerRecordAttemptInvalid,
        never
      >(() => {
        const recordRun = byRun.get(attempt.run);
        const slotId = recordRun?.slots.get(slotKey(attempt.evalDef.id, attempt.attempt));
        if (recordRun === undefined || slotId === undefined) {
          return Effect.fail(attemptInvalid());
        }
        const active = recordRun.attempts.get(slotId);
        if (active !== undefined) return Effect.succeed(active.public);
        return Effect.map(recordRun.draft.createAttempt({ slotId }), (draftAttempt) => {
          const issued: RunnerRecordAttempt = Object.freeze({
            slotId,
            attemptId: draftAttempt.attemptId,
            locator: locatorForAttemptId(draftAttempt.attemptId),
          });
          recordRun.attempts.set(slotId, {
            public: issued,
            draft: draftAttempt,
            sealed: false,
          });
          return issued;
        });
      });

    const captureSealed = (
      recordAttempt: RunnerRecordAttempt,
      attempt: Attempt,
      sealed: SealedAttemptAssertionsV1,
    ): Effect.Effect<
      void,
      RunnerRecordWriteError<AttachmentError>,
      AttachmentRequirements
    > => Effect.suspend<
      void,
      RunnerRecordWriteError<AttachmentError>,
      AttachmentRequirements
    >(() => {
      const recordRun = byRun.get(attempt.run);
      const active = recordRun?.attempts.get(recordAttempt.slotId);
      if (
        recordRun === undefined ||
        active === undefined ||
        active.public !== recordAttempt ||
        active.public.attemptId !== recordAttempt.attemptId
      ) {
        return Effect.fail(attemptInvalid());
      }
      if (active.sealed) return Effect.fail(attemptInvalid());
      active.sealed = true;

      return Effect.gen(function* () {
        const writes = yield* Effect.sync(() =>
          input.attachments?.attemptWrites?.({ attempt, sealed }) ?? [],
        );
        const origin = evaluationRecordOriginInputFromAssertionsV1(
          recordAttempt.slotId,
          sealed,
        );
        const plan = yield* EvaluationRecordContractV1.preparePlan({
          startedAt: asUtcMillis(input.startedAt),
          completedAt: asUtcMillis(Date.now()),
          expectedSlots: recordRun.expectedSlots,
          evaluations: recordRun.evaluations,
          originAttempts: [
            Object.freeze({
              ...origin,
              ...(writes.length === 0 ? {} : { writes }),
            }),
          ],
        });
        yield* EvaluationRecordContractV1.writePlanOriginsToAttempts(
          new Map([[recordAttempt.slotId, active.draft]]),
          plan,
        );
      });
    });

    const captureSealedOrMarkIncomplete = (
      recordAttempt: RunnerRecordAttempt,
      attempt: Attempt,
      sealed: SealedAttemptAssertionsV1,
    ): Effect.Effect<void, never, AttachmentRequirements> =>
      captureSealed(recordAttempt, attempt, sealed).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (writeFailure === undefined) writeFailure = Object.freeze({ error });
          }),
        ),
      );

    return Object.freeze({
      startAttempt,
      captureSealed,
      captureSealedOrMarkIncomplete,
      publish: (completedAt: number) =>
        Effect.gen(function* () {
          if (writeFailure !== undefined) return yield* Effect.fail(writeFailure.error);
          for (const recordRun of byRun.values()) {
            for (const [slotId, active] of recordRun.attempts) {
              if (!active.sealed) return yield* Effect.fail(unsealedAttempt(slotId));
            }
          }
          return yield* Effect.forEach(
            [...byRun.values()],
            (recordRun) => recordRun.draft.publish({ completedAt: asUtcMillis(completedAt) }),
            { concurrency: 1 },
          );
        }),
      acceptedCarriedAttemptsByKey: new Map(
        [...acceptedCarriedAttemptsByKey].map(([key, attempts]) =>
          [key, new Set(attempts)] as const,
        ),
      ),
      carryGaps: Object.freeze(carryGaps),
    });
  });
}
