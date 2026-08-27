import { Schema } from "effect";
import {
  defineRecordCore,
  type RecordSchemaLimits,
} from "../definition/index.ts";
import {
  AttemptIdSchema,
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  ExperimentIdSchema,
  RecordFormatSchema,
  RecordIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../codec/identifiers.ts";
import type {
  AttemptOutcome,
  MemberDocument,
  MembershipAction,
} from "./core.ts";
import { RunContextSchema } from "./run-context.ts";
import {
  validateAttemptDocument,
  validateMemberDocument,
  validateRecordCore,
  validateRunDocument,
} from "./validation.ts";
import type { RecordIssue } from "../errors/record-errors.ts";

/** Full durable-document budget; Host separately caps each read at 1 MiB. */
export const RecordCoreDocumentLimits: RecordSchemaLimits = Object.freeze({
  maximumJsonBytes: 1024 * 1024,
  maximumDepth: 8,
  maximumNodes: 4_096,
  maximumObjectKeys: 64,
  maximumArrayItems: 256,
  maximumKeyUtf8Bytes: 256,
  maximumStringUtf8Bytes: 8 * 1024,
});

/** The in-memory aggregate has the same hostile-JS rules but a larger run list. */
export const RecordCoreAggregateLimits: RecordSchemaLimits = Object.freeze({
  ...RecordCoreDocumentLimits,
  maximumJsonBytes: 8 * 1024 * 1024,
  maximumNodes: 32_768,
  maximumArrayItems: 4_096,
});

function schemaFilterIssues(
  issues: readonly RecordIssue[],
): readonly Schema.FilterIssue[] | undefined {
  return issues.length === 0
    ? undefined
    : issues.map((issue) => ({
      path: issue.path,
      issue: issue.code,
    }));
}

const AttemptOutcomeSchema = Schema.Literals([
  "completed",
  "errored",
  "cancelled",
  "interrupted",
]);

const MembershipActionSchema = Schema.Literals([
  "executed",
  "carried",
  "accepted",
  "not-dispatched",
  "interrupted",
]);

/** Durable Slot ordinals are zero-based JSON-safe integers, not array indexes. */
const AttemptOrdinalSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter(
    (value) => Number.isSafeInteger(value) && value >= 0,
    {
      identifier: "RecordAttemptOrdinal",
      description: "a zero-based non-negative JSON-safe attempt ordinal",
    },
  )),
);

const RecordAttemptRefCurrentSchema = Schema.Struct({
  originRunId: RunIdSchema,
  attemptId: AttemptIdSchema,
});

export const RecordAttemptRefDefinition = defineRecordCore({
  schema: RecordAttemptRefCurrentSchema,
  limits: RecordCoreDocumentLimits,
});

export const RecordAttemptRefSchema = RecordAttemptRefDefinition.schema;

const RecordSlotIdentityCurrentSchema = Schema.Struct({
  slotId: SlotIdSchema,
  evalId: EvalIdSchema,
  attemptOrdinal: AttemptOrdinalSchema,
  executionIdentityDigest: ExecutionIdentityDigestSchema,
});

export const RecordSlotIdentityDefinition = defineRecordCore({
  schema: RecordSlotIdentityCurrentSchema,
  limits: RecordCoreDocumentLimits,
});

export const RecordSlotIdentitySchema = RecordSlotIdentityDefinition.schema;

const RecordDocumentCurrentSchema = Schema.Struct({
  format: RecordFormatSchema,
  recordId: RecordIdSchema,
});

/** The exact versionless root header definition. */
export const RecordDocumentDefinition = defineRecordCore({
  schema: RecordDocumentCurrentSchema,
  limits: RecordCoreDocumentLimits,
});

export const RecordDocumentSchema = RecordDocumentDefinition.schema;

