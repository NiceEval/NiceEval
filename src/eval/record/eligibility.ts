import { Either, Schema } from "effect";
import type { Effect } from "effect";
import {
  decodeJsonRecordAttachmentPayload,
  defineRecordAttachmentFamily,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import type { RecordAttachmentRead } from "../../record/model/read-state.ts";
import type { FrozenRecordAttempt, FrozenRecordView } from "../../record/reader/types.ts";
import {
  ExactRecordAttachmentParseOptions,
  FiniteNonNegativeNumberV1Schema,
  makeNoBlobRecordAttachmentWriteV1,
  noRecordAttachmentBlobs,
  requireRecordAttachmentCapabilityV1,
} from "./attachment.ts";

export const ELIGIBILITY_ATTACHMENT_NAME_V1 = "niceeval.eligibility" as const;
export const ELIGIBILITY_ATTACHMENT_SCHEMA_ID_V1 =
  "niceeval.eligibility/v1" as const;

/** Durable token text is bounded before it reaches an opaque Record payload. */
export const EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH_V1 = 255 as const;
export const EQUALITY_TOKEN_VALUE_MAXIMUM_LENGTH_V1 = 4096 as const;

function isBoundedNonEmptyText(value: string, maximumLength: number): boolean {
  return value.length > 0 && value.length <= maximumLength;
}

/** Runtime guard shared by planner inputs and the exact persisted schema. */
export function isEqualityTokenV1(value: unknown): value is EqualityTokenV1 {
  if (typeof value !== "object" || value === null) return false;
  const token = value as Partial<EqualityTokenV1>;
  return (
    typeof token.domain === "string"
    && isBoundedNonEmptyText(
      token.domain,
      EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH_V1,
    )
    && typeof token.value === "string"
    && isBoundedNonEmptyText(
      token.value,
      EQUALITY_TOKEN_VALUE_MAXIMUM_LENGTH_V1,
    )
  );
}

/** Runtime guard shared by planner inputs and the exact persisted schema. */
export function isDurationLimitV1(value: unknown): value is DurationLimitV1 {
  if (typeof value !== "object" || value === null) return false;
  const duration = value as Partial<DurationLimitV1>;
  return (
    typeof duration.domain === "string"
    && isBoundedNonEmptyText(
      duration.domain,
      EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH_V1,
    )
    && typeof duration.milliseconds === "number"
    && Number.isFinite(duration.milliseconds)
    && duration.milliseconds >= 0
  );
}

const EqualityTokenDomainV1Schema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      isBoundedNonEmptyText(value, EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH_V1),
    {
      identifier: "EqualityTokenDomainV1",
      description: "a non-empty equality-token domain no longer than 255 code units",
    },
  ),
);

const EqualityTokenValueV1Schema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      isBoundedNonEmptyText(value, EQUALITY_TOKEN_VALUE_MAXIMUM_LENGTH_V1),
    {
      identifier: "EqualityTokenValueV1",
      description: "a non-empty equality-token value no longer than 4096 code units",
    },
  ),
);

/**
 * An opaque equality claim. Its value is meaningful only within its domain;
 * callers must never compare values from different domains.
 */
export const EqualityTokenV1Schema = Schema.Struct({
  domain: EqualityTokenDomainV1Schema,
  value: EqualityTokenValueV1Schema,
});

export type EqualityTokenV1 = Schema.Schema.Type<typeof EqualityTokenV1Schema>;

/** The duration's domain states which execution clock produced its milliseconds. */
export const DurationLimitV1Schema = Schema.Struct({
  domain: EqualityTokenDomainV1Schema,
  milliseconds: FiniteNonNegativeNumberV1Schema,
});

export type DurationLimitV1 = Schema.Schema.Type<typeof DurationLimitV1Schema>;

/**
 * The immutable eligibility claims recorded by an origin Attempt. This is not
 * a reusable result state: availability and migration remain Record read
 * states, while these four fields are compared by a named reuse policy.
 */
export const AttemptEligibilityPayloadV1Schema = Schema.Struct({
  reuseContract: EqualityTokenV1Schema,
  inputIdentity: EqualityTokenV1Schema,
  configIdentity: EqualityTokenV1Schema,
  executionDuration: DurationLimitV1Schema,
});

export type AttemptEligibilityPayloadV1 = Schema.Schema.Type<
  typeof AttemptEligibilityPayloadV1Schema
>;

export type AttemptEligibilityPayloadV1Encoded = Schema.Schema.Encoded<
  typeof AttemptEligibilityPayloadV1Schema
>;

