import { Either, Schema } from "effect";
import type { Effect } from "effect";
import {
  decodeJsonRecordAttachmentPayload,
  defineRecordAttachmentFamily,
  type RecordAttachmentValue,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import {
  RecordIssueSchema,
  type RecordIssue,
} from "../../record/errors/record-errors.ts";
import type { RecordAttachmentRead } from "../../record/model/read-state.ts";
import { AttemptIdSchema, RunIdSchema, SlotIdSchema, UtcMillisSchema } from "../../record/codec/identifiers.ts";
import type { FrozenRecordRun, FrozenRecordView } from "../../record/reader/types.ts";
import { isJsonValue } from "../../shared/json-value.ts";
import {
  ExactRecordAttachmentParseOptions,
  FiniteNonNegativeNumberV1Schema,
  makeNoBlobRecordAttachmentWriteV1,
  noRecordAttachmentBlobs,
  requireRecordAttachmentCapabilityV1,
} from "./attachment.ts";

export const MEMBERSHIP_PROVENANCE_ATTACHMENT_NAME_V1 =
  "niceeval.membership-provenance" as const;
export const MEMBERSHIP_PROVENANCE_ATTACHMENT_SCHEMA_ID_V1 =
  "niceeval.membership-provenance/v1" as const;

export const MEMBERSHIP_POLICY_NAME_MAXIMUM_LENGTH_V1 = 255 as const;

const MembershipPolicyNameV1Schema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      value.length > 0 && value.length <= MEMBERSHIP_POLICY_NAME_MAXIMUM_LENGTH_V1,
    {
      identifier: "MembershipPolicyNameV1",
      description: "a non-empty policy name no longer than 255 code units",
    },
  ),
);

/** A policy identity is historical explanation, never a future reuse grant. */
export const MembershipPolicyIdentityV1Schema = Schema.Struct({
  name: MembershipPolicyNameV1Schema,
  version: FiniteNonNegativeNumberV1Schema.pipe(
    Schema.int(),
    Schema.positive(),
  ),
});

export type MembershipPolicyIdentityV1 = Schema.Schema.Type<
  typeof MembershipPolicyIdentityV1Schema
>;

/** A source Run selected by a policy's historical barrier. */
export const MembershipSourceBarrierV1Schema = Schema.Struct({
  runId: RunIdSchema,
  startedAt: UtcMillisSchema,
});

export type MembershipSourceBarrierV1 = Schema.Schema.Type<
  typeof MembershipSourceBarrierV1Schema
>;

/** The immutable origin slot of an Attempt adopted by a reference Member. */
export const MembershipAttemptOriginV1Schema = Schema.Struct({
  runId: RunIdSchema,
  slotId: SlotIdSchema,
});

export type MembershipAttemptOriginV1 = Schema.Schema.Type<
  typeof MembershipAttemptOriginV1Schema
>;

export const ComparisonAttachmentV1Schema = Schema.Literal(
  "niceeval.eligibility/v1",
  "niceeval.verdict/v1",
);

export type ComparisonAttachmentV1 = Schema.Schema.Type<
  typeof ComparisonAttachmentV1Schema
>;

export const RecordedAttemptClaimV1Schema = Schema.Literal(
  "reuse-contract",
  "verdict-state",
  "input-identity",
  "config-identity",
  "execution-duration",
);

export type RecordedAttemptClaimV1 = Schema.Schema.Type<
  typeof RecordedAttemptClaimV1Schema
>;

export const ComparisonSourceStateV1Schema = Schema.Literal(
  "available",
  "unavailable",
  "migration-required",
  "migration-unavailable",
  "unsupported",
  "invalid",
);

export type ComparisonSourceStateV1 = Schema.Schema.Type<
  typeof ComparisonSourceStateV1Schema
>;

export const ComparisonResultV1Schema = Schema.Literal(
  "match",
  "mismatch",
  "ineligible",
  "not-comparable",
);

export type ComparisonResultV1 = Schema.Schema.Type<
  typeof ComparisonResultV1Schema
>;

