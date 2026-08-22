import { randomBytes } from "node:crypto";
import { Effect, Either } from "effect";
import {
  createAssertionsAttachmentProducer,
  encodeSealedAssertionEntry,
} from "../../assertions/record/attachment.ts";
import { createAgentWorkspaceDiffAttachmentWrite } from "../../assertions/record/diff.ts";
import type { SealedAttemptAssertions } from "../../assertions/api.ts";
import type { AssertionsProducerError } from "../../assertions/record/producer.ts";
import { recordAttachmentWriteContents } from "../../record/attachment/internal.ts";
import type { RecordAttachmentClosureInvalid, RecordAttachmentWrite } from "../../record/attachment/index.ts";
import {
  assertionsRecordFamily,
  attemptArtifactsRecordFamily,
  attemptObservabilityRecordFamily,
  fileChangesRecordFamily,
  runArtifactsRecordFamily,
  runObservabilityRecordFamily,
  sourcesRecordFamily,
  type AssertionSourceSite,
} from "../../record/family/index.ts";
import type { RecordSlotIdentity } from "../../record/model/core.ts";
import type { RunContext } from "../../record/model/run-context.ts";
import type { ExperimentId, SlotId, UtcMillis } from "../../record/model/identifiers.ts";
import type { FrozenRecordAttempt } from "../../record/reader/types.ts";
import type {
  RecordAttemptDraft,
  RecordPublishReceipt,
  RecordRunDraft,
  RecordWriteError,
  RecordWriteSession,
} from "../../record/writer/types.ts";

/** A sealed origin only brings fixed-family writes to Record v1. */
export interface EvaluationRecordOriginAttemptInput<Error = never, Requirements = never> {
  readonly slotId: SlotId;
  readonly assertions: RecordAttachmentWrite<"attempt", Error, Requirements>;
  readonly writes?: readonly RecordAttachmentWrite<"attempt", Error, Requirements>[];
}

export interface EvaluationRecordReferenceInput {
  readonly slotId: SlotId;
  readonly action: "carried" | "accepted";
  readonly attempt: FrozenRecordAttempt;
}

/**
 * Evaluation/evaluation-plan are not durable families. The immutable plan
 * identity is supplied as Core expectedSlots and only fixed attachments may
 * cross this sealing boundary.
 */
export interface EvaluationRecordPlanInput<Error = never, Requirements = never> {
  readonly experimentId: ExperimentId;
  readonly context: RunContext;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
  readonly originAttempts: readonly EvaluationRecordOriginAttemptInput<Error, Requirements>[];
  readonly references?: readonly EvaluationRecordReferenceInput[];
  readonly runWrites?: readonly RecordAttachmentWrite<"run", Error, Requirements>[];
}

export type SealedAssertionsOriginEncodingError =
  | { readonly code: "assertions-attachment-invalid"; readonly issue: AssertionsProducerError }
  | { readonly code: "workspace-diff-attachment-invalid"; readonly message: string };

function assertionEntryId(): string {
  return `ae_${randomBytes(10).toString("hex")}`;
}

/**
 * The runtime Assertion fold is mapped directly into the fixed Assertions
 * family. A workspace diff, when collected, is its own fixed File Changes
 * write; Assertions never carry a cross-family blob/reference capability.
 */
