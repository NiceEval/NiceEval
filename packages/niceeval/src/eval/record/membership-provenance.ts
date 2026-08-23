import { Either, Schema } from "effect";
import { AttemptIdSchema, RunIdSchema, SlotIdSchema, UtcMillisSchema } from "../../record/codec/identifiers.ts";
import { RecordIssueSchema, type RecordIssue } from "../../record/errors/record-errors.ts";
import type { SlotId } from "../../record/model/identifiers.ts";
import { isJsonValue } from "../../shared/json-value.ts";
import { ExactEvaluationParseOptions, FiniteNonNegativeNumberSchema } from "./attachment.ts";

/**
 * These are transient policy explanations. Published member action and exact
 * Attempt reference are Core documents, so provenance never creates a sixth
 * Record family.
 */
export const MEMBERSHIP_POLICY_NAME_MAXIMUM_LENGTH = 255 as const;
const PolicyName = Schema.String.pipe(Schema.filter(
  (value) => value.length > 0 && value.length <= MEMBERSHIP_POLICY_NAME_MAXIMUM_LENGTH,
));
export const MembershipPolicyIdentitySchema = Schema.Struct({
  name: PolicyName,
  version: FiniteNonNegativeNumberSchema.pipe(Schema.int(), Schema.positive()),
});
export type MembershipPolicyIdentity = Schema.Schema.Type<typeof MembershipPolicyIdentitySchema>;

export const MembershipSourceBarrierSchema = Schema.Struct({ runId: RunIdSchema, startedAt: UtcMillisSchema });
export type MembershipSourceBarrier = Schema.Schema.Type<typeof MembershipSourceBarrierSchema>;
export const MembershipAttemptOriginSchema = Schema.Struct({ runId: RunIdSchema, slotId: SlotIdSchema });
export type MembershipAttemptOrigin = Schema.Schema.Type<typeof MembershipAttemptOriginSchema>;

export const ComparisonAttachmentSchema = Schema.Literal(
  "core",
  "niceeval.assertions",
  "niceeval.runner-activities",
);
export type ComparisonAttachment = Schema.Schema.Type<typeof ComparisonAttachmentSchema>;
export const RecordedAttemptClaimSchema = Schema.Literal(
  "execution-identity",
  "attempt-outcome",
  "assertion-verdict",
  "execution-duration",
);
export type RecordedAttemptClaim = Schema.Schema.Type<typeof RecordedAttemptClaimSchema>;
export const ComparisonSourceStateSchema = Schema.Literal("available", "unavailable", "unsupported", "invalid");
export type ComparisonSourceState = Schema.Schema.Type<typeof ComparisonSourceStateSchema>;
export const ComparisonResultSchema = Schema.Literal("match", "mismatch", "ineligible", "not-comparable");
export type ComparisonResult = Schema.Schema.Type<typeof ComparisonResultSchema>;
export const ComparisonProvenanceSchema = Schema.Struct({
  attachment: ComparisonAttachmentSchema,
  recordedClaim: RecordedAttemptClaimSchema,
  sourceState: ComparisonSourceStateSchema,
  result: ComparisonResultSchema,
  reason: Schema.String,
});
export type ComparisonProvenance = Schema.Schema.Type<typeof ComparisonProvenanceSchema>;

export const ExecutionGapReasonSchema = Schema.String;
export type ExecutionGapReason = Schema.Schema.Type<typeof ExecutionGapReasonSchema>;
export const ExecutionGapScopeSchema = Schema.Literal("slot", "experiment", "target");
export type ExecutionGapScope = Schema.Schema.Type<typeof ExecutionGapScopeSchema>;
export const MembershipGapSchema = Schema.Struct({
  reason: ExecutionGapReasonSchema,
  scope: ExecutionGapScopeSchema,
  issues: Schema.Array(RecordIssueSchema),
  sourceBarrier: Schema.optional(MembershipSourceBarrierSchema),
});
export type MembershipGap = Schema.Schema.Type<typeof MembershipGapSchema>;

