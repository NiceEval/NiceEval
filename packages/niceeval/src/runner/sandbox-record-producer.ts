import { Either } from "effect";

import {
  normalizeSandboxCapture,
  type SandboxCaptureInput,
  type SandboxCaptureInputError,
} from "../sandbox/record/attachment.ts";
import {
  compareCanonicalIdentity,
  type SlotId,
} from "../record/model/identifiers.ts";
import type { FileChangesCapture } from "../assertions/record/diff.ts";
import type { EvalResult } from "./types.ts";

/**
 * The fixed Record File Changes capture is deliberately separate from the
 * Assertion-only late workspace document. It survives normal failure and
 * interruption without reopening an already sealed Assertion/Verdict.
 */
const fileChangesCaptureByResult = new WeakMap<object, FileChangesCapture>();

export function retainRunnerAttemptFileChangesCapture(
  result: EvalResult,
  capture: FileChangesCapture,
): EvalResult {
  fileChangesCaptureByResult.set(result, capture);
  return result;
}

export function runnerAttemptFileChangesCaptureForResult(
  result: EvalResult,
): FileChangesCapture | undefined {
  return fileChangesCaptureByResult.get(result);
}

/** A completed origin supplies only the runtime Sandbox fact needed by Record. */
export interface RunnerSandboxOriginInput {
  readonly slotId: SlotId;
  readonly sandbox: EvalResult["sandbox"];
}

export interface RunnerSandboxRecordProducerInvalid {
  readonly code: "runner-sandbox-record-producer-invalid";
  readonly slotId: SlotId;
  readonly reason:
    | "origin-slot-duplicate"
    | "sandbox-reuse-shape-invalid"
    | "pooled-ordinal-duplicate"
    | "pooled-identity-missing";
}

export interface RunnerSandboxAttachmentWriteInvalid {
  readonly code: "runner-sandbox-attachment-write-invalid";
  readonly slotId: SlotId;
  readonly issue: SandboxCaptureInputError;
}

export type RunnerSandboxRecordProducerError =
  | RunnerSandboxRecordProducerInvalid
  | RunnerSandboxAttachmentWriteInvalid;

export interface RunnerSandboxWritePlan {
  readonly validatedSlots: readonly SlotId[];
}

type PlannedSandboxOrigin =
  | {
      readonly kind: "not-used";
      readonly slotId: SlotId;
    }
  | {
      readonly kind: "fresh";
      readonly slotId: SlotId;
      readonly provider: string;
      readonly sandboxId: string;
    }
  | {
      readonly kind: "pooled";
      readonly slotId: SlotId;
      readonly provider: string;
      readonly sandboxId: string;
      readonly ordinal: number;
    };

interface PooledIdentity {
  readonly provider: string;
  readonly sandboxId: string;
  readonly ordinals: Map<number, SlotId>;
}

function producerInvalid(
  slotId: SlotId,
  reason: RunnerSandboxRecordProducerInvalid["reason"],
): RunnerSandboxRecordProducerInvalid {
  return Object.freeze({
    code: "runner-sandbox-record-producer-invalid" as const,
    slotId,
    reason,
  });
}

function attachmentWriteInvalid(
  slotId: SlotId,
  issue: SandboxCaptureInputError,
): RunnerSandboxAttachmentWriteInvalid {
  return Object.freeze({
    code: "runner-sandbox-attachment-write-invalid" as const,
    slotId,
    issue,
  });
}

function positiveSafeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function planOrigin(
  input: RunnerSandboxOriginInput,
): Either.Either<PlannedSandboxOrigin, RunnerSandboxRecordProducerInvalid> {
  const sandbox = input.sandbox;
  if (sandbox === undefined) {
    return Either.right(Object.freeze({ kind: "not-used" as const, slotId: input.slotId }));
  }

  if (sandbox.reused === true) {
    if (
      !positiveSafeInteger(sandbox.reuseSandbox)
      || !positiveSafeInteger(sandbox.reuseOrdinal)
    ) {
      return Either.left(producerInvalid(input.slotId, "sandbox-reuse-shape-invalid"));
    }
    return Either.right(Object.freeze({
      kind: "pooled" as const,
      slotId: input.slotId,
      provider: sandbox.provider,
      sandboxId: sandbox.sandboxId,
      ordinal: sandbox.reuseOrdinal,
    }));
  }

  if (
    sandbox.reused !== undefined
    || sandbox.reuseSandbox !== undefined
    || sandbox.reuseOrdinal !== undefined
  ) {
    return Either.left(producerInvalid(input.slotId, "sandbox-reuse-shape-invalid"));
  }

  return Either.right(Object.freeze({
    kind: "fresh" as const,
    slotId: input.slotId,
    provider: sandbox.provider,
    sandboxId: sandbox.sandboxId,
  }));
}

