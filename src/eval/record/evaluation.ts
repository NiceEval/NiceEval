import { Either, Schema } from "effect";
import {
  decodeJsonRecordAttachmentPayload,
  defineRecordAttachmentFamily,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import { SlotIdSchema } from "../../record/codec/identifiers.ts";
import {
  compareCanonicalIdentity,
  type SlotId,
} from "../../record/model/identifiers.ts";
import {
  EvaluationRecordIdentitySchema,
  ExactRecordAttachmentParseOptions,
  makeNoBlobRecordAttachmentWriteV1,
  noRecordAttachmentBlobs,
  requireRecordAttachmentCapabilityV1,
} from "./attachment.ts";

export const EVALUATIONS_ATTACHMENT_NAME_V1 = "niceeval.evaluations" as const;
export const EVALUATIONS_ATTACHMENT_SCHEMA_ID_V1 =
  "niceeval.evaluations/v1" as const;

/** The first Evaluation Attachment deliberately has only two kinds. */
export const EvaluationKindV1Schema = Schema.Literal("pass", "score");

export type EvaluationKindV1 = Schema.Schema.Type<
  typeof EvaluationKindV1Schema
>;

export type EvaluationIdV1 = Schema.Schema.Type<
  typeof EvaluationRecordIdentitySchema
>;

export type ExperimentIdV1 = Schema.Schema.Type<
  typeof EvaluationRecordIdentitySchema
>;

/** The ordinal is part of the Slot-to-Eval plan; SlotId itself is opaque. */
export const EvaluationAttemptOrdinalV1Schema = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
);

export type EvaluationAttemptOrdinalV1 = Schema.Schema.Type<
  typeof EvaluationAttemptOrdinalV1Schema
>;

/** One Run denominator Slot's position within an Eval. */
export const EvaluationSlotV1Schema = Schema.Struct({
  slotId: SlotIdSchema,
  attempt: EvaluationAttemptOrdinalV1Schema,
});

export type EvaluationSlotV1 = Schema.Schema.Type<
  typeof EvaluationSlotV1Schema
>;

export type EvaluationSlotV1Encoded = Schema.Schema.Encoded<
  typeof EvaluationSlotV1Schema
>;

/** A distinct path-derived Eval and every Slot that invokes it in this Run. */
export const EvaluationDefinitionV1Schema = Schema.Struct({
  evalId: EvaluationRecordIdentitySchema,
  evaluationKind: EvaluationKindV1Schema,
  slots: Schema.NonEmptyArray(EvaluationSlotV1Schema),
});

export type EvaluationDefinitionV1 = Schema.Schema.Type<
  typeof EvaluationDefinitionV1Schema
>;

export type EvaluationDefinitionV1Encoded = Schema.Schema.Encoded<
  typeof EvaluationDefinitionV1Schema
>;

/**
 * Run-owned facts for offline Experiment selection and Slot classification.
 * Each Eval occurs once; every expected Slot belongs to exactly one Eval entry.
 */
const EvaluationsPayloadV1StructuralSchema = Schema.Struct({
  experimentId: EvaluationRecordIdentitySchema,
  evaluations: Schema.Array(EvaluationDefinitionV1Schema),
});

export type EvaluationsPayloadV1 = Schema.Schema.Type<
  typeof EvaluationsPayloadV1StructuralSchema
>;

export type EvaluationsPayloadV1Encoded = Schema.Schema.Encoded<
  typeof EvaluationsPayloadV1StructuralSchema
>;

export type EvaluationsPayloadIssueV1 =
  | {
      readonly code: "evaluations-eval-order-invalid";
      readonly index: number;
      readonly evalId: EvaluationIdV1;
    }
  | {
      readonly code: "evaluations-eval-duplicate";
      readonly evalId: EvaluationIdV1;
    }
  | {
      readonly code: "evaluations-slot-order-invalid";
      readonly evalId: EvaluationIdV1;
      readonly index: number;
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluations-slot-duplicate";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluations-attempt-duplicate";
      readonly evalId: EvaluationIdV1;
      readonly attempt: EvaluationAttemptOrdinalV1;
    };

function compareEvaluationSlots(
  left: EvaluationSlotV1,
  right: EvaluationSlotV1,
): number {
  if (left.attempt !== right.attempt) {
    return left.attempt < right.attempt ? -1 : 1;
  }
  return compareCanonicalIdentity(left.slotId, right.slotId);
}