const Carried = Schema.Struct({
  action: Schema.Literal("carried"), slotId: SlotIdSchema, attemptId: AttemptIdSchema,
  origin: MembershipAttemptOriginSchema, sourceBarrier: MembershipSourceBarrierSchema,
  comparisons: Schema.Array(ComparisonProvenanceSchema),
});
const Accepted = Schema.Struct({
  action: Schema.Literal("accepted"), slotId: SlotIdSchema, attemptId: AttemptIdSchema,
  origin: MembershipAttemptOriginSchema, comparisons: Schema.Array(ComparisonProvenanceSchema),
  sourceBarrier: Schema.optional(MembershipSourceBarrierSchema), locator: Schema.optional(Schema.String), operatorReason: Schema.optional(Schema.String),
});
const Executed = Schema.Struct({ action: Schema.Literal("executed"), slotId: SlotIdSchema, attemptId: AttemptIdSchema, gap: MembershipGapSchema, comparisons: Schema.Array(ComparisonProvenanceSchema) });
const NotDispatched = Schema.Struct({ action: Schema.Literal("not-dispatched"), slotId: SlotIdSchema, gap: MembershipGapSchema, comparisons: Schema.Array(ComparisonProvenanceSchema) });
const Interrupted = Schema.Struct({ action: Schema.Literal("interrupted"), slotId: SlotIdSchema, gap: MembershipGapSchema, comparisons: Schema.Array(ComparisonProvenanceSchema) });
export const MembershipActionSchema = Schema.Union(Carried, Accepted, Executed, NotDispatched, Interrupted);
export type MembershipAction = Schema.Schema.Type<typeof MembershipActionSchema>;

export type MembershipEffectiveOptions = null | boolean | number | string | readonly MembershipEffectiveOptions[] | { readonly [key: string]: MembershipEffectiveOptions };
export const MembershipEffectiveOptionsSchema: Schema.Schema<MembershipEffectiveOptions> = Schema.declare<MembershipEffectiveOptions>(isJsonValue);

/** A non-durable action explanation passed between policy and Core writer. */
export const MembershipProvenancePayloadSchema = Schema.Struct({
  policy: MembershipPolicyIdentitySchema,
  effectiveOptions: MembershipEffectiveOptionsSchema,
  actions: Schema.Array(MembershipActionSchema),
}).pipe(Schema.filter((payload) => new Set(payload.actions.map((action) => action.slotId)).size === payload.actions.length));
export type MembershipProvenancePayload = Schema.Schema.Type<typeof MembershipProvenancePayloadSchema>;
export type MembershipProvenancePayloadIssue = { readonly code: "membership-provenance-slot-duplicate"; readonly slotId: string };
export type MembershipProvenancePayloadBuildError =
  | { readonly code: "membership-provenance-payload-schema-invalid" }
  | { readonly code: "membership-provenance-payload-coherence-invalid"; readonly issues: readonly MembershipProvenancePayloadIssue[] };

export function validateMembershipProvenancePayload(payload: MembershipProvenancePayload): readonly MembershipProvenancePayloadIssue[] {
  const seen = new Set<string>();
  const issues: MembershipProvenancePayloadIssue[] = [];
  for (const action of payload.actions) {
    if (seen.has(action.slotId)) issues.push(Object.freeze({ code: "membership-provenance-slot-duplicate" as const, slotId: action.slotId }));
    seen.add(action.slotId);
  }
  return Object.freeze(issues);
}

export function buildMembershipProvenancePayload(input: MembershipProvenancePayload): Either.Either<MembershipProvenancePayload, MembershipProvenancePayloadBuildError> {
  const decoded = Schema.decodeUnknownEither(MembershipProvenancePayloadSchema, ExactEvaluationParseOptions)(input);
  if (Either.isLeft(decoded)) return Either.left(Object.freeze({ code: "membership-provenance-payload-schema-invalid" as const }));
  return Either.right(decoded.right);
}

export type { RecordIssue };
