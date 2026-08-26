import { createHash } from "node:crypto";

import { Effect, Either, Schema } from "effect";

import { slotExecutionIdentityDigestHex } from "../execution-identity.ts";
import { cacheKey } from "../fingerprint.ts";
import { selectedEvalsForRun } from "../eval-selection.ts";
import { resolveAttemptTimeout } from "../timeout.ts";
import {
  projectTargetPolicyIdentity,
  type ExecutionDurationLimit,
  type ExecutionIdentity,
  type ProjectTargetPolicy,
  type TargetRun,
  type TargetSlot,
} from "../reuse-plan.ts";
import type { AgentRun, Config, DiscoveredEval } from "../types.ts";
import {
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  ExperimentIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../../record/codec/identifiers.ts";
import type { RecordSlotIdentity } from "../../record/model/core.ts";
import {
  canonicalizeRunContext,
  type RunContext,
} from "../../record/model/run-context.ts";
import type {
  ExecutionIdentityDigest,
  ExperimentId,
  RunId,
  UtcMillis,
} from "../../record/model/identifiers.ts";

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

export interface RunnerRecordTargetInputMissing {
  readonly code: "runner-record-target-input-missing";
  readonly key: string;
}

export interface RunnerRecordTargetIdentityInvalid {
  readonly code: "runner-record-target-identity-invalid";
  readonly kind: "invocation" | "slot" | "experiment" | "eval" | "digest" | "context";
  readonly value: string;
}

export interface PlannedRunnerRecordSlot {
  readonly evalDef: DiscoveredEval;
  readonly attempt: number;
  readonly slot: RecordSlotIdentity;
  readonly reuse: RunnerRecordReuseSlotInput;
}

export interface PlannedRunnerRecordRun {
  readonly run: AgentRun;
  readonly experimentId: ExperimentId;
  readonly context: RunContext;
  readonly expectedSlots: readonly RecordSlotIdentity[];
  readonly slots: ReadonlyMap<string, PlannedRunnerRecordSlot>;
  readonly slotEntries: readonly PlannedRunnerRecordSlot[];
}

const runnerReuseContract = Object.freeze({
  domain: "niceeval.reuse/base-v1",
  value: "project-target/v1",
});

export function runnerRecordSlotKey(evalId: string, attempt: number): string {
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

export function runnerRecordUtcMillis(
  value: number,
): Either.Either<UtcMillis, RunnerRecordTargetIdentityInvalid> {
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

export function planRunnerRecordRun(input: {
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
        const key = runnerRecordSlotKey(evalDef.id, attempt);
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

export function previewRunnerRunId(
  run: AgentRun,
): Either.Either<RunId, RunnerRecordTargetIdentityInvalid> {
  const hash = createHash("sha256").update(run.experimentId, "utf8").digest("hex");
  return decodeId({ schema: RunIdSchema, value: `preview-${hash}`, kind: "invocation" });
}

export function targetForRunnerRecordRun(input: {
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
