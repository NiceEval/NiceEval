import { createHash, randomBytes } from "node:crypto";
import { slotExecutionIdentityDigestHex } from "./execution-identity.ts";

import { Cause, Effect, Either, Exit, Option, Schema, Stream } from "effect";

import { encodeAttemptLocator, type AttemptLocator } from "../attempt-locator.ts";
import type { SealedAttemptAssertions } from "../assertions/api.ts";
import {
  createAssertionsAttachmentProducer,
  encodeSealedAssertionEntry,
} from "../assertions/record/attachment.ts";
import { createAgentWorkspaceDiffAttachmentWrite } from "../assertions/record/diff.ts";
import type { AssertionsProducerError } from "../assertions/record/producer.ts";
import {
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type FixedAttachmentWriteSpec,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentWrite,
} from "../record/attachment/index.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import {
  attemptArtifactsRecordFamily,
  assertionsRecordFamily,
  runArtifactsRecordFamily,
} from "../record/family/catalog.ts";
import type { AssertionSourceSite } from "../record/family/assertions.ts";
import { ArtifactsAttachmentSchema } from "../record/family/artifacts.ts";
import type { ArtifactsAttachment } from "../record/family/artifacts.ts";
import {
  createAttemptObservabilityAttachmentWrite,
  createRunObservabilityAttachmentWrite,
} from "../o11y/record/family-writers.ts";
import {
  createRunnerAttemptObservabilityCapture,
  createRunnerRunObservabilityCapture,
} from "../o11y/record/runner-producer.ts";
import {
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  ExperimentIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../record/codec/identifiers.ts";
import { recordHost } from "../record/host/runtime.ts";
import type {
  AttemptWriteSession,
  AssertionsWrite,
  RecordSealReceipt,
  RunWriteSession,
} from "../record/host/types.ts";
import type { RecordSlotIdentity } from "../record/model/core.ts";
import {
  canonicalizeRunContext,
  type RunContext,
} from "../record/model/run-context.ts";
import type {
  EvalId,
  ExecutionIdentityDigest,
  ExperimentId,
  RunId,
  SlotId,
  UtcMillis,
} from "../record/model/identifiers.ts";
import type { AssertionEntryId } from "../assertions/identity.ts";
import type { RecordRoot } from "../record/platform/root.ts";
import {
  RecordFileSystem,
  recordPortablePath,
} from "../record/platform/services.ts";
import type {
  RecordReaderOpenError,
  RecordReaderReadError,
} from "../record/reader/errors.ts";
import type { RecordWriteError } from "../record/writer/types.ts";
import { cacheKey } from "./fingerprint.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";
import { resolveAttemptTimeout } from "./timeout.ts";
import {
  planProjectTargetReuse,
  planProjectTargetReuseWithoutSources,
  projectTargetPolicyIdentity,
  type ExecutionDurationLimit,
  type ExecutionIdentity,
  type ExecutionReusePlan,
  type ExecutionReusePlanSlot,
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
  createRunnerSourceWritePlan,
  type RunnerSourceProducerInvalid,
} from "./source-producer.ts";
import { runnerAttemptWorkspaceDiffForResult } from "./sandbox-record-producer.ts";
import type {
  AgentRun,
  Attempt,
  Config,
  DiscoveredEval,
  EvalResult,
} from "./types.ts";

/** Current facts supplied by physical planning; Record never reconstructs them from history. */
export interface RunnerRecordReuseSlotInput {
  readonly inputIdentity: ExecutionIdentity;
  readonly configIdentity: ExecutionIdentity;
  readonly timeout?: ExecutionDurationLimit;
}

export interface RunnerRecordReuseInput {
  readonly policy: ProjectTargetPolicy;
  readonly slotsByKey: ReadonlyMap<string, RunnerRecordReuseSlotInput>;
}

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
 * Builds all current identity facts before any Record read. These values feed
 * the deterministic Core execution digest; they are not an Eligibility write.
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
          return Effect.fail({ code: "runner-record-target-input-missing" as const, key });
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
          ...(timeout === undefined ? {} : {
            timeout: Object.freeze({
              domain: "niceeval.execution-duration/v1",
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
  readonly slot: RecordSlotIdentity;
  readonly reuse: RunnerRecordReuseSlotInput;
}

interface PlannedRunnerRecordRun {
  readonly run: AgentRun;
  readonly experimentId: ExperimentId;
  readonly context: RunContext;
  readonly expectedSlots: readonly RecordSlotIdentity[];
  readonly slots: ReadonlyMap<string, PlannedRunnerRecordSlot>;
  readonly slotEntries: readonly PlannedRunnerRecordSlot[];
}

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
}

export interface RunnerRecordAttempt {
  readonly slotId: SlotId;
  readonly attemptId: import("../record/model/identifiers.ts").AttemptId;
  readonly locator: AttemptLocator;
}

export type RecordAttemptLocator = AttemptLocator;

export interface RunnerRecordAttemptInvalid {
  readonly code: "runner-record-attempt-invalid";
}

export interface RunnerRecordUnsealedAttempt {
  readonly code: "runner-record-attempt-unsealed";
  readonly slotId: SlotId;
}

export interface RunnerRecordTargetInputMissing {
  readonly code: "runner-record-target-input-missing";
  readonly key: string;
}

export interface RunnerRecordTargetIdentityInvalid {
  readonly code: "runner-record-target-identity-invalid";
  readonly kind: "invocation" | "slot" | "experiment" | "eval" | "digest" | "context";
  readonly value: string;
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
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
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

function slotKey(evalId: string, attempt: number): string {
  return `${evalId}\u0000${attempt}`;
}

function decodeId<Id>(input: {
  readonly schema: Schema.Schema<Id, string>;
  readonly value: string;
  readonly kind: RunnerRecordTargetIdentityInvalid["kind"];
}): Either.Either<Id, RunnerRecordTargetIdentityInvalid> {
  const decoded = Schema.decodeUnknownEither(input.schema)(input.value);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({
        code: "runner-record-target-identity-invalid" as const,
        kind: input.kind,
        value: input.value,
      }))
    : Either.right(decoded.right);
}

function asUtcMillis(value: number): Either.Either<UtcMillis, RunnerRecordTargetIdentityInvalid> {
  const decoded = Schema.decodeUnknownEither(UtcMillisSchema)(value);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({
        code: "runner-record-target-identity-invalid" as const,
        kind: "invocation" as const,
        value: String(value),
      }))
    : Either.right(decoded.right);
}

function runContextFor(
  run: AgentRun,
  experimentId: ExperimentId,
): Either.Either<RunContext, RunnerRecordTargetIdentityInvalid> {
  const context = canonicalizeRunContext({
    experimentId,
    execution: {
      agentId: run.agent.name,
      model: run.model ?? null,
      reasoningEffort: run.reasoningEffort ?? null,
      flags: run.flags,
    },
    labels: run.labels ?? {},
  });
  return Either.isLeft(context)
    ? Either.left(Object.freeze({
        code: "runner-record-target-identity-invalid" as const,
        kind: "context" as const,
        value: `invalid Run context for ${run.experimentId}`,
      }))
    : Either.right(context.right);
}

function executionIdentityDigest(input: {
  readonly run: AgentRun;
  readonly eval: DiscoveredEval;
  readonly attempt: number;
  readonly reuse: RunnerRecordReuseSlotInput;
}): Either.Either<ExecutionIdentityDigest, RunnerRecordTargetIdentityInvalid> {
  const value = slotExecutionIdentityDigestHex({
    experimentId: input.run.experimentId,
    evalId: input.eval.id,
    attempt: input.attempt,
    input: { domain: input.reuse.inputIdentity.domain, value: input.reuse.inputIdentity.value },
    config: { domain: input.reuse.configIdentity.domain, value: input.reuse.configIdentity.value },
    timeout: input.reuse.timeout === undefined
      ? null
      : { domain: input.reuse.timeout.domain, milliseconds: input.reuse.timeout.milliseconds },
  });
  return decodeId({ schema: ExecutionIdentityDigestSchema, value, kind: "digest" });
}

function planRun(input: {
  readonly run: AgentRun;
  readonly evals: readonly DiscoveredEval[];
  readonly reuse: RunnerRecordReuseInput;
}): Effect.Effect<
  PlannedRunnerRecordRun,
  RunnerRecordTargetInputMissing | RunnerRecordTargetIdentityInvalid
> {
  return Effect.suspend<
    PlannedRunnerRecordRun,
    RunnerRecordTargetInputMissing | RunnerRecordTargetIdentityInvalid,
    never
  >(() => {
    const experimentId = decodeId({
      schema: ExperimentIdSchema,
      value: input.run.experimentId,
      kind: "experiment",
    });
    if (Either.isLeft(experimentId)) return Effect.fail(experimentId.left);
    const context = runContextFor(input.run, experimentId.right);
    if (Either.isLeft(context)) return Effect.fail(context.left);
    const slots = new Map<string, PlannedRunnerRecordSlot>();
    const entries: PlannedRunnerRecordSlot[] = [];
    for (const evalDef of selectedEvalsForRun(input.evals, input.run)) {
      const reuse = input.reuse.slotsByKey.get(cacheKey(input.run, evalDef.id));
      if (reuse === undefined) {
        return Effect.fail({
          code: "runner-record-target-input-missing" as const,
          key: cacheKey(input.run, evalDef.id),
        });
      }
      const evalId = decodeId({ schema: EvalIdSchema, value: evalDef.id, kind: "eval" });
      if (Either.isLeft(evalId)) return Effect.fail(evalId.left);
      for (let attempt = 0; attempt < input.run.attempts; attempt += 1) {
        const digest = executionIdentityDigest({ run: input.run, eval: evalDef, attempt, reuse });
        if (Either.isLeft(digest)) return Effect.fail(digest.left);
        const slotId = decodeId({
          schema: SlotIdSchema,
          value: `slot-${digest.right}`,
          kind: "slot",
        });
        if (Either.isLeft(slotId)) return Effect.fail(slotId.left);
        const key = slotKey(evalDef.id, attempt);
        if (slots.has(key)) {
          return Effect.fail({
            code: "runner-record-target-identity-invalid" as const,
            kind: "slot" as const,
            value: key,
          });
        }
        const entry = Object.freeze({
          evalDef,
          attempt,
          slot: Object.freeze({
            slotId: slotId.right,
            evalId: evalId.right,
            attemptOrdinal: attempt,
            executionIdentityDigest: digest.right,
          }),
          reuse,
        });
        slots.set(key, entry);
        entries.push(entry);
      }
    }
    return Effect.succeed(Object.freeze({
      run: input.run,
      experimentId: experimentId.right,
      context: context.right,
      expectedSlots: Object.freeze([...entries]
        .map((entry) => entry.slot)
        .sort((left, right) => left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0)),
      slots,
      slotEntries: Object.freeze(entries),
    }));
  });
}

function previewRunId(run: AgentRun): Either.Either<RunId, RunnerRecordTargetIdentityInvalid> {
  const hash = createHash("sha256").update(run.experimentId, "utf8").digest("hex");
  return decodeId({ schema: RunIdSchema, value: `preview-${hash}`, kind: "invocation" });
}

function targetFor(input: {
  readonly planned: PlannedRunnerRecordRun;
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
}): TargetRun {
  return Object.freeze({
    runId: input.runId,
    experimentId: input.planned.run.experimentId,
    startedAt: input.startedAt,
    slots: Object.freeze(input.planned.slotEntries.map((entry) => Object.freeze({
      runId: input.runId,
      slotId: entry.slot.slotId,
      experimentId: input.planned.run.experimentId,
      evalId: entry.evalDef.id,
      attempt: entry.attempt,
      evaluationKind: entry.evalDef.evaluationKind,
      executionIdentityDigest: entry.slot.executionIdentityDigest,
      inputIdentity: entry.reuse.inputIdentity,
      configIdentity: entry.reuse.configIdentity,
      ...(entry.reuse.timeout === undefined ? {} : { timeout: entry.reuse.timeout }),
    } satisfies TargetSlot))),
  });
}

/** Current preview preserves the read Scope and never creates a Run directory. */
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
}): Effect.Effect<A, E | RunnerRecordOpenError, R | import("effect").Scope.Scope | import("../record/platform/services.ts").RecordFileSystem | import("../coordination/record-leases.ts").RecordCoordination> {
  return Effect.scoped(Effect.gen(function* () {
    const startedAt = asUtcMillis(input.startedAt);
    if (Either.isLeft(startedAt)) return yield* Effect.fail(startedAt.left);
    const planned = yield* Effect.forEach(input.runs, (run) => planRun({
      run,
      evals: input.evals,
      reuse: input.reuse,
    }), { concurrency: 1 });
    const previewRuns: TargetRun[] = [];
    for (const plan of planned) {
      const runId = previewRunId(plan.run);
      if (Either.isLeft(runId)) return yield* Effect.fail(runId.left);
      previewRuns.push(targetFor({ planned: plan, runId: runId.right, startedAt: startedAt.right }));
    }
    const target = Object.freeze({
      invocationId: `preview-${createHash("sha256").update(String(input.startedAt), "utf8").digest("hex")}`,
      runs: Object.freeze(previewRuns),
    });
    const fileSystem = yield* RecordFileSystem;
    const recordDocument = recordPortablePath(input.recordRoot, "record.json");
    if ((yield* fileSystem.pathKind(recordDocument)) === "missing") {
      const reusePlan = yield* planProjectTargetReuseWithoutSources({ target, policy: input.reuse.policy });
      return yield* input.use({
        reusePlan,
        readReadbacks: () => Effect.succeed(Object.freeze([])),
      });
    }
    const reader = yield* recordHost.current.openRead({ root: input.recordRoot });
    const reusePlan = yield* planProjectTargetReuse({ reader, target, policy: input.reuse.policy });
    return yield* input.use({
      reusePlan,
      readReadbacks: () => readCurrentExecutionReusePlanReadbacks({ reader, plan: reusePlan }),
    });
  }));
}