/** One durable explanation of a claim compared by a named policy. */
export const ComparisonProvenanceV1Schema = Schema.Struct({
  attachment: ComparisonAttachmentV1Schema,
  recordedClaim: RecordedAttemptClaimV1Schema,
  sourceState: ComparisonSourceStateV1Schema,
  result: ComparisonResultV1Schema,
  reason: Schema.String,
});

export type ComparisonProvenanceV1 = Schema.Schema.Type<
  typeof ComparisonProvenanceV1Schema
>;

/** Stable gaps produced by the project-target/v1 policy. */
export const ExecutionGapReasonV1Schema = Schema.Literal(
  "no-source-run",
  "source-slot-missing",
  "source-member-missing",
  "source-core-invalid",
  "source-attachment-unavailable",
  "source-attachment-migration-required",
  "source-attachment-migration-unavailable",
  "source-attachment-unsupported",
  "source-attachment-invalid",
  "reuse-contract-domain-mismatch",
  "reuse-contract-mismatch",
  "verdict-ineligible",
  "identity-mismatch",
  "identity-domain-mismatch",
  "duration-domain-mismatch",
  "timeout-exceeded",
  "rerun-requested",
  "sandbox-retention-requested",
);

export type ExecutionGapReasonV1 = Schema.Schema.Type<
  typeof ExecutionGapReasonV1Schema
>;

export const ExecutionGapScopeV1Schema = Schema.Literal(
  "slot",
  "experiment",
  "target",
);

export type ExecutionGapScopeV1 = Schema.Schema.Type<
  typeof ExecutionGapScopeV1Schema
>;

/** The plan fact carried by an action that did not adopt an existing Attempt. */
export const MembershipGapV1Schema = Schema.Struct({
  reason: ExecutionGapReasonV1Schema,
  scope: ExecutionGapScopeV1Schema,
  issues: Schema.Array(RecordIssueSchema),
  sourceBarrier: Schema.optional(MembershipSourceBarrierV1Schema),
});

export type MembershipGapV1 = Schema.Schema.Type<typeof MembershipGapV1Schema>;

const MembershipCarriedActionV1Schema = Schema.Struct({
  action: Schema.Literal("carried"),
  slotId: SlotIdSchema,
  attemptId: AttemptIdSchema,
  origin: MembershipAttemptOriginV1Schema,
  sourceBarrier: MembershipSourceBarrierV1Schema,
  comparisons: Schema.Array(ComparisonProvenanceV1Schema),
});

export type MembershipCarriedActionV1 = Schema.Schema.Type<
  typeof MembershipCarriedActionV1Schema
>;

const MembershipAcceptedActionV1Schema = Schema.Struct({
  action: Schema.Literal("accepted"),
  slotId: SlotIdSchema,
  attemptId: AttemptIdSchema,
  origin: MembershipAttemptOriginV1Schema,
  comparisons: Schema.Array(ComparisonProvenanceV1Schema),
  sourceBarrier: Schema.optional(MembershipSourceBarrierV1Schema),
  locator: Schema.optional(Schema.String),
  operatorReason: Schema.optional(Schema.String),
});

export type MembershipAcceptedActionV1 = Schema.Schema.Type<
  typeof MembershipAcceptedActionV1Schema
>;

const MembershipExecutedActionV1Schema = Schema.Struct({
  action: Schema.Literal("executed"),
  slotId: SlotIdSchema,
  attemptId: AttemptIdSchema,
  gap: MembershipGapV1Schema,
  comparisons: Schema.Array(ComparisonProvenanceV1Schema),
});

export type MembershipExecutedActionV1 = Schema.Schema.Type<
  typeof MembershipExecutedActionV1Schema
>;

const MembershipNotDispatchedActionV1Schema = Schema.Struct({
  action: Schema.Literal("not-dispatched"),
  slotId: SlotIdSchema,
  gap: MembershipGapV1Schema,
  comparisons: Schema.Array(ComparisonProvenanceV1Schema),
});

export type MembershipNotDispatchedActionV1 = Schema.Schema.Type<
  typeof MembershipNotDispatchedActionV1Schema
>;

