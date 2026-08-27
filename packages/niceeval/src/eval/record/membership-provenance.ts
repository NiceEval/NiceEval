import { Result, Schema } from "effect";
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
const PolicyName = Schema.String.pipe(Schema.refine(
  (value): value is string => value.length > 0 && value.length <= MEMBERSHIP_POLICY_NAME_MAXIMUM_LENGTH,
));
export const MembershipPolicyIdentitySchema = Schema.Struct({
  name: PolicyName,
  version: FiniteNonNegativeNumberSchema.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
export type MembershipPolicyIdentity = Schema.toType<typeof MembershipPolicyIdentitySchema>["Type"];

export const MembershipSourceBarrierSchema = Schema.Struct({ runId: RunIdSchema, startedAt: UtcMillisSchema });
export type MembershipSourceBarrier = Schema.toType<typeof MembershipSourceBarrierSchema>["Type"];
export const MembershipAttemptOriginSchema = Schema.Struct({ runId: RunIdSchema, slotId: SlotIdSchema });
export type MembershipAttemptOrigin = Schema.toType<typeof MembershipAttemptOriginSchema>["Type"];

export const ComparisonAttachmentSchema = Schema.Literals([
  "core",
  "niceeval.assertions",
  "niceeval.runner-activities",
]);
export type ComparisonAttachment = Schema.toType<typeof ComparisonAttachmentSchema>["Type"];
export const RecordedAttemptClaimSchema = Schema.Literals([
  "execution-identity",
  "attempt-outcome",
  "assertion-verdict",
  "execution-duration",
]);
export type RecordedAttemptClaim = Schema.toType<typeof RecordedAttemptClaimSchema>["Type"];
export const ComparisonSourceStateSchema = Schema.Literals(["available", "unavailable", "unsupported", "invalid"]);
export type ComparisonSourceState = Schema.toType<typeof ComparisonSourceStateSchema>["Type"];
export const ComparisonResultSchema = Schema.Literals(["match", "mismatch", "ineligible", "not-comparable"]);
export type ComparisonResult = Schema.toType<typeof ComparisonResultSchema>["Type"];
export const ComparisonProvenanceSchema = Schema.Struct({
  attachment: ComparisonAttachmentSchema,
  recordedClaim: RecordedAttemptClaimSchema,
  sourceState: ComparisonSourceStateSchema,
  result: ComparisonResultSchema,
  reason: Schema.String,
});
export type ComparisonProvenance = Schema.toType<typeof ComparisonProvenanceSchema>["Type"];

export const ExecutionGapReasonSchema = Schema.String;
export type ExecutionGapReason = Schema.toType<typeof ExecutionGapReasonSchema>["Type"];
export const ExecutionGapScopeSchema = Schema.Literals(["slot", "experiment", "target"]);
export type ExecutionGapScope = Schema.toType<typeof ExecutionGapScopeSchema>["Type"];
export const MembershipGapSchema = Schema.Struct({
  reason: ExecutionGapReasonSchema,
  scope: ExecutionGapScopeSchema,
  issues: Schema.Array(RecordIssueSchema),
  sourceBarrier: Schema.optional(MembershipSourceBarrierSchema),
});
export type MembershipGap = Schema.toType<typeof MembershipGapSchema>["Type"];

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
export const MembershipActionSchema = Schema.Union([Carried, Accepted, Executed, NotDispatched, Interrupted]);
export type MembershipAction = Schema.toType<typeof MembershipActionSchema>["Type"];

export type MembershipEffectiveOptions = null | boolean | number | string | readonly MembershipEffectiveOptions[] | { readonly [key: string]: MembershipEffectiveOptions };
export const MembershipEffectiveOptionsSchema = Schema.declare<MembershipEffectiveOptions>(isJsonValue).pipe(Schema.toType);

/** A non-durable action explanation passed between policy and Core writer. */
export const MembershipProvenancePayloadSchema = Schema.Struct({
  policy: MembershipPolicyIdentitySchema,
  effectiveOptions: MembershipEffectiveOptionsSchema,
  actions: Schema.Array(MembershipActionSchema),
}).pipe(Schema.refine((payload): payload is typeof payload => new Set(payload.actions.map((action) => action.slotId)).size === payload.actions.length));
export type MembershipProvenancePayload = Schema.toType<typeof MembershipProvenancePayloadSchema>["Type"];
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

export function buildMembershipProvenancePayload(input: MembershipProvenancePayload): Result.Result<MembershipProvenancePayload, MembershipProvenancePayloadBuildError> {
  const decoded = Schema.decodeUnknownResult(Schema.toType(MembershipProvenancePayloadSchema), ExactEvaluationParseOptions)(input);
  if (Result.isFailure(decoded)) return Result.fail(Object.freeze({ code: "membership-provenance-payload-schema-invalid" as const }));
  return Result.succeed(decoded.success);
}

export type { RecordIssue };
