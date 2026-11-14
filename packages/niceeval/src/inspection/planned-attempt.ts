import * as Schema from "effect/Schema";
import {
  AttemptDocumentSchema,
  MemberDocumentSchema,
  RecordSlotIdentitySchema,
  RunDocumentSchema,
} from "../record/codec/core.ts";
import type { AttemptDocument, MemberDocument, RunDocument } from "../record/model/core.ts";
import {
  RunAbsentPublicationSchema,
  RunPendingPublicationSchema,
  RunPublishedPublicationSchema,
} from "../run/protocol.ts";

// Inspection names are independent of the immutable Record and identity encoding.
const { slotId: plannedAttemptId, ...positionFields } = RecordSlotIdentitySchema.fields;
export const PlannedAttemptSchema = Schema.Struct({ plannedAttemptId, ...positionFields });
const { slotId: attemptPosition, ...attemptFields } = AttemptDocumentSchema.fields;
export const InspectionAttemptCoreSchema = Schema.Struct({ plannedAttemptId: attemptPosition, ...attemptFields }).check(
  Schema.makeFilter(({ plannedAttemptId, ...attempt }) =>
    Schema.is(AttemptDocumentSchema)({ ...attempt, slotId: plannedAttemptId }),
  ),
);
const { expectedSlots: _expectedSlots, ...runFields } = RunDocumentSchema.fields;
export const InspectionRunCoreSchema = Schema.Struct({
  ...runFields,
  plannedAttempts: Schema.Array(PlannedAttemptSchema),
}).check(
  Schema.makeFilter(({ plannedAttempts, ...run }) =>
    Schema.is(RunDocumentSchema)({
      ...run,
      expectedSlots: plannedAttempts.map(({ plannedAttemptId, ...position }) => ({
        ...position,
        slotId: plannedAttemptId,
      })),
    }),
  ),
);
export const InspectionMemberSchema = Schema.Union(
  MemberDocumentSchema.members.map((member) => {
    const { slotId, ...fields } = member.fields;
    return Schema.Struct({ plannedAttemptId: slotId, ...fields });
  }),
).check(
  Schema.makeFilter(({ plannedAttemptId, ...member }) =>
    Schema.is(MemberDocumentSchema)({ ...member, slotId: plannedAttemptId }),
  ),
);
const { originSlotId, ...publicationFields } = RunPublishedPublicationSchema.fields;
export const InspectionPublishedPublicationSchema = Schema.Struct({
  ...publicationFields,
  originPlannedAttemptId: originSlotId,
});
export const PlannedAttemptPublicationSchema = Schema.Union([
  RunPendingPublicationSchema,
  InspectionPublishedPublicationSchema,
  RunAbsentPublicationSchema,
]);

export function projectPlannedAttempt({
  slotId,
  ...position
}: {
  readonly slotId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly executionIdentityDigest: string;
}) {
  return Object.freeze(Schema.decodeUnknownSync(PlannedAttemptSchema)({ ...position, plannedAttemptId: slotId }));
}
export function projectAttemptCore({ slotId, ...attempt }: AttemptDocument) {
  return Object.freeze({ ...attempt, plannedAttemptId: slotId });
}
export function projectRunCore({ expectedSlots, ...run }: RunDocument) {
  return Object.freeze({ ...run, plannedAttempts: Object.freeze(expectedSlots.map(projectPlannedAttempt)) });
}
export function projectMember({ slotId, ...member }: MemberDocument) {
  return Object.freeze({ ...member, plannedAttemptId: slotId });
}