const MembershipInterruptedActionV1Schema = Schema.Struct({
  action: Schema.Literal("interrupted"),
  slotId: SlotIdSchema,
  gap: MembershipGapV1Schema,
  comparisons: Schema.Array(ComparisonProvenanceV1Schema),
});

export type MembershipInterruptedActionV1 = Schema.Schema.Type<
  typeof MembershipInterruptedActionV1Schema
>;

/** Every target Slot records one final membership action. */
export const MembershipActionV1Schema = Schema.Union(
  MembershipCarriedActionV1Schema,
  MembershipAcceptedActionV1Schema,
  MembershipExecutedActionV1Schema,
  MembershipNotDispatchedActionV1Schema,
  MembershipInterruptedActionV1Schema,
);

export type MembershipActionV1 = Schema.Schema.Type<typeof MembershipActionV1Schema>;

/** A JSON-only, read-only value safe to retain as policy effective options. */
export type MembershipEffectiveOptionsV1 =
  | null
  | boolean
  | number
  | string
  | readonly MembershipEffectiveOptionsV1[]
  | { readonly [key: string]: MembershipEffectiveOptionsV1 };

function isMembershipEffectiveOptionsV1(
  value: unknown,
): value is MembershipEffectiveOptionsV1 {
  return isJsonValue(value);
}

export const MembershipEffectiveOptionsV1Schema: Schema.Schema<
  MembershipEffectiveOptionsV1
> = Schema.declare<MembershipEffectiveOptionsV1>(
  isMembershipEffectiveOptionsV1,
);

const MembershipProvenancePayloadV1StructuralSchema = Schema.Struct({
  policy: MembershipPolicyIdentityV1Schema,
  effectiveOptions: MembershipEffectiveOptionsV1Schema,
  actions: Schema.Array(MembershipActionV1Schema),
});

export type MembershipProvenancePayloadV1 = Schema.Schema.Type<
  typeof MembershipProvenancePayloadV1StructuralSchema
>;

export type MembershipProvenancePayloadV1Encoded = Schema.Schema.Encoded<
  typeof MembershipProvenancePayloadV1StructuralSchema
>;

export type MembershipProvenancePayloadIssueV1 = {
  readonly code: "membership-provenance-slot-duplicate";
  readonly slotId: string;
};

/** Actions retain target order, but a target Slot cannot receive two actions. */
export function validateMembershipProvenancePayloadV1(
  payload: MembershipProvenancePayloadV1,
): readonly MembershipProvenancePayloadIssueV1[] {
  const seen = new Set<string>();
  const issues: MembershipProvenancePayloadIssueV1[] = [];
  for (const action of payload.actions) {
    if (seen.has(action.slotId)) {
      issues.push(
        Object.freeze({
          code: "membership-provenance-slot-duplicate" as const,
          slotId: action.slotId,
        }),
      );
    }
    seen.add(action.slotId);
  }
  return Object.freeze(issues);
}

/** Exact JSON schema for the Run-owned membership explanation. */
export const MembershipProvenancePayloadV1Schema =
  MembershipProvenancePayloadV1StructuralSchema.pipe(
    Schema.filter(
      (payload) => validateMembershipProvenancePayloadV1(payload).length === 0,
      {
        identifier: "MembershipProvenancePayloadV1",
        description: "one final factual membership action for each target Slot",
      },
    ),
  );

/** The built-in Run Attachment definition owns exact decode and blob closure. */
export const membershipProvenanceAttachmentDefinitionV1 =
  requireRecordAttachmentCapabilityV1(
    defineBuiltinJsonRecordAttachment({
      owner: "run",
      name: MEMBERSHIP_PROVENANCE_ATTACHMENT_NAME_V1,
      schemaId: MEMBERSHIP_PROVENANCE_ATTACHMENT_SCHEMA_ID_V1,
      schema: MembershipProvenancePayloadV1Schema,
      blobRefs: noRecordAttachmentBlobs,
    }),
    "Membership provenance v1 RecordAttachment definition must be valid",
  );