/**
 * Checks the semantic invariants outside a Struct: canonical identity order,
 * one Eval definition per EvalId, one Slot globally, and one Slot per Eval
 * ordinal. The latter lets reuse planning match `(evalId, attempt)` without
 * deriving identity from a filesystem name.
 */
export function validateEvaluationsPayloadV1(
  payload: EvaluationsPayloadV1,
): readonly EvaluationsPayloadIssueV1[] {
  const issues: EvaluationsPayloadIssueV1[] = [];
  const slotIds = new Set<string>();
  let previousEvalId: EvaluationIdV1 | undefined;

  for (const [definitionIndex, definition] of payload.evaluations.entries()) {
    if (
      previousEvalId !== undefined
      && compareCanonicalIdentity(previousEvalId, definition.evalId) >= 0
    ) {
      issues.push(
        previousEvalId === definition.evalId
          ? Object.freeze({
              code: "evaluations-eval-duplicate" as const,
              evalId: definition.evalId,
            })
          : Object.freeze({
              code: "evaluations-eval-order-invalid" as const,
              index: definitionIndex,
              evalId: definition.evalId,
            }),
      );
    }

    const attempts = new Set<number>();
    let previousSlot: EvaluationSlotV1 | undefined;
    for (const [slotIndex, slot] of definition.slots.entries()) {
      if (
        previousSlot !== undefined
        && compareEvaluationSlots(previousSlot, slot) >= 0
      ) {
        issues.push(
          Object.freeze({
            code: "evaluations-slot-order-invalid" as const,
            evalId: definition.evalId,
            index: slotIndex,
            slotId: slot.slotId,
          }),
        );
      }
      if (slotIds.has(slot.slotId)) {
        issues.push(
          Object.freeze({
            code: "evaluations-slot-duplicate" as const,
            slotId: slot.slotId,
          }),
        );
      }
      if (attempts.has(slot.attempt)) {
        issues.push(
          Object.freeze({
            code: "evaluations-attempt-duplicate" as const,
            evalId: definition.evalId,
            attempt: slot.attempt,
          }),
        );
      }

      slotIds.add(slot.slotId);
      attempts.add(slot.attempt);
      previousSlot = slot;
    }
    previousEvalId = definition.evalId;
  }

  return Object.freeze(issues);
}

/** Exact JSON schema for `niceeval.evaluations/v1`. */
export const EvaluationsPayloadV1Schema = EvaluationsPayloadV1StructuralSchema.pipe(
  Schema.filter(
    (payload) => validateEvaluationsPayloadV1(payload).length === 0,
    {
      identifier: "EvaluationsPayloadV1",
      description:
        "canonical distinct Eval definitions and a one-to-one Slot mapping",
    },
  ),
);

/** The built-in Run Attachment definition owns exact decode and blob closure. */
export const evaluationsAttachmentDefinitionV1 =
  requireRecordAttachmentCapabilityV1(
    defineBuiltinJsonRecordAttachment({
      owner: "run",
      name: EVALUATIONS_ATTACHMENT_NAME_V1,
      schemaId: EVALUATIONS_ATTACHMENT_SCHEMA_ID_V1,
      schema: EvaluationsPayloadV1Schema,
      blobRefs: noRecordAttachmentBlobs,
    }),
    "Evaluations v1 RecordAttachment definition must be valid",
  );

export const evaluationsAttachmentFamilyV1 = requireRecordAttachmentCapabilityV1(
  defineRecordAttachmentFamily({
    current: evaluationsAttachmentDefinitionV1,
    migrations: [],
  }),
  "Evaluations v1 RecordAttachment family must be valid",
);

export function decodeEvaluationsPayloadV1(input: unknown) {
  return decodeJsonRecordAttachmentPayload(
    evaluationsAttachmentDefinitionV1,
    input,
  );
}

export type EvaluationsPayloadBuildErrorV1 =
  | { readonly code: "evaluations-payload-schema-invalid" }
  | {
      readonly code: "evaluations-payload-coherence-invalid";
      readonly issues: readonly EvaluationsPayloadIssueV1[];
    };

function asNonEmptySlots(
  slots: readonly EvaluationSlotV1[],
): readonly [EvaluationSlotV1, ...EvaluationSlotV1[]] {
  const [first, ...rest] = slots;
  if (first === undefined) {
    throw new Error("Evaluation definitions must retain at least one Slot");
  }
  return Object.freeze([first, ...rest]);
}

