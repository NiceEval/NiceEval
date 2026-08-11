import { Effect, Schema } from "effect";
import {
  NodeRefV1Schema,
  type NodeRefV1,
  type StrongEdgeV1,
  validateStrongEdgeSequence,
} from "./core.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";
import {
  EvidenceTransformationV1Schema,
  type EvidenceTransformationV1,
  validateEvidenceTransformationSequenceV1,
} from "./observation.ts";

export const TRANSFORMED_EVIDENCE_MEDIA_TYPE: "application/vnd.niceeval.transformed-evidence.v1+jcs" =
  "application/vnd.niceeval.transformed-evidence.v1+jcs";

export const TransformedEvidenceV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.transformed-evidence/1"),
  result: NodeRefV1Schema,
  transformations: Schema.NonEmptyArray(EvidenceTransformationV1Schema),
});

export type TransformedEvidenceV1 = Schema.Schema.Type<
  typeof TransformedEvidenceV1Schema
>;

function invariantError(
  path: readonly string[],
  message: string,
): RecordProtocolError {
  return recordProtocolError({
    code: "payload-invariant-invalid",
    operation: "validate-transformed-evidence",
    path,
    message,
  });
}

/** Validate persisted wrapper rules that cannot be represented by its Schema alone. */
export function validateTransformedEvidenceV1(
  payload: TransformedEvidenceV1,
): Effect.Effect<void, RecordProtocolError> {
  if (payload.transformations.length === 0) {
    return Effect.fail(invariantError(
      ["transformations"],
      "Transformed evidence requires at least one transformation",
    ));
  }
  return validateEvidenceTransformationSequenceV1(payload.transformations);
}

/** The wrapper owns exactly one result edge, at flattened ordinal zero. */
export function transformedEvidenceStrongEdges(
  payload: TransformedEvidenceV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    Object.freeze({
      relation: "niceeval.transformed-evidence-result",
      target: payload.result,
    }),
  ]);
}

/**
 * Check the local payload-to-edge contract. Callers must inspect the result node separately
 * to reject a nested transformed-evidence wrapper.
 */
export function validateTransformedEvidenceResultEdgeV1(
  payload: TransformedEvidenceV1,
  edges: unknown,
): Effect.Effect<readonly StrongEdgeV1[], RecordProtocolError> {
  return validateStrongEdgeSequence(transformedEvidenceStrongEdges(payload), edges);
}
