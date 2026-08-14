import { resolve as resolvePath } from "node:path";
import { Effect, Either, Schema } from "effect";

import {
  encodeAttemptLocator,
  type AttemptLocator,
} from "../attempt-locator.ts";
import {
  resolveAttemptLocator,
  type AttemptLocatorViewInvalid,
} from "../attempt-locator-resolution.ts";
import {
  EvaluationRecordContractV1,
  buildEligibilityAttachmentWriteV1,
  buildMembershipProvenanceAttachmentWriteV1,
  type AttemptEligibilityPayloadV1,
  type AttemptEligibilityPayloadBuildErrorV1,
  type ComparisonProvenanceV1,
  type DurationLimitV1,
  type EqualityTokenV1,
  type EvaluationRecordContractInvalidV1,
  type EvaluationRecordOriginDraftMissingV1,
  type EvaluationRecordPlanInvalidV1,
  type EvaluationSlotV1,
  type EvaluationsPayloadV1,
  type MembershipActionV1,
  type MembershipEffectiveOptionsV1,
  type MembershipGapV1,
  type MembershipPolicyIdentityV1,
  type MembershipProvenancePayloadBuildErrorV1,
  type MembershipSourceBarrierV1,
  type MembershipAttemptOriginV1,
  EXECUTION_DURATION_DOMAIN_V1,
} from "../eval/record/index.ts";
import { RunIdSchema, SlotIdSchema, UtcMillisSchema } from "../record/codec/identifiers.ts";
import {
  compareCanonicalIdentity,
  type AttemptId,
  type RunId,
  type SlotId,
  type UtcMillis,
} from "../record/model/identifiers.ts";
import {
  RecordEntropy,
  RecordFileSystem,
  recordPortablePath,
  type RecordEntropyService,
} from "../record/platform/services.ts";
import { makeRecordRoot, type RecordRootConstructionError } from "../record/platform/root.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import { openRecordReader } from "../record/reader/runtime.ts";
import {
  discardRecordAttemptDraft,
  openRecordWriteSession,
} from "../record/writer/runtime.ts";
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
import { resolveAttemptTimeout } from "./timeout.ts";
import {
  planProjectTargetReuse,
  planProjectTargetReuseWithoutSources,
  projectTargetPolicyIdentity,
  type ExecutionComparison,
  type ExecutionDurationLimit,
  type ExecutionGapSlot,
  type ExecutionIdentity,
  type ExecutionPolicyIdentity,
  type ExecutionReuseEffectiveOptions,
  type ExecutionReusePlanSlot,
  type ExecutionReusePlan,
  type ExecutionSourceBarrier,
  type ExecutionSourceOrigin,
  type ExecutionTarget,
  type ProjectTargetPolicy,
  type ProjectTargetReusePlanInvalid,
  type TargetRun,
  type TargetSlot,
} from "./reuse-plan.ts";
import {
  readCurrentExecutionReusePlanReadbacks,
  readCurrentExecutionReusePlanResults,
  type CurrentReusedAttemptReadback,
  type CurrentReuseReadback,
  type CurrentReuseReadbackPlanInvalid,
} from "./reuse-readback.ts";
import {
  evaluationRecordOriginInputFromSealedAssertions,
  type EvaluationRecordOriginAttemptInputV1,
  type EvaluationRecordPlanV1,
  type SealedAssertionsOriginEncodingError,
} from "../eval/record/evaluation-record.ts";
import type { RecordAttachmentWrite } from "../record/attachment/index.ts";
import {
  createAttemptObservabilityAttachmentWritesV1,
  createRunObservabilityAttachmentWritesV1,
  validateObservabilityAttachmentWriteBundlesV1,
  type AttemptObservabilityAttachmentWritesV1,
  type ObservabilityAttachmentBuildErrorV1,
} from "../o11y/record/family-writers.ts";
import {
  createRunnerAttemptObservabilityCaptureV1,
  createRunnerRunObservabilityCaptureV1,
  type RunnerObservabilityProducerErrorV1,
} from "../o11y/record/runner-producer.ts";
import type { ObservabilityRecordContractError } from "../o11y/record/errors.ts";
import {
  createRunnerSourceWritePlan,
  type RunnerSourceOriginInput,
  type RunnerSourceProducerInvalid,
} from "./source-producer.ts";
import {
  createRunnerSandboxWritePlan,
  type RunnerSandboxOriginInput,
  type RunnerSandboxRecordProducerError,
} from "./sandbox-record-producer.ts";
import type { SealedAttemptAssertions } from "../assertions/api.ts";
import type {
  AgentRun,
  Attempt,
  Config,
  DiscoveredEval,
  EvalResult,
  RunnerRecordAttachmentProducers,
} from "./types.ts";

