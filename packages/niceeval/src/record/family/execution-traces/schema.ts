import { Schema } from "effect";

import type { TraceJson } from "../../../adapter-execution-trace.ts";

const BoundedIdentifierSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(
  (value) => new TextEncoder().encode(value).byteLength > 0 &&
    new TextEncoder().encode(value).byteLength <= 256,
  { identifier: "ExecutionTraceIdentifier" },
)));
const SummarySchema = Schema.String.pipe(Schema.check(Schema.makeFilter(
  (value) => new TextEncoder().encode(value).byteLength <= 512,
  { identifier: "ExecutionTraceSummary" },
)));
const NonNegativeSafeIntegerSchema = Schema.Number.pipe(Schema.check(Schema.makeFilter(
  (value) => Number.isSafeInteger(value) && value >= 0,
  { identifier: "ExecutionTraceNonNegativeSafeInteger" },
)));
const PositiveSafeIntegerSchema = Schema.Number.pipe(Schema.check(Schema.makeFilter(
  (value) => Number.isSafeInteger(value) && value > 0,
  { identifier: "ExecutionTracePositiveSafeInteger" },
)));
const FiniteNumberSchema = Schema.Number.pipe(Schema.check(Schema.makeFilter(
  Number.isFinite,
  { identifier: "ExecutionTraceFiniteNumber" },
)));
const Sha256Schema = Schema.String.pipe(Schema.check(Schema.makeFilter(
  (value) => /^[0-9a-f]{64}$/u.test(value),
  { identifier: "ExecutionTraceSha256" },
)));

export const ExecutionTraceJsonSchema: Schema.Codec<TraceJson> = Schema.suspend(() => Schema.Union([
  Schema.Null,
  Schema.Boolean,
  FiniteNumberSchema,
  Schema.String,
  Schema.Array(ExecutionTraceJsonSchema),
  Schema.Record(Schema.String, ExecutionTraceJsonSchema),
]));

const CollectionSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: Schema.Tuple([]),
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(Schema.Struct({
      code: BoundedIdentifierSchema,
      message: Schema.String,
    })),
  }),
]);

const ScopeSchema = Schema.Struct({
  scopeId: BoundedIdentifierSchema,
  label: Schema.String,
  boundary: ExecutionTraceJsonSchema,
});

const LinkSchema = Schema.Union([
  Schema.Struct({ relation: BoundedIdentifierSchema, targetKey: BoundedIdentifierSchema }),
  Schema.Struct({
    relation: BoundedIdentifierSchema,
    unresolved: Schema.Struct({
      sourceEventId: BoundedIdentifierSchema,
      reason: Schema.String,
    }),
  }),
]);

const InputEvidenceSchema = Schema.Struct({
  key: BoundedIdentifierSchema,
  label: Schema.String,
  artifactId: BoundedIdentifierSchema,
  pointer: Schema.String,
});

const InputEventSchema = Schema.Struct({
  key: BoundedIdentifierSchema,
  type: BoundedIdentifierSchema,
  source: Schema.Struct({
    id: BoundedIdentifierSchema,
    eventId: Schema.optional(BoundedIdentifierSchema),
    sequence: Schema.optional(NonNegativeSafeIntegerSchema),
  }),
  actor: Schema.optional(Schema.Struct({
    id: BoundedIdentifierSchema,
    label: Schema.optional(Schema.String),
  })),
  time: Schema.optional(Schema.Struct({
    clockId: BoundedIdentifierSchema,
    value: FiniteNumberSchema,
    unit: BoundedIdentifierSchema,
  })),
  summary: SummarySchema,
  payload: Schema.optional(ExecutionTraceJsonSchema),
  links: Schema.optional(Schema.Array(LinkSchema)),
  evidence: Schema.optional(Schema.Array(InputEvidenceSchema)),
  scopeMemberships: Schema.optional(Schema.Array(Schema.Struct({
    scopeId: BoundedIdentifierSchema,
    state: Schema.Literals(["included", "excluded", "unknown"]),
  }))),
});