interface PreparedAssertionsWrite {
  readonly write: AssertionsWrite;
  readonly entryIds: readonly AssertionEntryId[];
}

function assertionsWrite(
  sealed: SealedAttemptAssertions,
  input: {
    readonly entryIds?: readonly AssertionEntryId[];
    readonly sourceSites?: readonly AssertionSourceSite[];
  } = {},
): Either.Either<PreparedAssertionsWrite, RunnerRecordAssertionsInvalid> {
  let entryIndex = 0;
  const entryIds: AssertionEntryId[] = [];
  const producer = createAssertionsAttachmentProducer<never, never>({
    entryIds: {
      next: () => input.entryIds?.[entryIndex++] ?? `ae_${randomBytes(10).toString("hex")}`,
    },
    write: assertionsRecordFamily.write,
  });
  for (const entry of sealed.entries) {
    const appended = producer.append(encodeSealedAssertionEntry(entry));
    if (Either.isLeft(appended)) {
      return Either.left(Object.freeze({
        code: "runner-record-assertions-invalid" as const,
        issue: appended.left,
      }));
    }
    entryIds.push(appended.right);
  }
  const complete = producer.seal({ sourceSites: input.sourceSites });
  return Either.isLeft(complete)
    ? Either.left(Object.freeze({
        code: "runner-record-assertions-invalid" as const,
        issue: complete.left,
      }))
    : Either.right(Object.freeze({
        write: complete.right,
        entryIds: Object.freeze(entryIds),
      }));
}