export const membershipProvenanceAttachmentFamilyV1 =
  requireRecordAttachmentCapabilityV1(
    defineRecordAttachmentFamily({
      current: membershipProvenanceAttachmentDefinitionV1,
      migrations: [],
    }),
    "Membership provenance v1 RecordAttachment family must be valid",
  );

export function decodeMembershipProvenancePayloadV1(input: unknown) {
  return decodeJsonRecordAttachmentPayload(
    membershipProvenanceAttachmentDefinitionV1,
    input,
  );
}

export type MembershipProvenancePayloadBuildErrorV1 =
  | { readonly code: "membership-provenance-payload-schema-invalid" }
  | {
      readonly code: "membership-provenance-payload-coherence-invalid";
      readonly issues: readonly MembershipProvenancePayloadIssueV1[];
    };

/** Validates a fact payload without turning it into a reuse decision. */
export function buildMembershipProvenancePayloadV1(
  input: MembershipProvenancePayloadV1,
): Either.Either<
  MembershipProvenancePayloadV1,
  MembershipProvenancePayloadBuildErrorV1
> {
  const decoded = Schema.decodeUnknownEither(
    MembershipProvenancePayloadV1StructuralSchema,
    ExactRecordAttachmentParseOptions,
  )(input);
  if (Either.isLeft(decoded)) {
    return Either.left(
      Object.freeze({
        code: "membership-provenance-payload-schema-invalid" as const,
      }),
    );
  }
  const issues = validateMembershipProvenancePayloadV1(decoded.right);
  return issues.length === 0
    ? Either.right(decoded.right)
    : Either.left(
        Object.freeze({
          code: "membership-provenance-payload-coherence-invalid" as const,
          issues,
        }),
      );
}

/** Builds the real opaque Run write after exact payload validation. */
export function buildMembershipProvenanceAttachmentWriteV1(
  input: MembershipProvenancePayloadV1,
): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  MembershipProvenancePayloadBuildErrorV1
> {
  const payload = buildMembershipProvenancePayloadV1(input);
  if (Either.isLeft(payload)) {
    return Either.left(payload.left);
  }
  return Either.right(
    makeNoBlobRecordAttachmentWriteV1(
      membershipProvenanceAttachmentFamilyV1,
      payload.right,
    ),
  );
}

/** The typed reader helper leaves Record's availability state untouched. */
export function readMembershipProvenanceAttachmentV1<ReadError>(
  reader: FrozenRecordView<ReadError>,
  owner: FrozenRecordRun,
): Effect.Effect<
  RecordAttachmentRead<RecordAttachmentValue<MembershipProvenancePayloadV1>>,
  ReadError
> {
  return reader.readRunAttachment(owner, membershipProvenanceAttachmentFamilyV1);
}

/** A pure view over an already exact, available payload. */
export function projectMembershipProvenancePayloadV1(
  payload: MembershipProvenancePayloadV1,
): MembershipProvenancePayloadV1 {
  return payload;
}

/** A typed synchronous projector for a materialized Membership Attachment. */
export function projectMembershipProvenanceAttachmentV1(
  value: RecordAttachmentValue<MembershipProvenancePayloadV1>,
): MembershipProvenancePayloadV1 {
  const payload = decodeMembershipProvenancePayloadV1(value.payload);
  if (Either.isLeft(payload)) {
    throw new Error(
      "An available Membership Provenance Attachment failed its exact decoder",
    );
  }
  return projectMembershipProvenancePayloadV1(payload.right);
}

export interface MembershipProvenanceProjectorDefinitionV1 {
  readonly family: typeof membershipProvenanceAttachmentFamilyV1;
  readonly project: (
    value: RecordAttachmentValue<MembershipProvenancePayloadV1>,
  ) => MembershipProvenancePayloadV1;
}

export function defineMembershipProvenanceProjectorV1(): MembershipProvenanceProjectorDefinitionV1 {
  return Object.freeze({
    family: membershipProvenanceAttachmentFamilyV1,
    project: projectMembershipProvenanceAttachmentV1,
  });
}

/** Re-exported for callers that construct an action's preserved issue refs. */
export type { RecordIssue };