/** Exact JSON definition for the Attempt-owned eligibility fact. */
export const eligibilityAttachmentDefinitionV1 =
  requireRecordAttachmentCapabilityV1(
    defineBuiltinJsonRecordAttachment({
      owner: "attempt",
      name: ELIGIBILITY_ATTACHMENT_NAME_V1,
      schemaId: ELIGIBILITY_ATTACHMENT_SCHEMA_ID_V1,
      schema: AttemptEligibilityPayloadV1Schema,
      blobRefs: noRecordAttachmentBlobs,
    }),
    "Eligibility v1 RecordAttachment definition must be valid",
  );

export const eligibilityAttachmentFamilyV1 = requireRecordAttachmentCapabilityV1(
  defineRecordAttachmentFamily({
    current: eligibilityAttachmentDefinitionV1,
    migrations: [],
  }),
  "Eligibility v1 RecordAttachment family must be valid",
);

/** Uses the same all-errors, excess-property-rejecting boundary as Record. */
export function decodeAttemptEligibilityPayloadV1(input: unknown) {
  return decodeJsonRecordAttachmentPayload(eligibilityAttachmentDefinitionV1, input);
}

export type AttemptEligibilityPayloadBuildErrorV1 = {
  readonly code: "eligibility-payload-schema-invalid";
};

/**
 * Validates producer input before it is captured by Record's opaque writer.
 * The payload contains only durable facts; it deliberately has no state field.
 */
export function buildAttemptEligibilityPayloadV1(
  input: AttemptEligibilityPayloadV1,
): Either.Either<
  AttemptEligibilityPayloadV1,
  AttemptEligibilityPayloadBuildErrorV1
> {
  const decoded = Schema.decodeUnknownEither(
    AttemptEligibilityPayloadV1Schema,
    ExactRecordAttachmentParseOptions,
  )(input);
  if (Either.isLeft(decoded)) {
    return Either.left(
      Object.freeze({ code: "eligibility-payload-schema-invalid" as const }),
    );
  }

  return Either.right(
    Object.freeze({
      reuseContract: Object.freeze({ ...decoded.right.reuseContract }),
      inputIdentity: Object.freeze({ ...decoded.right.inputIdentity }),
      configIdentity: Object.freeze({ ...decoded.right.configIdentity }),
      executionDuration: Object.freeze({ ...decoded.right.executionDuration }),
    }),
  );
}

/** Builds the real opaque Attempt write after exact payload validation. */
export function buildEligibilityAttachmentWriteV1(
  input: AttemptEligibilityPayloadV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  AttemptEligibilityPayloadBuildErrorV1
> {
  const payload = buildAttemptEligibilityPayloadV1(input);
  if (Either.isLeft(payload)) {
    return Either.left(payload.left);
  }
  return Either.right(
    makeNoBlobRecordAttachmentWriteV1(
      eligibilityAttachmentFamilyV1,
      payload.right,
    ),
  );
}

/** The typed reader helper leaves unavailable and migration states as data. */
export function readAttemptEligibilityAttachmentV1<ReadError>(
  reader: FrozenRecordView<ReadError>,
  owner: FrozenRecordAttempt,
): Effect.Effect<
  RecordAttachmentRead<RecordAttachmentValue<AttemptEligibilityPayloadV1>>,
  ReadError
> {
  return reader.readAttemptAttachment(owner, eligibilityAttachmentFamilyV1);
}

/** A pure view over the exact decoded eligibility facts. */
export function projectAttemptEligibilityPayloadV1(
  payload: AttemptEligibilityPayloadV1,
): AttemptEligibilityPayloadV1 {
  return payload;
}

/** A typed synchronous projector for one available Attachment snapshot. */
export function projectEligibilityAttachmentV1(
  value: RecordAttachmentValue<AttemptEligibilityPayloadV1>,
): AttemptEligibilityPayloadV1 {
  const payload = decodeAttemptEligibilityPayloadV1(value.payload);
  if (Either.isLeft(payload)) {
    throw new Error("An available Eligibility Attachment failed its exact decoder");
  }
  return projectAttemptEligibilityPayloadV1(payload.right);
}

export interface EligibilityProjectorDefinitionV1 {
  readonly family: typeof eligibilityAttachmentFamilyV1;
  readonly project: (
    value: RecordAttachmentValue<AttemptEligibilityPayloadV1>,
  ) => AttemptEligibilityPayloadV1;
}

export function defineEligibilityProjectorV1(): EligibilityProjectorDefinitionV1 {
  return Object.freeze({
    family: eligibilityAttachmentFamilyV1,
    project: projectEligibilityAttachmentV1,
  });
}