interface ArtifactCapture {
  readonly mediaType: string;
  readonly label: string;
  readonly bytes: Uint8Array;
}

function artifactsWrite<Owner extends "attempt" | "run">(input: {
  readonly owner: Owner;
  readonly write: FixedAttachmentWriteSpec<Owner, ArtifactsAttachment>;
  readonly artifacts: readonly ArtifactCapture[];
  readonly omittedAtLeast?: number;
}): Either.Either<RecordAttachmentWrite<Owner, never, never>, RunnerRecordArtifactsInvalid> {
  const write = makeFixedRecordAttachmentWrite(input.write, (blobs) => {
    const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
    const artifacts = input.artifacts.map((artifact) => {
      const bytes = new Uint8Array(artifact.bytes);
      const draft = blobs.add(makeRecordBlobSource(Stream.succeed(bytes)));
      drafts.push(draft);
      return Object.freeze({
        artifactId: `art_${randomBytes(10).toString("hex")}`,
        mediaType: artifact.mediaType,
        label: artifact.label,
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        content: draft.ref,
      });
    }).sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    const decoded = Schema.decodeUnknownEither(
      ArtifactsAttachmentSchema,
      RecordExactParseOptions,
    )(
      Object.freeze({
        collection: input.omittedAtLeast === undefined
          ? Object.freeze({ state: "complete" as const, limitations: [] as const })
          : Object.freeze({
              state: "partial" as const,
              limitations: Object.freeze([Object.freeze({
                code: "unsupported-input" as const,
                omittedAtLeast: input.omittedAtLeast,
              })]),
            }),
        artifacts: Object.freeze(artifacts),
      }),
    );
    if (Either.isLeft(decoded)) {
      throw new Error("Artifacts collector produced an invalid fixed-family payload");
    }
    return Object.freeze({ payload: decoded.right, blobs: Object.freeze(drafts) });
  });
  const closure = validateRecordAttachmentWrite(write);
  return Either.isLeft(closure)
    ? Either.left(Object.freeze({
        code: "runner-record-artifacts-invalid" as const,
        owner: input.owner,
        reason: "attachment-closure-invalid" as const,
      }))
    : Either.right(write);
}

