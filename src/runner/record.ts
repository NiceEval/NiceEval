import { resolve as resolvePath } from "node:path";
import { Effect, Either, Schema } from "effect";

import {
  EvaluationRecordContractV1,
  buildEligibilityAttachmentWriteV1,
  buildMembershipProvenanceAttachmentWriteV1,
  type AttemptEligibilityPayloadBuildErrorV1,
  type DurationLimitV1,
  type EqualityTokenV1,
  type EvaluationRecordContractInvalidV1,
  type EvaluationRecordOriginDraftMissingV1,
  type EvaluationRecordPlanInvalidV1,
  type EvaluationSlotV1,
  type EvaluationsPayloadV1,
  type MembershipActionV1,
  type MembershipGapV1,
  type MembershipProvenancePayloadBuildErrorV1,
  EXECUTION_DURATION_DOMAIN_V1,
} from "../eval/record/index.ts";
import { SlotIdSchema, UtcMillisSchema } from "../record/codec/identifiers.ts";
import {
  compareCanonicalIdentity,
  type AttemptId,
  type SlotId,
  type UtcMillis,
} from "../record/model/identifiers.ts";
import {
  RecordEntropy,
  type RecordEntropyService,
} from "../record/platform/services.ts";
import { makeRecordRoot, type RecordRootConstructionError } from "../record/platform/root.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import { openRecordWriteSession } from "../record/writer/runtime.ts";
import type {
  OpenRecordWriteSessionError,
  OpenRecordWriteSessionRequirements,
  RecordAttemptDraft,
  RecordPublishReceipt,
  RecordRunDraft,
  RecordWriteError,
} from "../record/writer/types.ts";
import { cacheKey } from "./fingerprint.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";
import {
  planProjectTargetReuseV1,
  type ExecutionGapSlotV1,
  type ExecutionReusePlanSlotV1,
  type ExecutionReusePlanV1,
  type ExecutionTargetV1,
  type ProjectTargetPolicyV1,
  type ProjectTargetReusePlanInvalidV1,
  type TargetRunV1,
  type TargetSlotV1,
} from "./reuse-plan.ts";
import {
  evaluationRecordOriginInputFromSealedAssertions,
  type EvaluationRecordOriginAttemptInputV1,
  type EvaluationRecordPlanV1,
  type SealedAssertionsOriginEncodingError,
} from "../eval/record/evaluation-record.ts";
import type { RecordAttachmentWrite } from "../record/attachment/index.ts";
import {
  createRunnerSourceWritePlan,
  type RunnerSourceOriginInput,
  type RunnerSourceProducerInvalid,
} from "./source-producer.ts";
import type { SealedAttemptAssertions } from "../assertions/api.ts";
import type {
  AgentRun,
  Attempt,
  DiscoveredEval,
  EvalResult,
  RunnerRecordAttachmentProducers,
} from "./types.ts";

/** Current, fully evaluated facts consumed by the Record-backed reuse policy. */
export interface RunnerRecordReuseSlotInputV1 {
  readonly inputIdentity: EqualityTokenV1;
  readonly configIdentity: EqualityTokenV1;
  readonly timeout?: DurationLimitV1;
}

/** The Runner supplies current identities; this coordinator never infers them from history. */
export interface RunnerRecordReuseInputV1 {
  readonly policy: ProjectTargetPolicyV1;
  readonly slotsByKey: ReadonlyMap<string, RunnerRecordReuseSlotInputV1>;
}

interface PlannedRunnerRecordSlot {
  readonly evalDef: DiscoveredEval;
  readonly attempt: number;
  readonly slotId: SlotId;
  readonly reuse: RunnerRecordReuseSlotInputV1;
}

interface PlannedRunnerRecordRun {
  readonly run: AgentRun;
  readonly expectedSlots: readonly SlotId[];
  readonly evaluations: EvaluationsPayloadV1;
  readonly slots: ReadonlyMap<string, SlotId>;
  readonly slotEntries: readonly PlannedRunnerRecordSlot[];
}

type GapActionState = "pending" | "sealed" | "executed" | "not-dispatched" | "interrupted";