export function evaluationRecordOriginInputFromSealedAssertions(
  slotId: SlotId,
  sealed: SealedAttemptAssertions,
  input?: { readonly sourceSites?: readonly AssertionSourceSite[] },
): Either.Either<EvaluationRecordOriginAttemptInput, SealedAssertionsOriginEncodingError> {
  const producer = createAssertionsAttachmentProducer<never, never>({
    entryIds: { next: assertionEntryId },
    write: assertionsRecordFamily.write,
  });
  for (const entry of sealed.entries) {
    const appended = producer.append(encodeSealedAssertionEntry(entry));
    if (Either.isLeft(appended)) {
      return Either.left(Object.freeze({ code: "assertions-attachment-invalid" as const, issue: appended.left }));
    }
  }
  const assertions = producer.seal(input);
  if (Either.isLeft(assertions)) {
    return Either.left(Object.freeze({ code: "assertions-attachment-invalid" as const, issue: assertions.left }));
  }
  if (sealed.workspaceDiff === undefined) {
    return Either.right(Object.freeze({ slotId, assertions: assertions.right }));
  }
  try {
    return Either.right(Object.freeze({
      slotId,
      assertions: assertions.right,
      writes: Object.freeze([createAgentWorkspaceDiffAttachmentWrite(sealed.workspaceDiff)]),
    }));
  } catch (error) {
    return Either.left(Object.freeze({
      code: "workspace-diff-attachment-invalid" as const,
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

export type EvaluationRecordContractIssue =
  | { readonly code: "evaluation-record-write-closure-invalid"; readonly owner: "run" | "attempt"; readonly slotId?: SlotId; readonly issue: RecordAttachmentClosureInvalid }
  | { readonly code: "evaluation-record-family-not-fixed"; readonly owner: "run" | "attempt"; readonly slotId?: SlotId }
  | { readonly code: "evaluation-record-family-duplicate"; readonly owner: "run" | "attempt"; readonly family: string; readonly slotId?: SlotId }
  | { readonly code: "evaluation-record-assertions-write-invalid"; readonly slotId: SlotId }
  | { readonly code: "evaluation-record-member-slot-unexpected"; readonly slotId: SlotId }
  | { readonly code: "evaluation-record-member-slot-duplicate"; readonly slotId: SlotId };

export interface EvaluationRecordContractInvalid {
  readonly code: "evaluation-record-contract-invalid";
  readonly issues: readonly EvaluationRecordContractIssue[];
}
export interface EvaluationRecordPlanInvalid { readonly code: "evaluation-record-plan-invalid"; }
export interface EvaluationRecordOriginDraftMissing { readonly code: "evaluation-record-origin-draft-missing"; readonly slotId: SlotId; }

const evaluationRecordPlanBrand: unique symbol = Symbol("@niceeval/eval/EvaluationRecordPlan");
export interface EvaluationRecordPlan<Error = never, Requirements = never> {
  readonly [evaluationRecordPlanBrand]: () => void;
}

interface EvaluationRecordPlanRuntime<Error, Requirements> {
  readonly experimentId: ExperimentId;
  readonly context: RunContext;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
  readonly runWrites: readonly RecordAttachmentWrite<"run", Error, Requirements>[];
  readonly originAttempts: readonly {
    readonly slotId: SlotId;
    readonly writes: readonly RecordAttachmentWrite<"attempt", Error, Requirements>[];
  }[];
  readonly references: readonly EvaluationRecordReferenceInput[];
}
const planRuntimes = new WeakMap<object, unknown>();

function planInvalid(): EvaluationRecordPlanInvalid {
  return Object.freeze({ code: "evaluation-record-plan-invalid" as const });
}
function contractInvalid(issues: readonly EvaluationRecordContractIssue[]): EvaluationRecordContractInvalid {
  return Object.freeze({ code: "evaluation-record-contract-invalid" as const, issues: Object.freeze([...issues]) });
}
function planRuntime<Error, Requirements>(plan: EvaluationRecordPlan<Error, Requirements>): EvaluationRecordPlanRuntime<Error, Requirements> | undefined {
  const value = planRuntimes.get(plan);
  return value as EvaluationRecordPlanRuntime<Error, Requirements> | undefined;
}

function fixedAttemptFamily(fixed: unknown): string | undefined {
  if (fixed === assertionsRecordFamily.write) return assertionsRecordFamily.family;
  if (fixed === attemptObservabilityRecordFamily.write) return attemptObservabilityRecordFamily.family;
  if (fixed === fileChangesRecordFamily.write) return fileChangesRecordFamily.family;
  if (fixed === attemptArtifactsRecordFamily.write) return attemptArtifactsRecordFamily.family;
  return undefined;
}
function fixedRunFamily(fixed: unknown): string | undefined {
  if (fixed === runObservabilityRecordFamily.write) return runObservabilityRecordFamily.family;
  if (fixed === sourcesRecordFamily.write) return sourcesRecordFamily.family;
  if (fixed === runArtifactsRecordFamily.write) return runArtifactsRecordFamily.family;
  return undefined;
}

function validateFixedWrites<Owner extends "run" | "attempt", Error, Requirements>(input: {
  readonly owner: Owner;
  readonly slotId?: SlotId;
  readonly writes: readonly RecordAttachmentWrite<Owner, Error, Requirements>[];
}): readonly EvaluationRecordContractIssue[] {
  const issues: EvaluationRecordContractIssue[] = [];
  const seen = new Set<string>();
  for (const write of input.writes) {
    const contents = recordAttachmentWriteContents(write);
    if (Either.isLeft(contents)) {
      issues.push(Object.freeze({ code: "evaluation-record-write-closure-invalid" as const, owner: input.owner, ...(input.slotId === undefined ? {} : { slotId: input.slotId }), issue: contents.left }));
      continue;
    }
    const family = input.owner === "attempt"
      ? fixedAttemptFamily(contents.right.fixed)
      : fixedRunFamily(contents.right.fixed);
    if (family === undefined) {
      issues.push(Object.freeze({ code: "evaluation-record-family-not-fixed" as const, owner: input.owner, ...(input.slotId === undefined ? {} : { slotId: input.slotId }) }));
      continue;
    }
    if (seen.has(family)) {
      issues.push(Object.freeze({ code: "evaluation-record-family-duplicate" as const, owner: input.owner, family, ...(input.slotId === undefined ? {} : { slotId: input.slotId }) }));
    }
    seen.add(family);
  }
  return Object.freeze(issues);
}

export function createEvaluationRecordPlan<Error, Requirements>(
  input: EvaluationRecordPlanInput<Error, Requirements>,
): Either.Either<EvaluationRecordPlan<Error, Requirements>, EvaluationRecordContractInvalid> {
  const issues: EvaluationRecordContractIssue[] = [];
  const expected = new Set<string>();
  for (const slot of input.expectedSlots) {
    if (expected.has(slot.slotId)) issues.push(Object.freeze({ code: "evaluation-record-member-slot-duplicate" as const, slotId: slot.slotId }));
    expected.add(slot.slotId);
  }

  const occupied = new Set<string>();
  const origins: { readonly slotId: SlotId; readonly writes: readonly RecordAttachmentWrite<"attempt", Error, Requirements>[] }[] = [];
  for (const origin of input.originAttempts) {
    if (!expected.has(origin.slotId)) {
      issues.push(Object.freeze({ code: "evaluation-record-member-slot-unexpected" as const, slotId: origin.slotId }));
      continue;
    }
    if (occupied.has(origin.slotId)) {
      issues.push(Object.freeze({ code: "evaluation-record-member-slot-duplicate" as const, slotId: origin.slotId }));
      continue;
    }
    occupied.add(origin.slotId);
    const writes = Object.freeze([origin.assertions, ...(origin.writes ?? [])]);
    const assertion = recordAttachmentWriteContents(origin.assertions);
    if (Either.isLeft(assertion) || assertion.right.fixed !== assertionsRecordFamily.write) {
      issues.push(Object.freeze({ code: "evaluation-record-assertions-write-invalid" as const, slotId: origin.slotId }));
    }
    issues.push(...validateFixedWrites({ owner: "attempt", slotId: origin.slotId, writes }));
    origins.push(Object.freeze({ slotId: origin.slotId, writes }));
  }

  const references: EvaluationRecordReferenceInput[] = [];
  for (const reference of input.references ?? []) {
    if (!expected.has(reference.slotId)) {
      issues.push(Object.freeze({ code: "evaluation-record-member-slot-unexpected" as const, slotId: reference.slotId }));
      continue;
    }
    if (occupied.has(reference.slotId)) {
      issues.push(Object.freeze({ code: "evaluation-record-member-slot-duplicate" as const, slotId: reference.slotId }));
      continue;
    }
    occupied.add(reference.slotId);
    references.push(Object.freeze({ ...reference }));
  }

  const runWrites = Object.freeze([...(input.runWrites ?? [])]);
  issues.push(...validateFixedWrites({ owner: "run", writes: runWrites }));
  if (issues.length > 0) return Either.left(contractInvalid(issues));

  const plan: EvaluationRecordPlan<Error, Requirements> = Object.freeze({ [evaluationRecordPlanBrand]: () => undefined });
  planRuntimes.set(plan, Object.freeze({
    experimentId: input.experimentId,
    context: input.context,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    expectedSlots: Object.freeze([...input.expectedSlots]),
    runWrites,
    originAttempts: Object.freeze(origins),
    references: Object.freeze(references),
  } satisfies EvaluationRecordPlanRuntime<Error, Requirements>));
  return Either.right(plan);
}

export function prepareEvaluationRecordPlan<Error, Requirements>(input: EvaluationRecordPlanInput<Error, Requirements>): Effect.Effect<EvaluationRecordPlan<Error, Requirements>, EvaluationRecordContractInvalid> {
  return Effect.suspend(() => {
    const plan = createEvaluationRecordPlan(input);
    return Either.isLeft(plan) ? Effect.fail(plan.left) : Effect.succeed(plan.right);
  });
}

export function writeEvaluationRecordPlan<Error, Requirements>(session: RecordWriteSession, plan: EvaluationRecordPlan<Error, Requirements>): Effect.Effect<RecordPublishReceipt, EvaluationRecordPlanInvalid | EvaluationRecordOriginDraftMissing | RecordWriteError | Error, Requirements> {
  return Effect.suspend(() => {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return Effect.fail(planInvalid());
    return Effect.flatMap(session.createRun({
      experimentId: runtime.experimentId,
      context: runtime.context,
      startedAt: runtime.startedAt,
      expectedSlots: runtime.expectedSlots,
    }),
      (draft) => writeEvaluationRecordPlanToDraft(draft, plan));
  });
}

export function writeEvaluationRecordPlanToDraft<Error, Requirements>(draft: RecordRunDraft, plan: EvaluationRecordPlan<Error, Requirements>): Effect.Effect<RecordPublishReceipt, EvaluationRecordPlanInvalid | EvaluationRecordOriginDraftMissing | RecordWriteError | Error, Requirements> {
  return Effect.gen(function* () {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return yield* Effect.fail(planInvalid());
    yield* writeEvaluationRecordPlanRunToDraft(draft, plan);
    const attempts = new Map<SlotId, RecordAttemptDraft>();
    for (const origin of runtime.originAttempts) attempts.set(origin.slotId, yield* draft.createAttempt({ slotId: origin.slotId }));
    yield* writeEvaluationRecordPlanOriginsToAttempts(attempts, plan);
    yield* writeEvaluationRecordPlanReferencesToDraft(draft, plan);
    return yield* draft.publish({ completedAt: runtime.completedAt });
  });
}

export function writeEvaluationRecordPlanRunToDraft<Error, Requirements>(draft: RecordRunDraft, plan: EvaluationRecordPlan<Error, Requirements>): Effect.Effect<void, EvaluationRecordPlanInvalid | RecordWriteError | Error, Requirements> {
  return Effect.gen(function* () {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return yield* Effect.fail(planInvalid());
    yield* Effect.forEach(runtime.runWrites, (write) => draft.record(write), { discard: true });
  });
}

export function writeEvaluationRecordPlanOriginsToAttempts<Error, Requirements>(attempts: ReadonlyMap<SlotId, RecordAttemptDraft>, plan: EvaluationRecordPlan<Error, Requirements>): Effect.Effect<void, EvaluationRecordPlanInvalid | EvaluationRecordOriginDraftMissing | RecordWriteError | Error, Requirements> {
  return Effect.gen(function* () {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return yield* Effect.fail(planInvalid());
    for (const origin of runtime.originAttempts) {
      const attempt = attempts.get(origin.slotId);
      if (attempt === undefined) {
        return yield* Effect.fail<EvaluationRecordOriginDraftMissing>({
          code: "evaluation-record-origin-draft-missing",
          slotId: origin.slotId,
        });
      }
      for (const write of origin.writes) yield* attempt.record(write);
    }
  });
}

export function writeEvaluationRecordPlanReferencesToDraft<Error, Requirements>(draft: RecordRunDraft, plan: EvaluationRecordPlan<Error, Requirements>): Effect.Effect<void, EvaluationRecordPlanInvalid | RecordWriteError> {
  return Effect.gen(function* () {
    const runtime = planRuntime(plan);
    if (runtime === undefined) return yield* Effect.fail(planInvalid());
    yield* Effect.forEach(runtime.references, (reference) => draft.reference(reference), { discard: true });
  });
}

export const EvaluationRecordContract = Object.freeze({
  createPlan: createEvaluationRecordPlan,
  preparePlan: prepareEvaluationRecordPlan,
  writePlan: writeEvaluationRecordPlan,
  writePlanToDraft: writeEvaluationRecordPlanToDraft,
  writePlanRunToDraft: writeEvaluationRecordPlanRunToDraft,
  writePlanOriginsToAttempts: writeEvaluationRecordPlanOriginsToAttempts,
  writePlanReferencesToDraft: writeEvaluationRecordPlanReferencesToDraft,
});