function attemptArtifactsWrite(
  result: EvalResult,
): Either.Either<RecordAttachmentWrite<"attempt", never, never> | undefined, RunnerRecordArtifactsInvalid> {
  const captures: ArtifactCapture[] = [];
  let omittedAtLeast = 0;
  const appendJson = (label: string, value: unknown): void => {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(value);
    } catch {
      omittedAtLeast += 1;
      return;
    }
    if (encoded === undefined) {
      omittedAtLeast += 1;
      return;
    }
    const bytes = new TextEncoder().encode(encoded);
    if (bytes.byteLength > 64 * 1024 * 1024) {
      omittedAtLeast += 1;
      return;
    }
    captures.push(Object.freeze({
      mediaType: "application/json",
      label,
      bytes,
    }));
  };

  // This is the host-side receipt from a sandbox Agent setup callback. It is
  // deliberately an Artifact rather than Observability: it answers what was
  // installed, without making a sixth family or reconstructing sandbox files.
  if (result.agentSetup !== undefined) appendJson("agent-setup.json", result.agentSetup);
  if (result.trace !== undefined && result.trace.length > 0) {
    appendJson("otel-trace.json", result.trace);
  }

  // No collector input means the outer Host state stays `not-recorded`;
  // a known empty artifact collection would instead claim that one ran.
  if (captures.length === 0 && omittedAtLeast === 0) return Either.right(undefined);
  return artifactsWrite({
    owner: "attempt",
    write: attemptArtifactsRecordFamily.write,
    artifacts: Object.freeze(captures),
    ...(omittedAtLeast === 0 ? {} : { omittedAtLeast }),
  });
}