interface ActiveRunnerRecordAttempt<AttachmentError, AttachmentRequirements> {
  /** Exact logical handle passed through seal and completion for this target Slot. */
  readonly attempt: Attempt;
  readonly sealed: SealedAttemptAssertions;
  durable?: {
    readonly result: EvalResult;
    readonly origin: EvaluationRecordOriginAttemptInputV1;
    readonly eligibility: RecordAttachmentWrite<"attempt", never, never>;
    readonly pluginWrites: readonly RecordAttachmentWrite<
      "attempt",
      AttachmentError,
      AttachmentRequirements
    >[];
    readonly draft: RecordAttemptDraft;
  };
  public?: RunnerRecordAttempt;
  completed: boolean;
}

interface RunnerRecordRun<AttachmentError, AttachmentRequirements> extends PlannedRunnerRecordRun {
  readonly draft: RecordRunDraft;
  readonly target: TargetRunV1;
  readonly attempts: Map<SlotId, ActiveRunnerRecordAttempt<AttachmentError, AttachmentRequirements>>;
  readonly planSlots: Map<SlotId, ExecutionReusePlanSlotV1>;
  readonly gapActions: Map<SlotId, GapActionState>;
}

export interface RunnerRecordAttempt {
  readonly slotId: SlotId;
  readonly attemptId: AttemptId;
  readonly locator: RecordAttemptLocatorV1;
}

declare const recordAttemptLocatorV1Brand: unique symbol;

/**
 * Record v1's public locator is the complete exact durable AttemptId. It is
 * intentionally separate from the historical short-hash `AttemptLocator`
 * brand, whose encoder/decoder must not participate in this path.
 */
export type RecordAttemptLocatorV1 = string & {
  readonly [recordAttemptLocatorV1Brand]: "RecordAttemptLocatorV1";
};

export interface RunnerRecordAttemptInvalid {
  readonly code: "runner-record-attempt-invalid";
}

export interface RunnerRecordUnsealedAttempt {
  readonly code: "runner-record-attempt-unsealed";
  readonly slotId: SlotId;
}

export interface RunnerRecordExecutionDurationInvalid {
  readonly code: "runner-record-execution-duration-invalid";
  readonly slotId: SlotId;
}

export interface RunnerRecordTargetInputMissing {
  readonly code: "runner-record-target-input-missing";
  readonly key: string;
}

export interface RunnerRecordTargetIdentityInvalid {
  readonly code: "runner-record-target-identity-invalid";
  readonly kind: "invocation" | "slot";
  readonly value: string;
}