/** Current, fully evaluated facts consumed by the Record-backed reuse policy. */
export interface RunnerRecordReuseSlotInput {
  readonly inputIdentity: import("./reuse-plan.ts").ExecutionIdentity;
  readonly configIdentity: import("./reuse-plan.ts").ExecutionIdentity;
  readonly timeout?: ExecutionDurationLimit;
}

/** The Runner supplies current identities; this coordinator never infers them from history. */
export interface RunnerRecordReuseInput {
  readonly policy: ProjectTargetPolicy;
  readonly slotsByKey: ReadonlyMap<string, RunnerRecordReuseSlotInput>;
}

/** Inputs already evaluated by ProjectTarget planning; history is never an input here. */
export interface RunnerRecordReusePreparationInput {
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly config: Pick<Config, "timeoutMs">;
  readonly plannedFingerprints: ReadonlyMap<string, string>;
  readonly plannedConfigHashes: ReadonlyMap<string, string>;
  readonly rerun?: "failed" | "all";
  readonly keepSandbox?: "failed" | "all";
}

const runnerReuseContract = Object.freeze({
  domain: "niceeval.reuse/base-v1",
  value: "project-target/v1",
});

/**
 * Builds the one current-policy input used by both the writer coordinator and
 * the dry reader. It never reads historical result files or creates legacy results.
 */
export function prepareRunnerRecordReuse(
  input: RunnerRecordReusePreparationInput,
): Effect.Effect<RunnerRecordReuseInput, RunnerRecordTargetInputMissing> {
  return Effect.suspend(() => {
    const slotsByKey = new Map<string, RunnerRecordReuseSlotInput>();
    for (const run of input.runs) {
      for (const evalDef of selectedEvalsForRun(input.evals, run)) {
        const key = cacheKey(run, evalDef.id);
        const fingerprint = input.plannedFingerprints.get(key);
        const configHash = input.plannedConfigHashes.get(key);
        if (fingerprint === undefined || configHash === undefined) {
          return Effect.fail<RunnerRecordTargetInputMissing>(Object.freeze({
            code: "runner-record-target-input-missing" as const,
            key,
          }));
        }
        const timeout = resolveAttemptTimeout(run, evalDef, input.config);
        slotsByKey.set(key, Object.freeze({
          inputIdentity: Object.freeze({
            domain: "niceeval.input/fingerprint-v1",
            value: fingerprint,
          }),
          configIdentity: Object.freeze({
            domain: "niceeval.config/identity-v1",
            value: configHash,
          }),
          ...(timeout === undefined
            ? {}
            : {
                timeout: Object.freeze({
                  domain: EXECUTION_DURATION_DOMAIN_V1,
                  milliseconds: timeout.timeoutMs,
                }),
              }),
        }));
      }
    }
    return Effect.succeed(Object.freeze({
      policy: Object.freeze({
        identity: projectTargetPolicyIdentity,
        reuseContract: Object.freeze({ ...runnerReuseContract }),
        rerun: input.rerun ?? "none",
        keepSandbox: input.keepSandbox !== undefined,
      }),
      slotsByKey: new Map(slotsByKey),
    }));
  });
}

interface PlannedRunnerRecordSlot {
  readonly evalDef: DiscoveredEval;
  readonly attempt: number;
  readonly slotId: SlotId;
  readonly reuse: RunnerRecordReuseSlotInput;
}

interface PlannedRunnerRecordRun {
  readonly run: AgentRun;
  readonly expectedSlots: readonly SlotId[];
  readonly evaluations: EvaluationsPayloadV1;
  readonly slots: ReadonlyMap<string, SlotId>;
  readonly slotEntries: readonly PlannedRunnerRecordSlot[];
}

type GapActionState = "pending" | "reserved" | "sealed" | "executed" | "not-dispatched" | "interrupted";

interface ActiveRunnerRecordAttempt<AttachmentError, AttachmentRequirements> {
  /** Exact logical handle passed through seal and completion for this target Slot. */
  readonly attempt: Attempt;
  readonly draft: RecordAttemptDraft;
  readonly public: RunnerRecordAttempt;
  sealed?: SealedAttemptAssertions;
  durable?: {
    readonly result: EvalResult;
    readonly origin: EvaluationRecordOriginAttemptInputV1;
    readonly eligibility: RecordAttachmentWrite<"attempt", never, never>;
    readonly observability: AttemptObservabilityAttachmentWritesV1;
    readonly pluginWrites: readonly RecordAttachmentWrite<
      "attempt",
      AttachmentError,
      AttachmentRequirements
    >[];
    readonly draft: RecordAttemptDraft;
  };
  completed: boolean;
}