const RunDocumentCurrentSchema = Schema.Struct({
  runId: RunIdSchema,
  experimentId: ExperimentIdSchema,
  context: RunContextSchema,
  startedAt: UtcMillisSchema,
  completedAt: UtcMillisSchema,
  expectedSlots: Schema.Array(RecordSlotIdentitySchema),
}).pipe(
  Schema.check(Schema.makeFilter(
    (value) => schemaFilterIssues(validateRunDocument(value)),
    {
      identifier: "RecordRunDocumentInvariant",
      description: "a Run document with valid chronology, context, and expected Slots",
    },
  )),
);

/** Current sealed `run.json`; its contextual and ordering axioms live in this Schema. */
export const RunDocumentDefinition = defineRecordCore({
  schema: RunDocumentCurrentSchema,
  limits: RecordCoreDocumentLimits,
});

export const RunDocumentSchema = RunDocumentDefinition.schema;

const MemberDocumentCurrentSchema = Schema.Union([
  Schema.Struct({
    slotId: SlotIdSchema,
    action: Schema.Literals(["executed", "carried", "accepted"]),
    attempt: RecordAttemptRefSchema,
  }),
  Schema.Struct({
    slotId: SlotIdSchema,
    action: Schema.Literals(["not-dispatched", "interrupted"]),
    attempt: Schema.Null,
  }),
]).pipe(
  Schema.check(Schema.makeFilter(
    (value) => schemaFilterIssues(validateMemberDocument(value)),
    {
      identifier: "RecordMemberDocumentInvariant",
      description: "a Member action paired with its required Attempt reference",
    },
  )),
);

/** Current `members/<SlotId>.json`; action/reference coupling lives in this Schema. */
export const MemberDocumentDefinition = defineRecordCore({
  schema: MemberDocumentCurrentSchema,
  limits: RecordCoreDocumentLimits,
});

export const MemberDocumentSchema = MemberDocumentDefinition.schema;

const AttemptDocumentCurrentSchema = Schema.Struct({
  attemptId: AttemptIdSchema,
  originRunId: RunIdSchema,
  slotId: SlotIdSchema,
  evalId: EvalIdSchema,
  executionIdentityDigest: ExecutionIdentityDigestSchema,
  outcome: AttemptOutcomeSchema,
}).pipe(
  Schema.check(Schema.makeFilter(
    (value) => schemaFilterIssues(validateAttemptDocument(value)),
    {
      identifier: "RecordAttemptDocumentInvariant",
      description: "an Attempt document satisfying its local invariant",
    },
  )),
);

/** Current immutable `attempt.json`; aggregate ownership is checked by Record Core. */
export const AttemptDocumentDefinition = defineRecordCore({
  schema: AttemptDocumentCurrentSchema,
  limits: RecordCoreDocumentLimits,
});

export const AttemptDocumentSchema = AttemptDocumentDefinition.schema;

const RunCoreCurrentSchema = Schema.Struct({
  run: RunDocumentSchema,
  members: Schema.Array(MemberDocumentSchema),
  attempts: Schema.Array(AttemptDocumentSchema),
});

export const RunCoreDefinition = defineRecordCore({
  schema: RunCoreCurrentSchema,
  limits: RecordCoreAggregateLimits,
});

export const RunCoreSchema = RunCoreDefinition.schema;

const RecordCoreCurrentSchema = Schema.Struct({
  record: RecordDocumentSchema,
  runs: Schema.Array(RunCoreSchema),
}).pipe(
  Schema.check(Schema.makeFilter(
    (value) => schemaFilterIssues(validateRecordCore(value)),
    {
      identifier: "RecordCoreInvariant",
      description: "a complete Record Core with consistent Run, Member, and Attempt documents",
    },
  )),
);

/** Cross-document Run/Member/Attempt axioms are owned by this Schema. */
export const RecordCoreDefinition = defineRecordCore({
  schema: RecordCoreCurrentSchema,
  limits: RecordCoreAggregateLimits,
});

export const RecordCoreSchema = RecordCoreDefinition.schema;
