import { Either, Schema } from "effect";
import {
  decodeJsonRecordAttachmentPayload,
  defineRecordAttachmentFamily,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import {
  makeNoBlobRecordAttachmentWriteV1,
  noRecordAttachmentBlobs,
  requireRecordAttachmentCapabilityV1,
} from "./attachment.ts";
import {
  EvaluationAttemptFactsV1Schema,
  isGateFailedV1,
  isRequiredAssertionUnavailableOrErroredV1,
  type EvaluationAttemptFactsV1,
} from "./sealed-assertion.ts";

export const VERDICT_ATTACHMENT_NAME_V1 = "niceeval.verdict" as const;
export const VERDICT_ATTACHMENT_SCHEMA_ID_V1 = "niceeval.verdict/v1" as const;

export const VerdictStateV1Schema = Schema.Literal(
  "passed",
  "failed",
  "errored",
  "skipped",
);

export type VerdictStateV1 = Schema.Schema.Type<typeof VerdictStateV1Schema>;

/** The durable Verdict fact deliberately contains no Assertions, diagnostics, or score. */
export const VerdictPayloadV1Schema = Schema.Struct({
  state: VerdictStateV1Schema,
});

export type VerdictPayloadV1 = Schema.Schema.Type<
  typeof VerdictPayloadV1Schema
>;

export type VerdictPayloadV1Encoded = Schema.Schema.Encoded<
  typeof VerdictPayloadV1Schema
>;

/** The built-in Attempt Attachment definition owns exact decode and closure. */
export const verdictAttachmentDefinitionV1 = requireRecordAttachmentCapabilityV1(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: VERDICT_ATTACHMENT_NAME_V1,
    schemaId: VERDICT_ATTACHMENT_SCHEMA_ID_V1,
    schema: VerdictPayloadV1Schema,
    blobRefs: noRecordAttachmentBlobs,
  }),
  "Verdict v1 RecordAttachment definition must be valid",
);

export const verdictAttachmentFamilyV1 = requireRecordAttachmentCapabilityV1(
  defineRecordAttachmentFamily({
    current: verdictAttachmentDefinitionV1,
    migrations: [],
  }),
  "Verdict v1 RecordAttachment family must be valid",
);

export function decodeVerdictPayloadV1(input: unknown) {
  return decodeJsonRecordAttachmentPayload(verdictAttachmentDefinitionV1, input);
}

/**
 * The pure fold takes the shared sealed producer facts. It never receives a
 * Score payload, so score and Verdict cannot accidentally derive one another.
 */
export type VerdictFoldInputV1 = EvaluationAttemptFactsV1;
export const VerdictFoldInputV1Schema = EvaluationAttemptFactsV1Schema;

export function foldVerdictV1(input: VerdictFoldInputV1): VerdictStateV1 {
  if (
    input.execution === "errored"
    || input.assertions.some(isRequiredAssertionUnavailableOrErroredV1)
  ) {
    return "errored";
  }
  if (input.assertions.some(isGateFailedV1)) {
    return "failed";
  }
  return input.explicitlySkipped ? "skipped" : "passed";
}

export function buildVerdictPayloadV1(
  input: VerdictFoldInputV1,
): VerdictPayloadV1 {
  return Object.freeze({ state: foldVerdictV1(input) });
}

/** Wraps an already validated durable Verdict payload in its Attempt Attachment. */
export function createVerdictAttachmentWriteV1(
  payload: VerdictPayloadV1,
): RecordAttachmentWrite<"attempt", never, never> {
  return makeNoBlobRecordAttachmentWriteV1(verdictAttachmentFamilyV1, payload);
}

/** Builds the real Attempt-owned write without embedding Score or diagnostics. */
export function buildVerdictAttachmentWriteV1(
  input: VerdictFoldInputV1,
): RecordAttachmentWrite<"attempt", never, never> {
  return createVerdictAttachmentWriteV1(buildVerdictPayloadV1(input));
}

export type VerdictCoherenceIssueV1 = {
  readonly code: "verdict-fold-mismatch";
  readonly expected: VerdictStateV1;
  readonly actual: VerdictStateV1;
};

/** Confirms a producer persisted the Verdict demanded by sealed facts. */
export function validateVerdictCoherenceV1(input: {
  readonly payload: VerdictPayloadV1;
  readonly fold: VerdictFoldInputV1;
}): readonly VerdictCoherenceIssueV1[] {
  const expected = foldVerdictV1(input.fold);
  return input.payload.state === expected
    ? []
    : Object.freeze([
        Object.freeze({
          code: "verdict-fold-mismatch" as const,
          expected,
          actual: input.payload.state,
        }),
      ]);
}

/** A projector needs only the already-decoded exact Verdict state. */
export function projectVerdictPayloadV1(
  payload: VerdictPayloadV1,
): VerdictStateV1 {
  return payload.state;
}

/** A typed, synchronous projection over an available Verdict Attachment. */
export function projectVerdictAttachmentV1(
  value: RecordAttachmentValue<VerdictPayloadV1>,
): VerdictStateV1 {
  const payload = decodeVerdictPayloadV1(value.payload);
  if (Either.isLeft(payload)) {
    throw new Error("An available Verdict Attachment failed its exact decoder");
  }
  return projectVerdictPayloadV1(payload.right);
}

export interface VerdictProjectorDefinitionV1 {
  readonly family: typeof verdictAttachmentFamilyV1;
  readonly project: (
    value: RecordAttachmentValue<VerdictPayloadV1>,
  ) => VerdictStateV1;
}

export function defineVerdictProjectorV1(): VerdictProjectorDefinitionV1 {
  return Object.freeze({
    family: verdictAttachmentFamilyV1,
    project: projectVerdictAttachmentV1,
  });
}