/**
 * Producer-side constructor. It canonicalizes evaluation and Slot ordering,
 * while rejecting duplicate Slot/ordinal identities instead of guessing a
 * mapping from the current worktree.
 */
export function buildEvaluationsPayloadV1(
  input: EvaluationsPayloadV1,
): Either.Either<EvaluationsPayloadV1, EvaluationsPayloadBuildErrorV1> {
  const decoded = Schema.decodeUnknownEither(
    EvaluationsPayloadV1StructuralSchema,
    ExactRecordAttachmentParseOptions,
  )(input);
  if (Either.isLeft(decoded)) {
    return Either.left(
      Object.freeze({ code: "evaluations-payload-schema-invalid" as const }),
    );
  }

  const evaluations = decoded.right.evaluations
    .map((definition) =>
      Object.freeze({
        evalId: definition.evalId,
        evaluationKind: definition.evaluationKind,
        slots: asNonEmptySlots(
          definition.slots
            .map((slot) => Object.freeze({ ...slot }))
            .sort(compareEvaluationSlots),
        ),
      }),
    )
    .sort((left, right) =>
      compareCanonicalIdentity(left.evalId, right.evalId),
    );
  const payload = Object.freeze({
    experimentId: decoded.right.experimentId,
    evaluations: Object.freeze(evaluations),
  });
  const issues = validateEvaluationsPayloadV1(payload);

  return issues.length === 0
    ? Either.right(payload)
    : Either.left(
        Object.freeze({
          code: "evaluations-payload-coherence-invalid" as const,
          issues,
        }),
      );
}

/** Builds the real Run-owned opaque write after canonicalizing producer facts. */
export function buildEvaluationsAttachmentWriteV1(
  input: EvaluationsPayloadV1,
): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  EvaluationsPayloadBuildErrorV1
> {
  const payload = buildEvaluationsPayloadV1(input);
  if (Either.isLeft(payload)) {
    return Either.left(payload.left);
  }
  return Either.right(
    makeNoBlobRecordAttachmentWriteV1(
      evaluationsAttachmentFamilyV1,
      payload.right,
    ),
  );
}

/** The flattened lookup value reports need for each denominator Slot. */
export interface EvaluationSlotProjectionV1 extends EvaluationSlotV1 {
  readonly evalId: EvaluationIdV1;
  readonly evaluationKind: EvaluationKindV1;
}

/** A pure lookup projection; RecordAttachment reads supply the frozen payload. */
export interface EvaluationsProjectionV1 {
  readonly experimentId: ExperimentIdV1;
  readonly evaluations: readonly EvaluationDefinitionV1[];
  readonly evaluationForSlot: (
    slotId: SlotId,
  ) => EvaluationSlotProjectionV1 | undefined;
}

export function projectEvaluationsPayloadV1(
  payload: EvaluationsPayloadV1,
): EvaluationsProjectionV1 {
  const bySlotId = new Map<string, EvaluationSlotProjectionV1>();
  for (const evaluation of payload.evaluations) {
    for (const slot of evaluation.slots) {
      bySlotId.set(
        slot.slotId,
        Object.freeze({
          slotId: slot.slotId,
          attempt: slot.attempt,
          evalId: evaluation.evalId,
          evaluationKind: evaluation.evaluationKind,
        }),
      );
    }
  }

  return Object.freeze({
    experimentId: payload.experimentId,
    evaluations: payload.evaluations,
    evaluationForSlot: (slotId: SlotId) => bySlotId.get(slotId),
  });
}

/** A typed, synchronous projection over one available Record Attachment value. */
export function projectEvaluationsAttachmentV1(
  value: RecordAttachmentValue<EvaluationsPayloadV1>,
): EvaluationsProjectionV1 {
  const payload = decodeEvaluationsPayloadV1(value.payload);
  if (Either.isLeft(payload)) {
    throw new Error("An available Evaluations Attachment failed its exact decoder");
  }
  return projectEvaluationsPayloadV1(payload.right);
}

export interface EvaluationsProjectorDefinitionV1 {
  readonly family: typeof evaluationsAttachmentFamilyV1;
  readonly project: (
    value: RecordAttachmentValue<EvaluationsPayloadV1>,
  ) => EvaluationsProjectionV1;
}

export function defineEvaluationsProjectorV1(): EvaluationsProjectorDefinitionV1 {
  return Object.freeze({
    family: evaluationsAttachmentFamilyV1,
    project: projectEvaluationsAttachmentV1,
  });
}
