import { Either, Schema } from "effect";
import { SlotIdSchema } from "../../record/codec/identifiers.ts";
import { compareCanonicalIdentity, type SlotId } from "../../record/model/identifiers.ts";
import {
  EvaluationRecordIdentitySchema,
  ExactEvaluationParseOptions,
} from "./attachment.ts";

/**
 * Eval-to-slot planning is transient. Core carries the immutable Slot identity
 * once a Run is created; no evaluations Attachment exists in Record v1.
 */
export const EvaluationKindSchema = Schema.Literal("pass", "score");
export type EvaluationKind = Schema.Schema.Type<typeof EvaluationKindSchema>;
export type EvaluationId = Schema.Schema.Type<typeof EvaluationRecordIdentitySchema>;
export type ExperimentId = Schema.Schema.Type<typeof EvaluationRecordIdentitySchema>;

export const EvaluationAttemptOrdinalSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
);
export type EvaluationAttemptOrdinal = Schema.Schema.Type<typeof EvaluationAttemptOrdinalSchema>;

export const EvaluationSlotSchema = Schema.Struct({
  slotId: SlotIdSchema,
  attempt: EvaluationAttemptOrdinalSchema,
});
export type EvaluationSlot = Schema.Schema.Type<typeof EvaluationSlotSchema>;
export type EvaluationSlotEncoded = Schema.Schema.Encoded<typeof EvaluationSlotSchema>;

export const EvaluationDefinitionSchema = Schema.Struct({
  evalId: EvaluationRecordIdentitySchema,
  evaluationKind: EvaluationKindSchema,
  slots: Schema.NonEmptyArray(EvaluationSlotSchema),
});
export type EvaluationDefinition = Schema.Schema.Type<typeof EvaluationDefinitionSchema>;
export type EvaluationDefinitionEncoded = Schema.Schema.Encoded<typeof EvaluationDefinitionSchema>;

const EvaluationsPayloadStructuralSchema = Schema.Struct({
  experimentId: EvaluationRecordIdentitySchema,
  evaluations: Schema.Array(EvaluationDefinitionSchema),
});
export type EvaluationsPayload = Schema.Schema.Type<typeof EvaluationsPayloadStructuralSchema>;
export type EvaluationsPayloadEncoded = Schema.Schema.Encoded<typeof EvaluationsPayloadStructuralSchema>;

export type EvaluationsPayloadIssue =
  | { readonly code: "evaluations-eval-order-invalid"; readonly index: number; readonly evalId: EvaluationId }
  | { readonly code: "evaluations-eval-duplicate"; readonly evalId: EvaluationId }
  | { readonly code: "evaluations-slot-order-invalid"; readonly evalId: EvaluationId; readonly index: number; readonly slotId: SlotId }
  | { readonly code: "evaluations-slot-duplicate"; readonly slotId: SlotId }
  | { readonly code: "evaluations-attempt-duplicate"; readonly evalId: EvaluationId; readonly attempt: EvaluationAttemptOrdinal };

function compareEvaluationSlots(left: EvaluationSlot, right: EvaluationSlot): number {
  return left.attempt === right.attempt
    ? compareCanonicalIdentity(left.slotId, right.slotId)
    : left.attempt < right.attempt ? -1 : 1;
}

