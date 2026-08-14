import { Either, Schema } from "effect";
import {
  defineRecordCore,
  defineRecordProperty,
  type RecordValueLimits,
} from "../definition/index.ts";
import {
  AttemptIdSchema,
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  ExperimentIdSchema,
  RecordFormatSchema,
  RecordIdSchema,
  RecordSchemaVersionSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../codec/identifiers.ts";
import type {
  AttemptDocument,
  AttemptOutcome,
  MemberDocument,
  MembershipAction,
  RecordAttemptRef,
  RecordCore,
  RecordDocument,
  RecordSlotIdentity,
  RunCore,
  RunDocument,
} from "./core.ts";
import { RunContextSchema } from "./run-context.ts";
import {
  validateAttemptDocument,
  validateMemberDocument,
  validateRecordCore,
  validateRunDocument,
} from "./validation.ts";

/** Full durable-document budget; Host separately caps each read at 1 MiB. */
export const RecordCoreDocumentLimits: RecordValueLimits = Object.freeze({
  maximumJsonBytes: 1024 * 1024,
  maximumDepth: 8,
  maximumNodes: 4_096,
  maximumObjectKeys: 64,
  maximumArrayItems: 256,
  maximumKeyUtf8Bytes: 256,
  maximumStringUtf8Bytes: 8 * 1024,
});

/** The in-memory aggregate has the same hostile-JS rules but a larger run list. */
export const RecordCoreAggregateLimits: RecordValueLimits = Object.freeze({
  ...RecordCoreDocumentLimits,
  maximumJsonBytes: 8 * 1024 * 1024,
  maximumNodes: 32_768,
  maximumArrayItems: 4_096,
});

const AttemptOutcomeSchema: Schema.Schema<AttemptOutcome> = Schema.Literal(
  "completed",
  "errored",
  "cancelled",
  "interrupted",
);

const MembershipActionSchema: Schema.Schema<MembershipAction> = Schema.Literal(
  "executed",
  "carried",
  "accepted",
  "not-dispatched",
  "interrupted",
);

/** Durable Slot ordinals are zero-based JSON-safe integers, not array indexes. */
const AttemptOrdinalSchema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
    {
      identifier: "RecordAttemptOrdinal",
      description: "a zero-based non-negative JSON-safe attempt ordinal",
    },
  ),
);

/** Stable Record property identities; their TS fields and durable keys are distinct namespaces. */
const RecordAttemptRefProperties = Object.freeze({
  originRunId: defineRecordProperty({
    id: "niceeval.record.attempt-ref.origin-run",
    durableKey: "originRunId",
    schema: RunIdSchema,
  }),
  attemptId: defineRecordProperty({
    id: "niceeval.record.attempt-ref.attempt",
    durableKey: "attemptId",
    schema: AttemptIdSchema,
  }),
});

export const RecordAttemptRefDefinition = defineRecordCore({
  properties: RecordAttemptRefProperties,
  limits: RecordCoreDocumentLimits,
});

export const RecordAttemptRefSchema: Schema.Schema<RecordAttemptRef> =
  RecordAttemptRefDefinition.schema;

const RecordSlotIdentityProperties = Object.freeze({
  slotId: defineRecordProperty({
    id: "niceeval.record.slot-identity.slot",
    durableKey: "slotId",
    schema: SlotIdSchema,
  }),
  evalId: defineRecordProperty({
    id: "niceeval.record.slot-identity.eval",
    durableKey: "evalId",
    schema: EvalIdSchema,
  }),
  attemptOrdinal: defineRecordProperty({
    id: "niceeval.record.slot-identity.attempt-ordinal",
    durableKey: "attemptOrdinal",
    schema: AttemptOrdinalSchema,
  }),
  executionIdentityDigest: defineRecordProperty({
    id: "niceeval.record.slot-identity.execution",
    durableKey: "executionIdentityDigest",
    schema: ExecutionIdentityDigestSchema,
  }),
});

export const RecordSlotIdentityDefinition = defineRecordCore({
  properties: RecordSlotIdentityProperties,
  limits: RecordCoreDocumentLimits,
});

export const RecordSlotIdentitySchema: Schema.Schema<RecordSlotIdentity> =
  RecordSlotIdentityDefinition.schema;

const RecordDocumentProperties = Object.freeze({
  format: defineRecordProperty({
    id: "niceeval.record.root.format",
    durableKey: "format",
    schema: RecordFormatSchema,
  }),
  schemaVersion: defineRecordProperty({
    id: "niceeval.record.root.schema-version",
    durableKey: "schemaVersion",
    schema: RecordSchemaVersionSchema,
  }),
  recordId: defineRecordProperty({
    id: "niceeval.record.root.record-id",
    durableKey: "recordId",
    schema: RecordIdSchema,
  }),
});

/** The current root header definition, with identity separate from numeric version. */
export const RecordDocumentDefinition = defineRecordCore({
  properties: RecordDocumentProperties,
  limits: RecordCoreDocumentLimits,
});

export const RecordDocumentSchema: Schema.Schema<RecordDocument> =
  RecordDocumentDefinition.schema;