export const ExecutionTraceInputSchema = Schema.Struct({
  traceId: BoundedIdentifierSchema,
  schema: Schema.Struct({ id: BoundedIdentifierSchema }),
  collection: CollectionSchema,
  scopes: Schema.Array(ScopeSchema),
  events: Schema.Array(InputEventSchema),
});

export const ExecutionTraceHeaderRecordSchema = Schema.Struct({
  kind: Schema.Literal("trace-header"),
  traceId: BoundedIdentifierSchema,
  sourceTraceId: BoundedIdentifierSchema,
  // Legacy producer metadata is read unchanged, never synthesized for new traces.
  schema: Schema.Struct({ id: BoundedIdentifierSchema, revision: Schema.optional(NonNegativeSafeIntegerSchema) }),
  collection: CollectionSchema,
  scopes: Schema.Array(ScopeSchema),
});

export const ExecutionTraceEventRecordSchema = Schema.Struct({
  kind: Schema.Literal("event"),
  traceId: BoundedIdentifierSchema,
  eventId: BoundedIdentifierSchema,
  ordinal: NonNegativeSafeIntegerSchema,
  key: BoundedIdentifierSchema,
  type: BoundedIdentifierSchema,
  source: Schema.Struct({
    id: BoundedIdentifierSchema,
    eventId: Schema.optional(BoundedIdentifierSchema),
    sequence: Schema.optional(NonNegativeSafeIntegerSchema),
  }),
  actor: Schema.optional(Schema.Struct({
    id: BoundedIdentifierSchema,
    label: Schema.optional(Schema.String),
  })),
  time: Schema.optional(Schema.Struct({
    clockId: BoundedIdentifierSchema,
    value: FiniteNumberSchema,
    unit: BoundedIdentifierSchema,
  })),
  summary: SummarySchema,
  payload: Schema.optional(ExecutionTraceJsonSchema),
  links: Schema.Array(LinkSchema),
  evidence: Schema.Array(Schema.Struct({
    key: BoundedIdentifierSchema,
    label: Schema.String,
    artifactId: BoundedIdentifierSchema,
    pointer: Schema.String,
    evidenceId: BoundedIdentifierSchema,
    artifactSha256: Sha256Schema,
    targetSha256: Sha256Schema,
    targetByteLength: NonNegativeSafeIntegerSchema,
  })),
  scopeMemberships: Schema.Array(Schema.Struct({
    scopeId: BoundedIdentifierSchema,
    state: Schema.Literals(["included", "excluded", "unknown"]),
  })),
});

export const ExecutionTraceRecordSchema = Schema.Union([
  ExecutionTraceHeaderRecordSchema,
  ExecutionTraceEventRecordSchema,
]);

export type ExecutionTraceHeaderRecord = Schema.Schema.Type<typeof ExecutionTraceHeaderRecordSchema>;
export type ExecutionTraceEventRecord = Schema.Schema.Type<typeof ExecutionTraceEventRecordSchema>;
export type ExecutionTraceRecord = Schema.Schema.Type<typeof ExecutionTraceRecordSchema>;

export const ExecutionTraceRecordLimits = Object.freeze({
  maximumTraces: 32,
  maximumEvents: 100_000,
  maximumCanonicalInputBytes: 64 * 1024 * 1024,
  maximumPayloadBytes: 16 * 1024,
  maximumSummaryBytes: 512,
  maximumLinksPerEvent: 32,
  maximumEvidencePerEvent: 8,
  maximumScopesPerEvent: 8,
  maximumJsonDepth: 32,
  maximumIdentifierBytes: 256,
  maximumEvidenceSourceBytes: 256 * 1024 * 1024,
  maximumEvidenceTargetBytes: 128 * 1024 * 1024,
  maximumDetailPreviewBytes: 2 * 1024,
  maximumDetailBytes: 512 * 1024,
  maximumOutlineEvents: 32,
  maximumOutlineBytes: 64 * 1024,
});