function identityKey(provider: string, sandboxId: string): string {
  return JSON.stringify([provider, sandboxId]);
}

function comparePooledIdentity(left: PooledIdentity, right: PooledIdentity): number {
  const provider = compareCanonicalIdentity(left.provider, right.provider);
  return provider === 0
    ? compareCanonicalIdentity(left.sandboxId, right.sandboxId)
    : provider;
}

function sandboxAttachmentInput(
  origin: PlannedSandboxOrigin,
  pooledNumbers: ReadonlyMap<string, number>,
): Either.Either<SandboxCaptureInput, RunnerSandboxRecordProducerInvalid> {
  switch (origin.kind) {
    case "not-used":
      return Either.right(Object.freeze({ state: "not-used" as const }));
    case "fresh":
      return Either.right(Object.freeze({
        state: "assigned" as const,
        provider: origin.provider,
        sandboxId: origin.sandboxId,
        reuse: Object.freeze({ kind: "fresh" as const }),
      }));
    case "pooled": {
      const sandbox = pooledNumbers.get(identityKey(origin.provider, origin.sandboxId));
      if (sandbox === undefined) {
        return Either.left(producerInvalid(origin.slotId, "pooled-identity-missing"));
      }
      return Either.right(Object.freeze({
        state: "assigned" as const,
        provider: origin.provider,
        sandboxId: origin.sandboxId,
        reuse: Object.freeze({
          kind: "pooled" as const,
          sandbox,
          ordinal: origin.ordinal,
        }),
      }));
    }
  }
}

/**
 * Produces the one Sandbox Attachment for each completed origin in one Record
 * Run. Pooled numbers are derived from canonical physical identities, never
 * from a pool-local allocation counter.
 */
export function createRunnerSandboxWritePlan(
  origins: readonly RunnerSandboxOriginInput[],
): Either.Either<RunnerSandboxWritePlan, RunnerSandboxRecordProducerError> {
  const plannedBySlot = new Map<SlotId, PlannedSandboxOrigin>();
  const pooledByIdentity = new Map<string, PooledIdentity>();

  for (const input of origins) {
    if (plannedBySlot.has(input.slotId)) {
      return Either.left(producerInvalid(input.slotId, "origin-slot-duplicate"));
    }
    const planned = planOrigin(input);
    if (Either.isLeft(planned)) return Either.left(planned.left);
    plannedBySlot.set(input.slotId, planned.right);

    if (planned.right.kind !== "pooled") continue;
    const key = identityKey(planned.right.provider, planned.right.sandboxId);
    const pooled = pooledByIdentity.get(key) ?? {
      provider: planned.right.provider,
      sandboxId: planned.right.sandboxId,
      ordinals: new Map<number, SlotId>(),
    };
    if (pooled.ordinals.has(planned.right.ordinal)) {
      return Either.left(producerInvalid(input.slotId, "pooled-ordinal-duplicate"));
    }
    pooled.ordinals.set(planned.right.ordinal, input.slotId);
    pooledByIdentity.set(key, pooled);
  }

  const orderedPooled = [...pooledByIdentity.values()].sort(comparePooledIdentity);
  const pooledNumbers = new Map<string, number>();
  for (const [index, pooled] of orderedPooled.entries()) {
    // The provider's lease order can have absent origins, so only duplicate
    // ordinals are incoherent within the completed facts available here.
    pooledNumbers.set(identityKey(pooled.provider, pooled.sandboxId), index + 1);
  }

  const validatedSlots: SlotId[] = [];
  for (const origin of plannedBySlot.values()) {
    const input = sandboxAttachmentInput(origin, pooledNumbers);
    if (Either.isLeft(input)) return Either.left(input.left);
    const normalized = normalizeSandboxCapture(input.right);
    if (Either.isLeft(normalized)) {
      return Either.left(attachmentWriteInvalid(origin.slotId, normalized.left));
    }
    validatedSlots.push(origin.slotId);
  }

  return Either.right(Object.freeze({ validatedSlots: Object.freeze(validatedSlots) }));
}