const RunDocumentProperties = Object.freeze({
  runId: defineRecordProperty({
    id: "niceeval.record.run.id",
    durableKey: "runId",
    schema: RunIdSchema,
  }),
  experimentId: defineRecordProperty({
    id: "niceeval.record.run.experiment",
    durableKey: "experimentId",
    schema: ExperimentIdSchema,
  }),
  context: defineRecordProperty({
    id: "niceeval.record.run.context",
    durableKey: "context",
    schema: RunContextSchema,
  }),
  startedAt: defineRecordProperty({
    id: "niceeval.record.run.started-at",
    durableKey: "startedAt",
    schema: UtcMillisSchema,
  }),
  completedAt: defineRecordProperty({
    id: "niceeval.record.run.completed-at",
    durableKey: "completedAt",
    schema: UtcMillisSchema,
  }),
  expectedSlots: defineRecordProperty({
    id: "niceeval.record.run.expected-slots",
    durableKey: "expectedSlots",
    schema: Schema.Array(RecordSlotIdentitySchema),
  }),
});

/** Current sealed `run.json`; its contextual and ordering axioms live in Core refine. */
export const RunDocumentDefinition = defineRecordCore({
  properties: RunDocumentProperties,
  limits: RecordCoreDocumentLimits,
  refine: (value) => validateRunDocument(value as RunDocument),
});

export const RunDocumentSchema: Schema.Schema<RunDocument> = RunDocumentDefinition.schema;

const MemberDocumentProperties = Object.freeze({
  slotId: defineRecordProperty({
    id: "niceeval.record.member.slot",
    durableKey: "slotId",
    schema: SlotIdSchema,
  }),
  action: defineRecordProperty({
    id: "niceeval.record.member.action",
    durableKey: "action",
    schema: MembershipActionSchema,
  }),
  attempt: defineRecordProperty({
    id: "niceeval.record.member.attempt",
    durableKey: "attempt",
    schema: Schema.NullOr(RecordAttemptRefSchema),
  }),
});

/** Current `members/<SlotId>.json`; action/ref coupling is a Core refine. */
export const MemberDocumentDefinition = defineRecordCore({
  properties: MemberDocumentProperties,
  limits: RecordCoreDocumentLimits,
  refine: (value) => validateMemberDocument(value as MemberDocument),
});

export const MemberDocumentSchema: Schema.Schema<MemberDocument> = Schema.declare<MemberDocument>(
  (value): value is MemberDocument => Either.isRight(MemberDocumentDefinition.decode(value)),
);

const AttemptDocumentProperties = Object.freeze({
  attemptId: defineRecordProperty({
    id: "niceeval.record.attempt.id",
    durableKey: "attemptId",
    schema: AttemptIdSchema,
  }),
  originRunId: defineRecordProperty({
    id: "niceeval.record.attempt.origin-run",
    durableKey: "originRunId",
    schema: RunIdSchema,
  }),
  slotId: defineRecordProperty({
    id: "niceeval.record.attempt.slot",
    durableKey: "slotId",
    schema: SlotIdSchema,
  }),
  evalId: defineRecordProperty({
    id: "niceeval.record.attempt.eval",
    durableKey: "evalId",
    schema: EvalIdSchema,
  }),
  executionIdentityDigest: defineRecordProperty({
    id: "niceeval.record.attempt.execution",
    durableKey: "executionIdentityDigest",
    schema: ExecutionIdentityDigestSchema,
  }),
  outcome: defineRecordProperty({
    id: "niceeval.record.attempt.outcome",
    durableKey: "outcome",
    schema: AttemptOutcomeSchema,
  }),
});

/** Current immutable `attempt.json`; aggregate ownership is checked by Record Core refine. */
export const AttemptDocumentDefinition = defineRecordCore({
  properties: AttemptDocumentProperties,
  limits: RecordCoreDocumentLimits,
  refine: (value) => validateAttemptDocument(value as AttemptDocument),
});

export const AttemptDocumentSchema: Schema.Schema<AttemptDocument> =
  AttemptDocumentDefinition.schema;

const RunCoreProperties = Object.freeze({
  run: defineRecordProperty({
    id: "niceeval.record.run-core.run",
    durableKey: "run",
    schema: RunDocumentSchema,
  }),
  members: defineRecordProperty({
    id: "niceeval.record.run-core.members",
    durableKey: "members",
    schema: Schema.Array(MemberDocumentSchema),
  }),
  attempts: defineRecordProperty({
    id: "niceeval.record.run-core.attempts",
    durableKey: "attempts",
    schema: Schema.Array(AttemptDocumentSchema),
  }),
});

export const RunCoreDefinition = defineRecordCore({
  properties: RunCoreProperties,
  limits: RecordCoreAggregateLimits,
});

export const RunCoreSchema: Schema.Schema<RunCore> = RunCoreDefinition.schema;

const RecordCoreProperties = Object.freeze({
  record: defineRecordProperty({
    id: "niceeval.record.core.root",
    durableKey: "record",
    schema: RecordDocumentSchema,
  }),
  runs: defineRecordProperty({
    id: "niceeval.record.core.runs",
    durableKey: "runs",
    schema: Schema.Array(RunCoreSchema),
  }),
});

/** Cross-document Run/Member/Attempt axioms are owned only by this Core refine. */
export const RecordCoreDefinition = defineRecordCore({
  properties: RecordCoreProperties,
  limits: RecordCoreAggregateLimits,
  refine: (value) => validateRecordCore(value as RecordCore),
});

export const RecordCoreSchema: Schema.Schema<RecordCore> = RecordCoreDefinition.schema;