export interface RunnerRecordMembershipStateInvalid {
  readonly code: "runner-record-membership-state-invalid";
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
  | RunnerRecordExecutionDurationInvalid
  | RunnerRecordMembershipStateInvalid
  | AttemptEligibilityPayloadBuildErrorV1
  | MembershipProvenancePayloadBuildErrorV1
  | SealedAssertionsOriginEncodingError
  | RunnerSourceProducerInvalid
  | AttachmentError;

export type RunnerRecordOpenError<AttachmentError> =
  | RecordRootConstructionError
  | OpenRecordWriteSessionError
  | RecordReaderReadError
  | ProjectTargetReusePlanInvalidV1
  | RunnerRecordTargetInputMissing
  | RunnerRecordTargetIdentityInvalid
  | RunnerRecordMembershipStateInvalid
  | EvaluationRecordContractInvalidV1
  | EvaluationRecordPlanInvalidV1
  | RecordWriteError
  | AttachmentError;

export interface RunnerRecordCoordinator<AttachmentError, AttachmentRequirements> {
  /** The complete policy result remains with the invocation coordinator. */
  readonly reusePlan: ExecutionReusePlanV1;
  /** Actual draft identities, one durable Record Run for each Experiment. */
  readonly runIdsByExperiment: ReadonlyMap<string, string>;
  /** Scheduler authority: only these Record-planned slots bypass fresh execution. */
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  /** A legacy result may be displayed only when it names this exact reused Attempt. */
  readonly carriedAttemptIdsBySlotKey: ReadonlyMap<string, AttemptId>;
  /** Keeps the exact sealed Assert-first result until its real duration is known. */
  readonly noteSealedOrMarkIncomplete: (
    attempt: Attempt,
    sealed: SealedAttemptAssertions,
  ) => Effect.Effect<void, never>;
  /** Allocates and writes a fresh origin only after its execution result is complete. */
  readonly completeAttemptOrMarkIncomplete: (
    attempt: Attempt,
    result: EvalResult,
  ) => Effect.Effect<RunnerRecordAttempt | undefined, never, AttachmentRequirements>;
  /** A gap that did not start has no Member, but remains explainable at publication. */
  readonly markNotDispatched: (attempt: Attempt) => void;
  /** Interruption never invents a Member for a gap that did not complete. */
  readonly markInterrupted: () => void;
  /** Writes one membership-provenance Attachment per target Run, then seals it. */
  readonly publish: (
    completedAt: number,
  ) => Effect.Effect<
    readonly RecordPublishReceipt[],
    RunnerRecordWriteError<AttachmentError>,
    AttachmentRequirements
  >;
}

function slotKey(evalId: string, attempt: number): string {
  return `${evalId}\u0000${attempt}`;
}

function slotAttemptKey(run: AgentRun, evalId: string, attempt: number): string {
  return `${cacheKey(run, evalId)}\u0000${attempt}`;
}

function asSlotId(value: string): Either.Either<SlotId, RunnerRecordTargetIdentityInvalid> {
  const decoded = Schema.decodeUnknownEither(SlotIdSchema)(value);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({
        code: "runner-record-target-identity-invalid" as const,
        kind: "slot" as const,
        value,
      }))
    : Either.right(decoded.right);
}

function asUtcMillis(value: number): UtcMillis {
  const decoded = Schema.decodeUnknownEither(UtcMillisSchema)(value);
  if (Either.isLeft(decoded)) {
    throw new Error(`Runner produced an invalid Record timestamp: ${value}`);
  }
  return decoded.right;
}

/** Target Slot identity is invocation-local opaque data, minted through RecordEntropy. */
function mintTargetSlotId(
  entropy: RecordEntropyService,
  used: ReadonlySet<string>,
): Effect.Effect<SlotId, RunnerRecordTargetIdentityInvalid> {
  return Effect.gen(function* () {
    for (let attempts = 0; attempts < 16; attempts += 1) {
      const uuid = yield* entropy.uuid;
      const slotId = asSlotId(`slot-${uuid}`);
      if (Either.isLeft(slotId)) return yield* Effect.fail(slotId.left);
      if (!used.has(slotId.right)) return slotId.right;
    }
    return yield* Effect.fail(Object.freeze({
      code: "runner-record-target-identity-invalid" as const,
      kind: "slot" as const,
      value: "RecordEntropy produced duplicate Slot identities",
    }));
  });
}