function runArtifactsWrite(): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  RunnerRecordArtifactsInvalid
> {
  return artifactsWrite({
    owner: "run",
    write: runArtifactsRecordFamily.write,
    artifacts: Object.freeze([]),
  });
}

function attemptObservabilityWrite(input: {
  readonly result: EvalResult;
  readonly sealed: SealedAttemptAssertions;
}): Effect.Effect<RecordAttachmentWrite<"attempt", never, never>, RunnerRecordObservabilityInvalid> {
  return Effect.gen(function* () {
    const capture = yield* createRunnerAttemptObservabilityCapture(input).pipe(
      Effect.mapError(() => Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "attempt" as const,
        stage: "capture" as const,
      })),
    );
    const write = createAttemptObservabilityAttachmentWrite(capture);
    if (Either.isLeft(write)) {
      return yield* Effect.fail(Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "attempt" as const,
        stage: "attachment" as const,
      }));
    }
    return write.right;
  });
}

function runObservabilityWrite(
  run: AgentRun,
): Effect.Effect<RecordAttachmentWrite<"run", never, never>, RunnerRecordObservabilityInvalid> {
  return Effect.gen(function* () {
    const capture = yield* createRunnerRunObservabilityCapture({ run }).pipe(
      Effect.mapError(() => Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "run" as const,
        stage: "capture" as const,
      })),
    );
    const write = createRunObservabilityAttachmentWrite(capture);
    if (Either.isLeft(write)) {
      return yield* Effect.fail(Object.freeze({
        code: "runner-record-observability-invalid" as const,
        owner: "run" as const,
        stage: "attachment" as const,
      }));
    }
    return write.right;
  });
}