interface RunnerRecordRun<AttachmentError, AttachmentRequirements> extends PlannedRunnerRecordRun {
  readonly draft: RecordRunDraft;
  readonly target: TargetRun;
  readonly attempts: Map<SlotId, ActiveRunnerRecordAttempt<AttachmentError, AttachmentRequirements>>;
  readonly planSlots: Map<SlotId, ExecutionReusePlanSlot>;
  readonly gapActions: Map<SlotId, GapActionState>;
}

export interface RunnerRecordAttempt {
  readonly slotId: SlotId;
  readonly attemptId: AttemptId;
  readonly locator: AttemptLocator;
}

export type RecordAttemptLocator = AttemptLocator;

export interface RunnerRecordAttemptLocatorCollision {
  readonly code: "attempt-locator-collision";
  readonly locator: AttemptLocator;
}

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

/** The official seven-family preflight failed before any of its writes began. */
export interface RunnerRecordObservabilityContractInvalid {
  readonly code: "runner-record-observability-contract-invalid";
  readonly errors: readonly ObservabilityRecordContractError[];
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
  | RunnerRecordObservabilityContractInvalid
  | RunnerRecordAttemptLocatorCollision
  | AttemptLocatorViewInvalid
  | RecordReaderReadError
  | AttemptEligibilityPayloadBuildErrorV1
  | MembershipProvenancePayloadBuildErrorV1
  | SealedAssertionsOriginEncodingError
  | RunnerSourceProducerInvalid
  | RunnerSandboxRecordProducerError
  | ObservabilityAttachmentBuildErrorV1
  | RunnerObservabilityProducerErrorV1
  | AttachmentError;

export type RunnerRecordOpenError<AttachmentError> =
  | RecordRootConstructionError
  | OpenRecordWriteSessionError
  | RecordReaderReadError
  | ProjectTargetReusePlanInvalid
  | RunnerRecordTargetInputMissing
  | RunnerRecordTargetIdentityInvalid
  | RunnerRecordMembershipStateInvalid
  | EvaluationRecordContractInvalidV1
  | EvaluationRecordPlanInvalidV1
  | RecordWriteError
  | AttachmentError;

export interface RunnerRecordCoordinator<AttachmentError, AttachmentRequirements> {
  /** The complete policy result remains with the invocation coordinator. */
  readonly reusePlan: ExecutionReusePlan;
  /**
   * Current visible facts for exact carried Attempts. This remains an Effect
   * because the frozen reader capability is scoped; it never recreates a
   * legacy EvalResult from paths, graph, or evidence.
   */
  readonly readCarriedResults: () => Effect.Effect<
    readonly CurrentReusedAttemptReadback[],
    RecordReaderReadError | CurrentReuseReadbackPlanInvalid
  >;
  /** Actual draft identities, one durable Record Run for each Experiment. */
  readonly runIdsByExperiment: ReadonlyMap<string, string>;
  /** Scheduler authority: only these Record-planned slots bypass fresh execution. */
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  /** Reserves the durable Attempt identity before attempt-owned external work. */
  readonly reserveAttempt: (
    attempt: Attempt,
  ) => Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError<AttachmentError>>;
  /** Keeps the exact sealed Assert-first result until its real duration is known. */
  readonly noteSealedOrMarkIncomplete: (
    attempt: Attempt,
    sealed: SealedAttemptAssertions,
  ) => Effect.Effect<void, never>;
  /** Completes the already-reserved fresh origin after its execution result is complete. */
  readonly completeAttemptOrMarkIncomplete: (
    attempt: Attempt,
    result: EvalResult,
  ) => Effect.Effect<RunnerRecordAttempt | undefined, never, AttachmentRequirements>;
  /** A gap that did not start has no Member, but remains explainable at publication. */
  readonly markNotDispatched: (attempt: Attempt) => void;
  /** Discards unfinished reservations, then records every remaining gap as interrupted. */
  readonly markInterrupted: () => Effect.Effect<
    void,
    RunnerRecordWriteError<AttachmentError>
  >;
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

function asRunId(value: string): Either.Either<RunId, RunnerRecordTargetIdentityInvalid> {
  const decoded = Schema.decodeUnknownEither(RunIdSchema)(value);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({
        code: "runner-record-target-identity-invalid" as const,
        kind: "invocation" as const,
        value,
      }))
    : Either.right(decoded.right);
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

/** A preview target needs valid ephemeral Run IDs but never creates a draft or writer lock. */
function mintPreviewRunId(
  entropy: RecordEntropyService,
  used: ReadonlySet<string>,
): Effect.Effect<RunId, RunnerRecordTargetIdentityInvalid> {
  return Effect.gen(function* () {
    for (let attempts = 0; attempts < 16; attempts += 1) {
      const uuid = yield* entropy.uuid;
      const runId = asRunId(`preview-run-${uuid}`);
      if (Either.isLeft(runId)) return yield* Effect.fail(runId.left);
      if (!used.has(runId.right)) return runId.right;
    }
    return yield* Effect.fail(Object.freeze({
      code: "runner-record-target-identity-invalid" as const,
      kind: "invocation" as const,
      value: "RecordEntropy produced duplicate preview Run identities",
    }));
  });
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

function planRun(input: {
  readonly run: AgentRun;
  readonly evals: readonly DiscoveredEval[];
  readonly reuse: RunnerRecordReuseInput;
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

/**
 * Current dry/readback capability. Its callback runs while the FrozenRecordView
 * remains open, so callers must project readbacks before returning from `use`.
 * It deliberately never opens a write session, creates a draft, or takes the
 * writer lock.
 */
export function withRunnerCurrentReusePreview<A, E, R>(input: {
  readonly niceevalRoot: string;
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
}) {
  return Effect.scoped(Effect.gen(function* () {
    const rootResult = makeRecordRoot(resolvePath(input.niceevalRoot, "record"));
    if (Either.isLeft(rootResult)) return yield* Effect.fail(rootResult.left);
    const root = rootResult.right;
    const fileSystem = yield* RecordFileSystem;
    if ((yield* fileSystem.pathKind(recordPortablePath(root))) === "missing") {
      const target = yield* previewExecutionTarget({
        startedAt: input.startedAt,
        evals: input.evals,
        runs: input.runs,
        reuse: input.reuse,
      });
      const reusePlan = yield* planProjectTargetReuseWithoutSources({
        target,
        policy: input.reuse.policy,
      });
      return yield* input.use({
        reusePlan,
        readReadbacks: () => Effect.succeed<readonly CurrentReuseReadback[]>(Object.freeze([])),
      });
    }

    const reader = yield* openRecordReader({ root });
    const target = yield* previewExecutionTarget({
      startedAt: input.startedAt,
      evals: input.evals,
      runs: input.runs,
      reuse: input.reuse,
    });
    const reusePlan = yield* planProjectTargetReuse({
      view: reader,
      target,
      policy: input.reuse.policy,
    });
    return yield* input.use({
      reusePlan,
      readReadbacks: () => readCurrentExecutionReusePlanReadbacks({
        view: reader,
        plan: reusePlan,
      }),
    });
  }));
}

function previewExecutionTarget(input: {
  readonly startedAt: number;
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly reuse: RunnerRecordReuseInput;
}): Effect.Effect<
  ExecutionTarget,
  RunnerRecordTargetInputMissing | RunnerRecordTargetIdentityInvalid,
  RecordEntropy
> {
  return Effect.gen(function* () {
    const entropy = yield* RecordEntropy;
    const experimentIds = new Set<string>();
    for (const run of input.runs) {
      if (experimentIds.has(run.experimentId)) {
        return yield* Effect.fail<RunnerRecordTargetIdentityInvalid>(Object.freeze({
          code: "runner-record-target-identity-invalid" as const,
          kind: "invocation" as const,
          value: `duplicate experimentId ${JSON.stringify(run.experimentId)}`,
        }));
      }
      experimentIds.add(run.experimentId);
    }
    const plannedRuns: PlannedRunnerRecordRun[] = [];
    const usedSlotIds = new Set<string>();
    for (const run of input.runs) {
      plannedRuns.push(yield* planRun({
        run,
        evals: input.evals,
        reuse: input.reuse,
        usedSlotIds,
        entropy,
      }));
    }

    const usedRunIds = new Set<string>();
    const targetRuns: TargetRun[] = [];
    for (const planned of plannedRuns) {
      const runId = yield* mintPreviewRunId(entropy, usedRunIds);
      usedRunIds.add(runId);
      targetRuns.push(Object.freeze({
        runId,
        experimentId: planned.run.experimentId,
        startedAt: asUtcMillis(input.startedAt),
        slots: Object.freeze(planned.slotEntries.map((entry) => Object.freeze({
          runId,
          slotId: entry.slotId,
          experimentId: planned.run.experimentId,
          evalId: entry.evalDef.id,
          attempt: entry.attempt,
          inputIdentity: entry.reuse.inputIdentity,
          configIdentity: entry.reuse.configIdentity,
          ...(entry.reuse.timeout === undefined ? {} : { timeout: entry.reuse.timeout }),
        } satisfies TargetSlot))),
      }));
    }
    return Object.freeze({
      invocationId: yield* mintInvocationId(entropy),
      runs: Object.freeze(targetRuns),
    });
  });
}

function attemptInvalid(): RunnerRecordAttemptInvalid {
  return Object.freeze({ code: "runner-record-attempt-invalid" as const });
}

function locatorCollision(locator: AttemptLocator): RunnerRecordAttemptLocatorCollision {
  return Object.freeze({ code: "attempt-locator-collision" as const, locator });
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

function observabilityContractInvalid(
  errors: readonly ObservabilityRecordContractError[],
): RunnerRecordObservabilityContractInvalid {
  return Object.freeze({
    code: "runner-record-observability-contract-invalid" as const,
    errors: Object.freeze([...errors]),
  });
}

/** The Record writer is the only boundary that reintroduces durable payload shapes. */
function durableExecutionIdentity(identity: ExecutionIdentity): EqualityTokenV1 {
  return Object.freeze({
    domain: identity.domain,
    value: identity.value,
  });
}

function durableExecutionDuration(limit: ExecutionDurationLimit): DurationLimitV1 {
  return Object.freeze({
    domain: limit.domain,
    milliseconds: limit.milliseconds,
  });
}

function durableEligibility(input: {
  readonly reuseContract: ExecutionIdentity;
  readonly inputIdentity: ExecutionIdentity;
  readonly configIdentity: ExecutionIdentity;
  readonly executionDuration: ExecutionDurationLimit;
}): AttemptEligibilityPayloadV1 {
  return Object.freeze({
    reuseContract: durableExecutionIdentity(input.reuseContract),
    inputIdentity: durableExecutionIdentity(input.inputIdentity),
    configIdentity: durableExecutionIdentity(input.configIdentity),
    executionDuration: durableExecutionDuration(input.executionDuration),
  });
}

function durableMembershipPolicy(identity: ExecutionPolicyIdentity): MembershipPolicyIdentityV1 {
  return Object.freeze({ name: identity.name, version: identity.version });
}

function durableMembershipOrigin(origin: ExecutionSourceOrigin): MembershipAttemptOriginV1 {
  return Object.freeze({ runId: origin.runId, slotId: origin.slotId });
}

function durableMembershipBarrier(
  barrier: ExecutionSourceBarrier,
): MembershipSourceBarrierV1 {
  return Object.freeze({ runId: barrier.runId, startedAt: barrier.startedAt });
}

function durableMembershipComparison(
  comparison: ExecutionComparison,
): ComparisonProvenanceV1 {
  return Object.freeze({
    attachment: comparison.attachment,
    recordedClaim: comparison.recordedClaim,
    sourceState: comparison.sourceState,
    result: comparison.result,
    reason: comparison.reason,
  });
}

function durableMembershipComparisons(
  comparisons: readonly ExecutionComparison[],
): readonly ComparisonProvenanceV1[] {
  return Object.freeze(comparisons.map(durableMembershipComparison));
}

function durableMembershipEffectiveOptions(
  options: ExecutionReuseEffectiveOptions,
): MembershipEffectiveOptionsV1 {
  return Object.freeze({
    rerun: options.rerun,
    keepSandbox: options.keepSandbox,
    reuseContract: Object.freeze({
      domain: options.reuseContract.domain,
      value: options.reuseContract.value,
    }),
  });
}

function gapFromPlan(slot: ExecutionGapSlot): MembershipGapV1 {
  return Object.freeze({
    reason: slot.reason,
    scope: slot.scope,
    issues: Object.freeze([...slot.issues]),
    ...(slot.sourceBarrier === undefined
      ? {}
      : { sourceBarrier: durableMembershipBarrier(slot.sourceBarrier) }),
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
  readonly reuse: RunnerRecordReuseInput;
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
    const targetRuns: TargetRun[] = [];
    for (const planned of plannedRuns) {
      const draft = yield* session.createRun({
        startedAt: asUtcMillis(input.startedAt),
        expectedSlots: planned.expectedSlots,
      });
      const target: TargetRun = Object.freeze({
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
        } satisfies TargetSlot))),
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

    const target: ExecutionTarget = Object.freeze({
      invocationId: yield* mintInvocationId(entropy),
      runs: Object.freeze(targetRuns),
    });
    const reusePlan = yield* planProjectTargetReuse({
      view: session.view,
      target,
      policy: input.reuse.policy,
    });

    const carriedAttemptsByKey = new Map<string, Set<number>>();
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
    }

    for (const recordRun of byRun.values()) {
      const references = recordRun.target.slots.flatMap((targetSlot) => {
        const slot = recordRun.planSlots.get(targetSlot.slotId);
        return slot?.state === "reuse"
          ? [Object.freeze({ slotId: targetSlot.slotId, attempt: slot.source.attempt })]
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
    let interruptionObserved = false;
    const noteWriteFailure = (error: RunnerRecordWriteError<AttachmentError>): void => {
      if (writeFailure === undefined) writeFailure = Object.freeze({ error });
    };
    const locatorMutex = yield* Effect.makeSemaphore(1);
    const invocationLocators = new Map<AttemptLocator, {
      readonly originRunId: RunId;
      readonly attemptId: AttemptId;
    }>();

    const recordRunForAttempt = (
      attempt: Attempt,
    ): RunnerRecordRun<AttachmentError, AttachmentRequirements> | undefined =>
      byRun.get(attempt.run);
    const targetSlotForAttempt = (attempt: Attempt): {
      readonly recordRun: RunnerRecordRun<AttachmentError, AttachmentRequirements>;
      readonly slotId: SlotId;
      readonly plan: ExecutionReusePlanSlot;
    } | undefined => {
      const recordRun = recordRunForAttempt(attempt);
      if (recordRun === undefined) return undefined;
      const slotId = recordRun.slots.get(slotKey(attempt.evalDef.id, attempt.attempt));
      if (slotId === undefined) return undefined;
      const plan = recordRun.planSlots.get(slotId);
      return plan === undefined ? undefined : { recordRun, slotId, plan };
    };

    const reserveAttempt = (
      attempt: Attempt,
    ): Effect.Effect<RunnerRecordAttempt, RunnerRecordWriteError<AttachmentError>> =>
      locatorMutex.withPermits(1)(Effect.gen(function* () {
        const targetSlot = targetSlotForAttempt(attempt);
        if (
          targetSlot === undefined
          || targetSlot.plan.state !== "gap"
          || targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "pending"
          || targetSlot.recordRun.attempts.has(targetSlot.slotId)
        ) {
          return yield* Effect.fail(attemptInvalid());
        }

        const draft = yield* targetSlot.recordRun.draft.createAttempt({
          slotId: targetSlot.slotId,
        });
        const locator = encodeAttemptLocator(draft.attemptId);
        const issued: RunnerRecordAttempt = Object.freeze({
          slotId: targetSlot.slotId,
          attemptId: draft.attemptId,
          locator,
        });
        targetSlot.recordRun.attempts.set(targetSlot.slotId, {
          attempt,
          draft,
          public: issued,
          completed: false,
        });
        targetSlot.recordRun.gapActions.set(targetSlot.slotId, "reserved");

        const existing = yield* resolveAttemptLocator(session.view, locator);
        if (existing.kind !== "not-found") {
          const same = existing.kind === "found"
            && existing.attempt.originRunId === targetSlot.recordRun.draft.runId
            && existing.attempt.attemptId === draft.attemptId;
          if (!same) return yield* Effect.fail(locatorCollision(locator));
        }
        const local = invocationLocators.get(locator);
        if (
          local !== undefined
          && (local.originRunId !== targetSlot.recordRun.draft.runId
            || local.attemptId !== draft.attemptId)
        ) {
          return yield* Effect.fail(locatorCollision(locator));
        }
        invocationLocators.set(locator, Object.freeze({
          originRunId: targetSlot.recordRun.draft.runId,
          attemptId: draft.attemptId,
        }));
        return issued;
      })).pipe(
        Effect.tapError((error) => Effect.sync(() => noteWriteFailure(error))),
      );

    const noteSealedOrMarkIncomplete = (
      attempt: Attempt,
      sealed: SealedAttemptAssertions,
    ): Effect.Effect<void, never> => Effect.sync(() => {
      const targetSlot = targetSlotForAttempt(attempt);
      if (
        targetSlot === undefined
        || targetSlot.plan.state !== "gap"
        || targetSlot.recordRun.gapActions.get(targetSlot.slotId) !== "reserved"
      ) {
        noteWriteFailure(attemptInvalid());
        return;
      }
      const active = targetSlot.recordRun.attempts.get(targetSlot.slotId);
      if (active === undefined || active.attempt !== attempt || active.sealed !== undefined) {
        noteWriteFailure(attemptInvalid());
        return;
      }
      active.sealed = sealed;
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
        || active.sealed === undefined
        || active.completed
        || !resultMatchesAttempt(result, attempt)
      ) {
        return Effect.fail(attemptInvalid());
      }
      const sealed = active.sealed;
      const duration = executionDuration(result);
      if (duration === undefined) return Effect.fail(executionDurationInvalid(targetSlot.slotId));

      const eligibility = buildEligibilityAttachmentWriteV1(durableEligibility({
        reuseContract: input.reuse.policy.reuseContract,
        inputIdentity: targetSlot.plan.inputIdentity,
        configIdentity: targetSlot.plan.configIdentity,
        executionDuration: {
          domain: EXECUTION_DURATION_DOMAIN_V1,
          milliseconds: duration,
        },
      }));
      if (Either.isLeft(eligibility)) return Effect.fail(eligibility.left);

      return Effect.gen(function* () {
        const writes = yield* Effect.sync(() =>
          input.attachments?.attemptWrites?.({
            attempt,
            result,
            sealed,
            sources: Object.freeze([...(result.sources ?? [])]),
          }) ?? [],
        );
        const origin = evaluationRecordOriginInputFromSealedAssertions(
          targetSlot.slotId,
          sealed,
        );
        if (Either.isLeft(origin)) return yield* Effect.fail(origin.left);
        // This is the only Runner → Record boundary that sees both the sealed
        // Assert-first outcome and its final EvalResult. The producer returns
        // normalized owner facts; the Record adapter constructs the official
        // typed writes without exposing attachment names or paths to Runner.
        const observabilityCapture = yield* createRunnerAttemptObservabilityCaptureV1({
          result,
          sealed,
        });
        const observability = createAttemptObservabilityAttachmentWritesV1(
          observabilityCapture,
        );
        if (Either.isLeft(observability)) return yield* Effect.fail(observability.left);
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            active.durable = Object.freeze({
              result,
              origin: origin.right,
              eligibility: eligibility.right,
              observability: observability.right,
              pluginWrites: Object.freeze([...writes]),
              draft: active.draft,
            });
            active.completed = true;
            targetSlot.recordRun.gapActions.set(targetSlot.slotId, "executed");
            return active.public;
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

    const markInterrupted = (): Effect.Effect<
      void,
      RunnerRecordWriteError<AttachmentError>
    > => Effect.gen(function* () {
      interruptionObserved = true;
      yield* Effect.forEach(
        [...byRun.values()],
        (recordRun) => Effect.forEach(
          [...recordRun.gapActions],
          ([slotId, state]): Effect.Effect<
            void,
            RunnerRecordWriteError<AttachmentError>
          > => {
            if (state === "pending") {
              return Effect.sync(() => {
                recordRun.gapActions.set(slotId, "interrupted");
              });
            }
            if (state !== "reserved" && state !== "sealed") return Effect.void;
            const active = recordRun.attempts.get(slotId);
            if (active === undefined || active.completed) {
              return Effect.fail(attemptInvalid());
            }
            return discardRecordAttemptDraft(active.draft).pipe(
              Effect.tap(() => Effect.sync(() => {
                recordRun.attempts.delete(slotId);
                recordRun.gapActions.set(slotId, "interrupted");
              })),
            );
          },
          { concurrency: 1, discard: true },
        ),
        { concurrency: 1, discard: true },
      );
    });

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
            attemptId: slot.source.attemptId,
            origin: durableMembershipOrigin(slot.source.origin),
            sourceBarrier: durableMembershipBarrier(slot.source.sourceBarrier),
            comparisons: durableMembershipComparisons(slot.comparisons),
          }));
          continue;
        }

        const state = recordRun.gapActions.get(slot.slotId) ?? "pending";
        const gap = gapFromPlan(slot);
        if (state === "reserved" || state === "sealed") {
          return Either.left(unsealedAttempt(slot.slotId));
        }
        if (state === "executed") {
          const active = recordRun.attempts.get(slot.slotId);
          if (active === undefined || !active.completed) {
            return Either.left(membershipStateInvalid(slot.slotId));
          }
          actions.push(Object.freeze({
            action: "executed" as const,
            slotId: slot.slotId,
            attemptId: active.public.attemptId,
            gap,
            comparisons: durableMembershipComparisons(slot.comparisons),
          }));
          continue;
        }
        actions.push(Object.freeze({
          action: state === "interrupted" ? "interrupted" as const : "not-dispatched" as const,
          slotId: slot.slotId,
          gap,
          comparisons: durableMembershipComparisons(slot.comparisons),
        }));
      }
      return Either.right(Object.freeze(actions));
    };

    return Object.freeze({
      reusePlan,
      readCarriedResults: () => readCurrentExecutionReusePlanResults({
        view: session.view,
        plan: reusePlan,
      }),
      runIdsByExperiment: new Map(runIdsByExperiment),
      carriedAttemptsByKey: new Map(
        [...carriedAttemptsByKey].map(([key, attempts]) =>
          [key, new Set(attempts)] as const,
        ),
      ),
      reserveAttempt,
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
          // A reserved origin already has a Core Member. If SIGINT arrives before
          // its assertions and final result close, that draft must remain
          // incomplete rather than publishing a Member without complete Attempt
          // facts. Independent drafts still take the ordinary publish validation.
          const publishableRuns = [...byRun.values()].filter((recordRun) =>
            !interruptionObserved || ![...recordRun.gapActions.values()].some((state) =>
              state === "reserved" || state === "sealed"
            ));
          for (const recordRun of publishableRuns) {
            const runObservabilityCapture = yield* createRunnerRunObservabilityCaptureV1({
              run: recordRun.run,
            });
            const runObservability = createRunObservabilityAttachmentWritesV1(
              runObservabilityCapture,
            );
            if (Either.isLeft(runObservability)) return yield* Effect.fail(runObservability.left);

            const attemptObservability: AttemptObservabilityAttachmentWritesV1[] = [];
            for (const active of recordRun.attempts.values()) {
              if (!active.completed) continue;
              if (active.durable === undefined) return yield* Effect.fail(attemptInvalid());
              attemptObservability.push(active.durable.observability);
            }
            const observabilityErrors = validateObservabilityAttachmentWriteBundlesV1({
              run: runObservability.right,
              attempts: Object.freeze(attemptObservability),
            });
            if (observabilityErrors.length > 0) {
              return yield* Effect.fail(observabilityContractInvalid(observabilityErrors));
            }

            const sourceOrigins: RunnerSourceOriginInput[] = [];
            const sandboxOrigins: RunnerSandboxOriginInput[] = [];
            for (const [slotId, active] of recordRun.attempts) {
              if (!active.completed) continue;
              if (active.durable === undefined) return yield* Effect.fail(attemptInvalid());
              sourceOrigins.push(Object.freeze({
                slotId,
                result: active.durable.result,
                assertions: active.durable.origin.assertions,
              }));
              sandboxOrigins.push(Object.freeze({
                slotId,
                sandbox: active.durable.result.sandbox,
              }));
            }
            const sourcePlan = createRunnerSourceWritePlan(sourceOrigins);
            if (Either.isLeft(sourcePlan)) return yield* Effect.fail(sourcePlan.left);
            const sandboxPlan = createRunnerSandboxWritePlan(sandboxOrigins);
            if (Either.isLeft(sandboxPlan)) return yield* Effect.fail(sandboxPlan.left);

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
              const sandboxWrite = sandboxPlan.right.attemptWrites.get(slotId);
              if (sandboxWrite === undefined) return yield* Effect.fail(attemptInvalid());
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
                    durable.observability.conversation,
                    durable.observability.commands,
                    durable.observability.usage,
                    durable.observability.timing,
                    durable.observability.diagnostics,
                    ...durable.pluginWrites,
                    sourceSites,
                    sandboxWrite,
                  ]),
                })],
              });
              originPlans.push(Object.freeze({ slotId, draft: durable.draft, plan }));
            }

            const actions = membershipActionsFor(recordRun);
            if (Either.isLeft(actions)) return yield* Effect.fail(actions.left);
            const provenance = buildMembershipProvenanceAttachmentWriteV1({
              policy: durableMembershipPolicy(reusePlan.policy),
              effectiveOptions: durableMembershipEffectiveOptions(reusePlan.effectiveOptions),
              actions: actions.right,
            });
            if (Either.isLeft(provenance)) return yield* Effect.fail(provenance.left);
            yield* recordRun.draft.record(runObservability.right.timing);
            yield* recordRun.draft.record(runObservability.right.diagnostics);
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
            publishableRuns,
            (recordRun) => recordRun.draft.publish({ completedAt: asUtcMillis(completedAt) }),
            { concurrency: 1 },
          );
        }),
    });
  });
}