function mintInvocationId(
  entropy: RecordEntropyService,
): Effect.Effect<string, RunnerRecordTargetIdentityInvalid> {
  return Effect.flatMap(entropy.uuid, (uuid) =>
    uuid.length > 0 && uuid.length <= 255
      ? Effect.succeed(uuid)
      : Effect.fail(Object.freeze({
          code: "runner-record-target-identity-invalid" as const,
          kind: "invocation" as const,
          value: uuid,
        })),
  );
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
function locatorForAttemptId(attemptId: AttemptId): RecordAttemptLocatorV1 {
  return `@${attemptId}` as RecordAttemptLocatorV1;
}

function planRun(input: {
  readonly run: AgentRun;
  readonly evals: readonly DiscoveredEval[];
  readonly reuse: RunnerRecordReuseInputV1;
  readonly usedSlotIds: Set<string>;
  readonly entropy: RecordEntropyService;
}): Effect.Effect<
  PlannedRunnerRecordRun,
  RunnerRecordTargetInputMissing | RunnerRecordTargetIdentityInvalid
> {
  return Effect.gen(function* () {
    const slots = new Map<string, SlotId>();
    const slotEntries: PlannedRunnerRecordSlot[] = [];
    const definitions: EvaluationsPayloadV1["evaluations"][number][] = [];
    for (const evalDef of selectedEvalsForRun(input.evals, input.run)) {
      const slotInput = input.reuse.slotsByKey.get(cacheKey(input.run, evalDef.id));
      if (slotInput === undefined) {
        return yield* Effect.fail<RunnerRecordTargetInputMissing>({
          code: "runner-record-target-input-missing",
          key: cacheKey(input.run, evalDef.id),
        });
      }
      const evaluationSlots: EvaluationSlotV1[] = [];
      for (let attempt = 0; attempt < input.run.attempts; attempt += 1) {
        const key = slotKey(evalDef.id, attempt);
        const slotId = yield* mintTargetSlotId(input.entropy, input.usedSlotIds);
        input.usedSlotIds.add(slotId);
        if (slots.has(key)) {
          return yield* Effect.fail<RunnerRecordTargetIdentityInvalid>({
            code: "runner-record-target-identity-invalid",
            kind: "slot",
            value: `duplicate ${key}`,
          });
        }
        slots.set(key, slotId);
        slotEntries.push(Object.freeze({ evalDef, attempt, slotId, reuse: slotInput }));
        evaluationSlots.push(Object.freeze({ slotId, attempt }));
      }
      definitions.push(Object.freeze({
        evalId: evalDef.id,
        evaluationKind: evalDef.evaluationKind,
        slots: nonEmptySlots(evaluationSlots),
      }));
    }

    return Object.freeze({
      run: input.run,
      // Record Core stores the Run denominator in canonical identity order;
      // target slot IDs are entropy-backed and therefore cannot rely on
      // execution/ordinal construction order for that invariant.
      expectedSlots: Object.freeze(
        slotEntries.map((entry) => entry.slotId).sort(compareCanonicalIdentity),
      ),
      evaluations: Object.freeze({
        experimentId: input.run.experimentId,
        evaluations: Object.freeze(definitions),
      }),
      slots,
      slotEntries: Object.freeze(slotEntries),
    });
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

function executionDurationInvalid(slotId: SlotId): RunnerRecordExecutionDurationInvalid {
  return Object.freeze({
    code: "runner-record-execution-duration-invalid" as const,
    slotId,
  });
}

function membershipStateInvalid(slotId: SlotId): RunnerRecordMembershipStateInvalid {
  return Object.freeze({
    code: "runner-record-membership-state-invalid" as const,
    slotId,
  });
}

function gapFromPlan(slot: ExecutionGapSlotV1): MembershipGapV1 {
  return Object.freeze({
    reason: slot.reason,
    scope: slot.scope,
    issues: Object.freeze([...slot.issues]),
    ...(slot.sourceBarrier === undefined ? {} : { sourceBarrier: slot.sourceBarrier }),
  });
}

function executionDuration(result: EvalResult): number | undefined {
  // runAttemptEffect's final map guarantees executionMs for executed attempts.
  const duration = result.executionMs;
  return typeof duration === "number" && Number.isFinite(duration) && duration >= 0
    ? duration
    : undefined;
}

function resultMatchesAttempt(result: EvalResult, attempt: Attempt): boolean {
  return result.id === attempt.evalDef.id
    && result.attempt === attempt.attempt
    && result.experimentId === attempt.run.experimentId
    && result.fingerprint === attempt.fingerprint
    && result.configHash === attempt.configHash;
}

/**
 * Opens one scoped Record writer before expensive work, allocates all target
 * identities, and uses only its frozen view to decide exact references.
 */
export function openRunnerRecordCoordinator<AttachmentError, AttachmentRequirements>(input: {
  readonly niceevalRoot: string;
  readonly startedAt: number;
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly reuse: RunnerRecordReuseInputV1;
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
    // Product scope is one selected Experiment to one durable Run. Reject this
    // before opening a writer so a duplicate input cannot leave partial drafts
    // or silently overwrite the public run-id mapping.
    const experimentIds = new Set<string>();
    for (const run of input.runs) {
      if (experimentIds.has(run.experimentId)) {
        return yield* Effect.fail<RunnerRecordTargetIdentityInvalid>({
          code: "runner-record-target-identity-invalid",
          kind: "invocation",
          value: `duplicate experimentId ${JSON.stringify(run.experimentId)}`,
        });
      }
      experimentIds.add(run.experimentId);
    }
    const rootResult = makeRecordRoot(resolvePath(input.niceevalRoot, "record"));
    if (Either.isLeft(rootResult)) {
      return yield* Effect.fail(rootResult.left);
    }

    const session = yield* openRecordWriteSession({ root: rootResult.right });
    const entropy = yield* RecordEntropy;
    const plannedRuns: PlannedRunnerRecordRun[] = [];
    const usedSlotIds = new Set<string>();
    for (const run of input.runs) {
      const planned = yield* planRun({
        run,
        evals: input.evals,
        reuse: input.reuse,
        usedSlotIds,
        entropy,
      });
      plannedRuns.push(planned);
    }

    const byRun = new Map<AgentRun, RunnerRecordRun<AttachmentError, AttachmentRequirements>>();
    const byRecordRunId = new Map<string, RunnerRecordRun<AttachmentError, AttachmentRequirements>>();
    const runIdsByExperiment = new Map<string, string>();
    const targetRuns: TargetRunV1[] = [];
    for (const planned of plannedRuns) {
      const draft = yield* session.createRun({
        startedAt: asUtcMillis(input.startedAt),
        expectedSlots: planned.expectedSlots,
      });
      const target: TargetRunV1 = Object.freeze({
        runId: draft.runId,
        experimentId: planned.run.experimentId,
        startedAt: asUtcMillis(input.startedAt),
        slots: Object.freeze(planned.slotEntries.map((entry) => Object.freeze({
          runId: draft.runId,
          slotId: entry.slotId,
          experimentId: planned.run.experimentId,
          evalId: entry.evalDef.id,
          attempt: entry.attempt,
          inputIdentity: entry.reuse.inputIdentity,
          configIdentity: entry.reuse.configIdentity,
          ...(entry.reuse.timeout === undefined ? {} : { timeout: entry.reuse.timeout }),
        } satisfies TargetSlotV1))),
      });
      const recordRun: RunnerRecordRun<AttachmentError, AttachmentRequirements> = {
        ...planned,
        draft,
        target,
        attempts: new Map(),
        planSlots: new Map(),
        gapActions: new Map(),
      };
      byRun.set(planned.run, recordRun);
      byRecordRunId.set(draft.runId, recordRun);
      runIdsByExperiment.set(planned.run.experimentId, draft.runId);
      targetRuns.push(target);
    }

    const target: ExecutionTargetV1 = Object.freeze({
      invocationId: yield* mintInvocationId(entropy),
      runs: Object.freeze(targetRuns),
    });
    const reusePlan = yield* planProjectTargetReuseV1({
      view: session.view,
      target,
      policy: input.reuse.policy,
    });

    const carriedAttemptsByKey = new Map<string, Set<number>>();
    const carriedAttemptIdsBySlotKey = new Map<string, AttemptId>();
    for (const slot of reusePlan.slots) {
      const recordRun = byRecordRunId.get(slot.runId);
      if (recordRun === undefined) {
        return yield* Effect.fail(membershipStateInvalid(slot.slotId));
      }
      recordRun.planSlots.set(slot.slotId, slot);
      if (slot.state === "gap") {
        recordRun.gapActions.set(slot.slotId, "pending");
        continue;
      }
      const entry = recordRun.slotEntries.find((candidate) => candidate.slotId === slot.slotId);
      if (entry === undefined) return yield* Effect.fail(membershipStateInvalid(slot.slotId));
      const key = cacheKey(recordRun.run, entry.evalDef.id);
      const carried = carriedAttemptsByKey.get(key) ?? new Set<number>();
      carried.add(entry.attempt);
      carriedAttemptsByKey.set(key, carried);
      carriedAttemptIdsBySlotKey.set(
        slotAttemptKey(recordRun.run, entry.evalDef.id, entry.attempt),
        slot.attemptId,
      );
    }

    for (const recordRun of byRun.values()) {
      const references = recordRun.target.slots.flatMap((targetSlot) => {
        const slot = recordRun.planSlots.get(targetSlot.slotId);
        return slot?.state === "reuse"
          ? [Object.freeze({ slotId: targetSlot.slotId, attempt: slot.sourceAttempt })]
          : [];
      });
      const runWrites = yield* Effect.sync(() =>
        input.attachments?.runWrites?.({ run: recordRun.run, evals: input.evals }) ?? [],
      );
      const plan = yield* EvaluationRecordContractV1.preparePlan({
        startedAt: asUtcMillis(input.startedAt),
        completedAt: asUtcMillis(input.startedAt),
        expectedSlots: recordRun.expectedSlots,
        evaluations: recordRun.evaluations,
        originAttempts: [],
        references,
        runWrites,
      });
      yield* EvaluationRecordContractV1.writePlanRunToDraft(recordRun.draft, plan);
      yield* EvaluationRecordContractV1.writePlanReferencesToDraft(recordRun.draft, plan);
    }

    let writeFailure: { readonly error: RunnerRecordWriteError<AttachmentError> } | undefined;
    const noteWriteFailure = (error: RunnerRecordWriteError<AttachmentError>): void => {
      if (writeFailure === undefined) writeFailure = Object.freeze({ error });
    };

    const recordRunForAttempt = (
      attempt: Attempt,
    ): RunnerRecordRun<AttachmentError, AttachmentRequirements> | undefined =>
      byRun.get(attempt.run);
    const targetSlotForAttempt = (attempt: Attempt): {
      readonly recordRun: RunnerRecordRun<AttachmentError, AttachmentRequirements>;
      readonly slotId: SlotId;
      readonly plan: ExecutionReusePlanSlotV1;
    } | undefined => {
      const recordRun = recordRunForAttempt(attempt);
      if (recordRun === undefined) return undefined;
      const slotId = recordRun.slots.get(slotKey(attempt.evalDef.id, attempt.attempt));
      if (slotId === undefined) return undefined;
      const plan = recordRun.planSlots.get(slotId);
      return plan === undefined ? undefined : { recordRun, slotId, plan };
    };

    const noteSealedOrMarkIncomplete = (
      attempt: Attempt,
      sealed: SealedAttemptAssertions,
    ): Effect.Effect<void, never> => Effect.sync(() => {
      const targetSlot = targetSlotForAttempt(attempt);
      if (
        targetSlot === undefined
        || targetSlot.plan.state !== "gap"
        || targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "pending"
        || targetSlot.recordRun.attempts.has(targetSlot.slotId)
      ) {
        noteWriteFailure(attemptInvalid());
        return;
      }
      targetSlot.recordRun.attempts.set(targetSlot.slotId, {
        attempt,
        sealed,
        completed: false,
      });
      targetSlot.recordRun.gapActions.set(targetSlot.slotId, "sealed");
    });

    const completeAttempt = (
      attempt: Attempt,
      result: EvalResult,
    ): Effect.Effect<
      RunnerRecordAttempt,
      RunnerRecordWriteError<AttachmentError>,
      AttachmentRequirements
    > => Effect.suspend<
      RunnerRecordAttempt,
      RunnerRecordWriteError<AttachmentError>,
      AttachmentRequirements
    >(() => {
      const targetSlot = targetSlotForAttempt(attempt);
      if (targetSlot === undefined) return Effect.fail(attemptInvalid());
      const active = targetSlot.recordRun.attempts.get(targetSlot.slotId);
      if (
        targetSlot.plan.state !== "gap"
        || active === undefined
        || targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "sealed"
        || active.attempt !== attempt
        || active.completed
        || !resultMatchesAttempt(result, attempt)
      ) {
        return Effect.fail(attemptInvalid());
      }
      const duration = executionDuration(result);
      if (duration === undefined) return Effect.fail(executionDurationInvalid(targetSlot.slotId));

      const eligibility = buildEligibilityAttachmentWriteV1({
        reuseContract: input.reuse.policy.reuseContract,
        inputIdentity: targetSlot.plan.inputIdentity,
        configIdentity: targetSlot.plan.configIdentity,
        executionDuration: Object.freeze({
          domain: EXECUTION_DURATION_DOMAIN_V1,
          milliseconds: duration,
        }),
      });
      if (Either.isLeft(eligibility)) return Effect.fail(eligibility.left);

      return Effect.gen(function* () {
        const writes = yield* Effect.sync(() =>
          input.attachments?.attemptWrites?.({
            attempt,
            result,
            sealed: active.sealed,
            sources: Object.freeze([...(result.sources ?? [])]),
          }) ?? [],
        );
        const origin = evaluationRecordOriginInputFromSealedAssertions(
          targetSlot.slotId,
          active.sealed,
        );
        if (Either.isLeft(origin)) return yield* Effect.fail(origin.left);
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const draft = yield* targetSlot.recordRun.draft.createAttempt({
              slotId: targetSlot.slotId,
            });
            const issued: RunnerRecordAttempt = Object.freeze({
              slotId: targetSlot.slotId,
              attemptId: draft.attemptId,
              locator: locatorForAttemptId(draft.attemptId),
            });
            active.durable = Object.freeze({
              result,
              origin: origin.right,
              eligibility: eligibility.right,
              pluginWrites: Object.freeze([...writes]),
              draft,
            });
            active.public = issued;
            active.completed = true;
            targetSlot.recordRun.gapActions.set(targetSlot.slotId, "executed");
            return issued;
          }),
        );
      });
    });

    const completeAttemptOrMarkIncomplete = (
      attempt: Attempt,
      result: EvalResult,
    ): Effect.Effect<RunnerRecordAttempt | undefined, never, AttachmentRequirements> =>
      completeAttempt(attempt, result).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            noteWriteFailure(error);
            return undefined;
          }),
        ),
      );

    const markNotDispatched = (attempt: Attempt): void => {
      const targetSlot = targetSlotForAttempt(attempt);
      if (targetSlot === undefined || targetSlot.plan.state !== "gap") return;
      if (targetSlot.recordRun.gapActions.get(targetSlot.slotId) === "pending") {
        targetSlot.recordRun.gapActions.set(targetSlot.slotId, "not-dispatched");
      }
    };

    const markInterrupted = (): void => {
      for (const recordRun of byRun.values()) {
        for (const [slotId, state] of recordRun.gapActions) {
          if (state === "pending" || state === "sealed") {
            recordRun.gapActions.set(slotId, "interrupted");
          }
        }
      }
    };

    const membershipActionsFor = (
      recordRun: RunnerRecordRun<AttachmentError, AttachmentRequirements>,
    ): Either.Either<readonly MembershipActionV1[], RunnerRecordWriteError<AttachmentError>> => {
      const actions: MembershipActionV1[] = [];
      for (const targetSlot of recordRun.target.slots) {
        const slot = recordRun.planSlots.get(targetSlot.slotId);
        if (slot === undefined) return Either.left(membershipStateInvalid(targetSlot.slotId));
        if (slot.state === "reuse") {
          actions.push(Object.freeze({
            action: "carried" as const,
            slotId: slot.slotId,
            attemptId: slot.attemptId,
            origin: slot.origin,
            sourceBarrier: slot.sourceBarrier,
            comparisons: Object.freeze([...slot.comparisons]),
          }));
          continue;
        }

        const state = recordRun.gapActions.get(slot.slotId) ?? "pending";
        const gap = gapFromPlan(slot);
        if (state === "sealed") return Either.left(unsealedAttempt(slot.slotId));
        if (state === "executed") {
          const active = recordRun.attempts.get(slot.slotId);
          if (active === undefined || active.public === undefined || !active.completed) {
            return Either.left(membershipStateInvalid(slot.slotId));
          }
          actions.push(Object.freeze({
            action: "executed" as const,
            slotId: slot.slotId,
            attemptId: active.public.attemptId,
            gap,
            comparisons: Object.freeze([...slot.comparisons]),
          }));
          continue;
        }
        actions.push(Object.freeze({
          action: state === "interrupted" ? "interrupted" as const : "not-dispatched" as const,
          slotId: slot.slotId,
          gap,
          comparisons: Object.freeze([...slot.comparisons]),
        }));
      }
      return Either.right(Object.freeze(actions));
    };

    return Object.freeze({
      reusePlan,
      runIdsByExperiment: new Map(runIdsByExperiment),
      carriedAttemptsByKey: new Map(
        [...carriedAttemptsByKey].map(([key, attempts]) =>
          [key, new Set(attempts)] as const,
        ),
      ),
      carriedAttemptIdsBySlotKey: new Map(carriedAttemptIdsBySlotKey),
      noteSealedOrMarkIncomplete,
      completeAttemptOrMarkIncomplete,
      markNotDispatched,
      markInterrupted,
      publish: (completedAt: number): Effect.Effect<
        readonly RecordPublishReceipt[],
        RunnerRecordWriteError<AttachmentError>,
        AttachmentRequirements
      > =>
        Effect.gen(function* () {
          if (writeFailure !== undefined) return yield* Effect.fail(writeFailure.error);
          for (const recordRun of byRun.values()) {
            const sourceOrigins: RunnerSourceOriginInput[] = [];
            for (const [slotId, active] of recordRun.attempts) {
              if (!active.completed) continue;
              if (active.durable === undefined) return yield* Effect.fail(attemptInvalid());
              sourceOrigins.push(Object.freeze({
                slotId,
                result: active.durable.result,
                assertions: active.durable.origin.assertions,
              }));
            }
            const sourcePlan = createRunnerSourceWritePlan(sourceOrigins);
            if (Either.isLeft(sourcePlan)) return yield* Effect.fail(sourcePlan.left);

            const originPlans: {
              readonly slotId: SlotId;
              readonly draft: RecordAttemptDraft;
              readonly plan: EvaluationRecordPlanV1<AttachmentError, AttachmentRequirements>;
            }[] = [];
            for (const [slotId, active] of recordRun.attempts) {
              if (!active.completed) continue;
              const durable = active.durable;
              if (durable === undefined || sourcePlan.right === undefined) {
                return yield* Effect.fail(attemptInvalid());
              }
              const sourceSites = sourcePlan.right.attemptWrites.get(slotId);
              if (sourceSites === undefined) return yield* Effect.fail(attemptInvalid());
              const plan = yield* EvaluationRecordContractV1.preparePlan({
                startedAt: asUtcMillis(input.startedAt),
                completedAt: asUtcMillis(completedAt),
                expectedSlots: recordRun.expectedSlots,
                evaluations: recordRun.evaluations,
                originAttempts: [Object.freeze({
                  ...durable.origin,
                  writes: Object.freeze([
                    durable.eligibility,
                    ...(durable.origin.writes ?? []),
                    ...durable.pluginWrites,
                    sourceSites,
                  ]),
                })],
              });
              originPlans.push(Object.freeze({ slotId, draft: durable.draft, plan }));
            }

            const actions = membershipActionsFor(recordRun);
            if (Either.isLeft(actions)) return yield* Effect.fail(actions.left);
            const provenance = buildMembershipProvenanceAttachmentWriteV1({
              policy: reusePlan.policy,
              effectiveOptions: reusePlan.effectiveOptions,
              actions: actions.right,
            });
            if (Either.isLeft(provenance)) return yield* Effect.fail(provenance.left);
            if (sourcePlan.right !== undefined) {
              yield* recordRun.draft.record(sourcePlan.right.runWrite);
            }
            for (const origin of originPlans) {
              yield* EvaluationRecordContractV1.writePlanOriginsToAttempts(
                new Map([[origin.slotId, origin.draft]]),
                origin.plan,
              );
            }
            yield* recordRun.draft.record(provenance.right);
          }
          return yield* Effect.forEach(
            [...byRun.values()],
            (recordRun) => recordRun.draft.publish({ completedAt: asUtcMillis(completedAt) }),
            { concurrency: 1 },
          );
        }),
    });
  });
}