function outcomeFor(result: EvalResult): "completed" | "errored" | "cancelled" {
  switch (result.verdict) {
    case "passed":
    case "failed":
      return "completed";
    case "errored":
      return "errored";
    case "skipped":
      return "cancelled";
  }
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
 * lock or legacy draft/attachment contract participates in this boundary.
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
    | import("../record/platform/services.ts").RecordFileSystem
    | import("../record/platform/services.ts").RecordEntropy
    | import("../coordination/record-leases.ts").RecordCoordination
> {
  return Effect.gen(function* () {
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
    const startedAt = asUtcMillis(input.startedAt);
    if (Either.isLeft(startedAt)) return yield* Effect.fail(startedAt.left);
    const planned = yield* Effect.forEach(input.runs, (run) => planRun({
      run,
      evals: input.evals,
      reuse: input.reuse,
    }), { concurrency: 1 });
    const openedRuns = yield* Effect.forEach(planned, (plan) => recordHost.current.createRun({
      root: input.recordRoot,
      experimentId: plan.experimentId,
      context: plan.context,
      startedAt: startedAt.right,
      expectedSlots: plan.expectedSlots,
    }).pipe(Effect.map((session) => Object.freeze({ plan, session }))), { concurrency: 1 });
    const reader = yield* recordHost.current.openRead({ root: input.recordRoot });
    const fileSystem = yield* RecordFileSystem;

    const byRun = new Map<AgentRun, RunnerRecordRun>();
    const byRecordRunId = new Map<RunId, RunnerRecordRun>();
    const runIdsByExperiment = new Map<string, string>();
    const targetRuns: TargetRun[] = [];
    for (const { plan, session } of openedRuns) {
      const target = targetFor({ planned: plan, runId: session.runId, startedAt: startedAt.right });
      const recordRun: RunnerRecordRun = {
        ...plan,
        session,
        target,
        attempts: new Map(),
        planSlots: new Map(),
        gapActions: new Map(),
      };
      byRun.set(plan.run, recordRun);
      byRecordRunId.set(session.runId, recordRun);
      runIdsByExperiment.set(plan.run.experimentId, session.runId);
      targetRuns.push(target);
    }
    const target = Object.freeze({
      invocationId: createHash("sha256")
        .update(`${input.startedAt}\u0000${planned.map((entry) => entry.run.experimentId).join("\u0000")}`, "utf8")
        .digest("hex"),
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
        const entry = recordRun.slots.get(slotKey(slot.evalId, slot.attempt));
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
    const lock = yield* Effect.makeSemaphore(1);
    const runForAttempt = (attempt: Attempt): RunnerRecordRun | undefined => byRun.get(attempt.run);
    const targetForAttempt = (attempt: Attempt): {
      readonly recordRun: RunnerRecordRun;
      readonly slotId: SlotId;
      readonly plan: ExecutionReusePlanSlot;
    } | undefined => {
      const recordRun = runForAttempt(attempt);
      if (recordRun === undefined) return undefined;
      const entry = recordRun.slots.get(slotKey(attempt.evalDef.id, attempt.attempt));
      if (entry === undefined) return undefined;
      const plan = recordRun.planSlots.get(entry.slot.slotId);
      return plan === undefined ? undefined : { recordRun, slotId: entry.slot.slotId, plan };
    };

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
        || active.sealed === undefined
        || active.completed
      ) {
        return Effect.fail(attemptInvalid());
      }
      const assertions = assertionsWrite(active.sealed);
      if (Either.isLeft(assertions)) return Effect.fail(assertions.left);
      return Effect.sync(() => {
        // Sources is Run-owned, so its exact closure and the dependent
        // Assertion source-site joins can only be fixed after all concurrent
        // origins in this Run have finished. The real Attempt is still
        // completed only after its fixed writes have been accepted below.
        active.result = result;
        active.assertionEntryIds = assertions.right.entryIds;
        active.completed = true;
        targetSlot.recordRun.gapActions.set(targetSlot.slotId, "executed");
        return active.public;
      });
    });

    const writeFixedFamiliesForRun = (
      recordRun: RunnerRecordRun,
    ): Effect.Effect<void, RunnerRecordWriteError> => Effect.gen(function* () {
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
        const result = active?.result;
        const sealed = active?.sealed;
        const assertionEntryIds = active?.assertionEntryIds;
        if (
          active === undefined
          || result === undefined
          || sealed === undefined
          || assertionEntryIds === undefined
        ) {
          return yield* Effect.fail(membershipStateInvalid(slotId));
        }
        origins.push(Object.freeze({ slotId, active, result, sealed, assertionEntryIds }));
      }

      const sources = createRunnerSourceWritePlan(origins.map(({ slotId, result, assertionEntryIds }) => Object.freeze({
        slotId,
        result,
        assertionEntryIds,
      })));
      if (Either.isLeft(sources)) {
        return yield* Effect.fail(Object.freeze({
          code: "runner-record-sources-invalid" as const,
          issue: sources.left,
        }));
      }
      yield* recordRun.session.writeSources(sources.right.runWrite);

      for (const { slotId, active, result, sealed, assertionEntryIds } of origins) {
        const assertions = assertionsWrite(sealed, {
          entryIds: assertionEntryIds,
          sourceSites: sources.right.sourceSitesBySlot.get(slotId) ?? Object.freeze([]),
        });
        if (Either.isLeft(assertions)) return yield* Effect.fail(assertions.left);
        yield* active.session.writeAssertions(assertions.right.write);

        const observability = yield* attemptObservabilityWrite({ result, sealed });
        yield* active.session.writeAttemptObservability(observability);

        const workspaceDiff = runnerAttemptWorkspaceDiffForResult(result);
        if (workspaceDiff !== undefined) {
          yield* active.session.writeFileChanges(
            createAgentWorkspaceDiffAttachmentWrite(workspaceDiff),
          );
        }

        const artifacts = attemptArtifactsWrite(result);
        if (Either.isLeft(artifacts)) return yield* Effect.fail(artifacts.left);
        if (artifacts.right !== undefined) {
          yield* active.session.writeAttemptArtifacts(artifacts.right);
        }
        yield* active.session.complete(outcomeFor(result));
      }

      const observability = yield* runObservabilityWrite(recordRun.run);
      yield* recordRun.session.writeRunObservability(observability);
      const artifacts = runArtifactsWrite();
      if (Either.isLeft(artifacts)) return yield* Effect.fail(artifacts.left);
      yield* recordRun.session.writeRunArtifacts(artifacts.right);
    });

    /**
     * A `reserved` slot owns a real Attempt directory. It remains unsettled
     * until `completeAttempt` has accepted the final Eval result. Keep this
     * distinct from a `pending` gap: the latter has never reserved an Attempt
     * and may become an interrupted terminal Member after SIGINT.
     */
    const hasUnsettledAttempt = (recordRun: RunnerRecordRun): boolean => {
      for (const [slotId, state] of recordRun.gapActions) {
        const active = recordRun.attempts.get(slotId);
        if (state === "reserved" || (active !== undefined && !active.completed)) return true;
      }
      return false;
    };

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
      carriedAttemptsByKey: new Map([...carriedAttemptsByKey].map(([key, attempts]) =>
        [key, new Set(attempts)] as const,
      )),
      reserveAttempt,
      noteSealedOrMarkIncomplete,
      completeAttemptOrMarkIncomplete: (attempt: Attempt, result: EvalResult) => completeAttempt(attempt, result).pipe(
        Effect.catchAll((error) => Effect.sync(() => {
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
        const completion = asUtcMillis(completedAt);
        if (Either.isLeft(completion)) return yield* Effect.fail(completion.left);

        // Freeze this before terminalizing pending gaps. A reserved/inflight
        // Attempt or a Run-local writer failure is a non-publishable Run, so
        // it must remain wholly incomplete on SIGINT; it must never be
        // relabeled as an interrupted Member merely because a sibling Run can
        // close. An un-attributable writer failure above remains global.
        const incompleteRuns = mode === "interrupted"
          ? new Set(recordRuns.filter((recordRun) =>
            hasUnsettledAttempt(recordRun) || writeFailuresByRun.has(recordRun),
          ))
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
            }
          }
        }

        const publishableRuns = recordRuns.filter((recordRun) => !incompleteRuns.has(recordRun));
        const publishOne = (recordRun: RunnerRecordRun): Effect.Effect<
          RecordSealReceipt,
          RunnerRecordWriteError
        > => Effect.gen(function* () {
          yield* writeFixedFamiliesForRun(recordRun);
          for (const [slotId, state] of recordRun.gapActions) {
            if (state === "not-dispatched" || state === "interrupted") {
              yield* recordRun.session.recordTerminalMember({ slotId, action: state });
            }
          }
          return yield* recordRun.session.seal({ completedAt: completion.right });
        });

        if (mode === "normal") {
          // Normal completion remains typed and strict: the first Run failure
          // is an invocation failure, never a partial success receipt.
          return yield* Effect.forEach(publishableRuns, publishOne, { concurrency: 1 });
        }

        // SIGINT is different: each clean sibling receives its own complete
        // attempt. We deliberately observe an Exit per Run so one fixed-family
        // or seal error cannot short-circuit subsequent safe siblings.
        const receipts: RecordSealReceipt[] = [];
        for (const recordRun of publishableRuns) {
          const exit = yield* Effect.exit(publishOne(recordRun));
          if (!Exit.isSuccess(exit)) {
            const failure = Cause.failureOption(exit.cause);
            if (Option.isSome(failure)) noteFailure(failure.value, recordRun);
          }
          const markerExit = yield* Effect.exit(fileSystem.pathKind(recordPortablePath(
            input.recordRoot,
            "runs",
            recordRun.session.runId,
            "complete",
          )));
          if (Exit.isSuccess(markerExit) && markerExit.value === "file") {
            // `seal` can fail during a post-marker directory sync. The marker,
            // not its return value, is the durable publication truth.
            receipts.push(Object.freeze({ runId: recordRun.session.runId, state: "sealed" as const }));
          } else if (!Exit.isSuccess(markerExit)) {
            const markerFailure = Cause.failureOption(markerExit.cause);
            if (Option.isSome(markerFailure)) {
              noteFailure(markerFailure.value, recordRun);
            } else {
              noteFailure(publishStateInvalid(recordRun.session.runId), recordRun);
            }
          } else if (Exit.isSuccess(exit)) {
            noteFailure(publishStateInvalid(recordRun.session.runId), recordRun);
          } else if (Cause.isEmpty(exit.cause)) {
            noteFailure(publishStateInvalid(recordRun.session.runId), recordRun);
          }
        }
        return Object.freeze(receipts);
      }),
    });
  });
}