export function validateEvaluationsPayload(payload: EvaluationsPayload): readonly EvaluationsPayloadIssue[] {
  const issues: EvaluationsPayloadIssue[] = [];
  const slots = new Set<string>();
  let previousEvalId: EvaluationId | undefined;
  for (const [definitionIndex, definition] of payload.evaluations.entries()) {
    if (previousEvalId !== undefined && compareCanonicalIdentity(previousEvalId, definition.evalId) >= 0) {
      issues.push(Object.freeze(
        previousEvalId === definition.evalId
          ? { code: "evaluations-eval-duplicate" as const, evalId: definition.evalId }
          : { code: "evaluations-eval-order-invalid" as const, index: definitionIndex, evalId: definition.evalId },
      ));
    }
    const attempts = new Set<number>();
    let previousSlot: EvaluationSlot | undefined;
    for (const [slotIndex, slot] of definition.slots.entries()) {
      if (previousSlot !== undefined && compareEvaluationSlots(previousSlot, slot) >= 0) {
        issues.push(Object.freeze({ code: "evaluations-slot-order-invalid" as const, evalId: definition.evalId, index: slotIndex, slotId: slot.slotId }));
      }
      if (slots.has(slot.slotId)) {
        issues.push(Object.freeze({ code: "evaluations-slot-duplicate" as const, slotId: slot.slotId }));
      }
      if (attempts.has(slot.attempt)) {
        issues.push(Object.freeze({ code: "evaluations-attempt-duplicate" as const, evalId: definition.evalId, attempt: slot.attempt }));
      }
      slots.add(slot.slotId);
      attempts.add(slot.attempt);
      previousSlot = slot;
    }
    previousEvalId = definition.evalId;
  }
  return Object.freeze(issues);
}

export const EvaluationsPayloadSchema = EvaluationsPayloadStructuralSchema.pipe(
  Schema.filter((payload) => validateEvaluationsPayload(payload).length === 0, {
    identifier: "EvaluationPlan",
    description: "canonical transient Eval definitions and Slot mapping",
  }),
);

export type EvaluationsPayloadBuildError = {
  readonly code: "evaluations-payload-schema-invalid" | "evaluations-payload-coherence-invalid";
  readonly issues?: readonly EvaluationsPayloadIssue[];
};

export function decodeEvaluationsPayload(input: unknown): Either.Either<EvaluationsPayload, EvaluationsPayloadBuildError> {
  const decoded = Schema.decodeUnknownEither(EvaluationsPayloadSchema, ExactEvaluationParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({ code: "evaluations-payload-schema-invalid" as const }))
    : Either.right(decoded.right);
}

export function buildEvaluationsPayload(input: EvaluationsPayload): Either.Either<EvaluationsPayload, EvaluationsPayloadBuildError> {
  const decoded = Schema.decodeUnknownEither(EvaluationsPayloadStructuralSchema, ExactEvaluationParseOptions)(input);
  if (Either.isLeft(decoded)) return Either.left(Object.freeze({ code: "evaluations-payload-schema-invalid" as const }));
  const issues = validateEvaluationsPayload(decoded.right);
  if (issues.length > 0) return Either.left(Object.freeze({ code: "evaluations-payload-coherence-invalid" as const, issues }));
  return Either.right(decoded.right);
}

export interface EvaluationSlotProjection extends EvaluationSlot {
  readonly evalId: EvaluationId;
  readonly evaluationKind: EvaluationKind;
}
export interface EvaluationsProjection {
  readonly evaluationForSlot: (slotId: SlotId) => EvaluationSlotProjection | undefined;
}

export function projectEvaluationsPayload(payload: EvaluationsPayload): EvaluationsProjection {
  const slots = new Map<string, EvaluationSlotProjection>();
  for (const evaluation of payload.evaluations) {
    for (const slot of evaluation.slots) {
      slots.set(slot.slotId, Object.freeze({ ...slot, evalId: evaluation.evalId, evaluationKind: evaluation.evaluationKind }));
    }
  }
  return Object.freeze({ evaluationForSlot: (slotId: SlotId) => slots.get(slotId) });
}

export interface Evaluation {
  readonly id: EvaluationId;
  readonly kind: EvaluationKind;
  readonly slots: readonly EvaluationSlot[];
}
export interface Evaluations {
  readonly experimentId: ExperimentId;
  readonly evaluations: readonly Evaluation[];
}

export function projectEvaluations(payload: EvaluationsPayload): Evaluations {
  return Object.freeze({
    experimentId: payload.experimentId,
    evaluations: Object.freeze(payload.evaluations.map((evaluation) => Object.freeze({
      id: evaluation.evalId,
      kind: evaluation.evaluationKind,
      slots: Object.freeze([...evaluation.slots]),
    }))),
  });
}
