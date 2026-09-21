import { Schema } from "effect";

import {
  AssertionCollectionReceiptSchema,
  AssertionConditionValueSchema,
  AssertionDisplaySchema,
  AssertionEntryIdSchema,
  AssertionFactValueSchema,
  createAssertionsRecordSchemas,
  MatcherOrderedSequenceResultSchema,
  MatcherQueryStepSchema,
  MatcherSourceSnapshotSchema,
  OrderEvaluationReceiptSchema,
} from "../assertions/record/codec.ts";
import { RecordAttachmentIssueCodeSchema } from "../record/attachment/errors.ts";
import type { ScoreMatchAudit, ScoreMatchAuditReadResult, ScoreMatchAuditV2, ScoreMatchAuditV3 } from "../assertions/score-match-audit.ts";
import { isJsonValue } from "../shared/json-value.ts";
import type { JsonValue } from "../shared/types.ts";

const ExpandedContentSchema = Schema.Struct({
  state: Schema.Literal("available"), byteLength: Schema.Number,
  sha256: Schema.String, base64: Schema.String,
});
const DeferredContentSchema = Schema.Struct({ state: Schema.Literal("available"), byteLength: Schema.Number, sha256: Schema.String });
const ProjectedMaterialSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
  Schema.Struct({
    kind: Schema.Literal("content"), content: Schema.Union([ExpandedContentSchema, DeferredContentSchema]),
    encoding: Schema.Literals(["json", "utf-8", "binary"]),
    byteLength: Schema.Number, preview: Schema.NullOr(Schema.String),
  }),
]);
const JudgeMaterialReadResultSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available"), request: Schema.String }),
  Schema.Struct({ state: Schema.Literal("invalid") }),
  Schema.Struct({ state: Schema.Literal("unsupported"), schemaVersion: Schema.Number }),
]);
const AuditFailureSchema = Schema.Struct({ state: Schema.Literals(["unavailable", "errored"]), code: Schema.String, message: Schema.String });
const AuditAttemptSchema = Schema.Struct({
  ordinal: Schema.Number,
  transport: Schema.Literal("attempted"),
  result: Schema.Union([
    Schema.Struct({ state: Schema.Literal("returned"), response: Schema.String }),
    Schema.Struct({ state: Schema.Literal("failed"), code: Schema.String, message: Schema.String }),
    Schema.Struct({ state: Schema.Literal("interrupted") }),
  ]),
});
const JsonValueSchema = Schema.declare<JsonValue>(isJsonValue);
const AuditCallSchema = Schema.Union([
  Schema.Struct({
    ordinal: Schema.Number, operation: Schema.Literals(["score", "classify", "extract", "batchClassify"]),
    state: Schema.Literal("rejected"), transport: Schema.Literal("not-sent"), failure: AuditFailureSchema,
  }),
  Schema.Struct({
    ordinal: Schema.Number, operation: Schema.Literals(["score", "classify", "extract", "batchClassify"]),
    state: Schema.Literal("admitted"), request: Schema.String, attempts: Schema.Array(AuditAttemptSchema),
    result: Schema.Union([
      Schema.Struct({ state: Schema.Literal("completed"), output: Schema.String }),
      AuditFailureSchema,
      Schema.Struct({ state: Schema.Literal("interrupted") }),
    ]),
  }),
]);
const ScoreMatchAuditSchema: Schema.Schema<ScoreMatchAudit> = Schema.Struct({
  schemaVersion: Schema.Literal(1), protocol: Schema.Literal("niceeval.score-match-audit/v1"),
  definition: Schema.Struct({
    name: Schema.String, version: Schema.String, config: Schema.String, digest: Schema.String,
    limits: Schema.Struct({ maxCalls: Schema.Number, maxMaterialBytes: Schema.Number, maxAuditBytes: Schema.Number }),
  }),
  input: Schema.String, calls: Schema.Array(AuditCallSchema),
  result: Schema.Union([
    Schema.Struct({ state: Schema.Literal("measured"), value: Schema.Number }),
    AuditFailureSchema,
    Schema.Struct({ state: Schema.Literal("interrupted") }),
  ]),
});
const ScoreInputSchema = Schema.Struct({
  rubric: Schema.String,
  anchors: Schema.Array(Schema.Struct({ measurement: Schema.Number, description: Schema.String })),
  material: JsonValueSchema,
});
const ClassifyInputSchema = Schema.Struct({ rubric: Schema.String, choices: Schema.Array(Schema.String), material: JsonValueSchema });
const BatchClassifyInputSchema = Schema.Struct({
  rubric: Schema.String,
  choices: Schema.Array(Schema.String),
  items: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
  material: JsonValueSchema,
});
const TypeSafeMappingSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("score"), input: ScoreInputSchema }),
  Schema.Struct({ operation: Schema.Literal("classify"), input: ClassifyInputSchema }),
  Schema.Struct({ operation: Schema.Literal("batchClassify"), input: BatchClassifyInputSchema }),
]);
const TypeSafeAuditCallSchema = Schema.Union([
  Schema.Struct({
    ordinal: Schema.Number, operation: Schema.Literals(["score", "classify", "extract", "batchClassify"]),
    state: Schema.Literal("rejected"), transport: Schema.Literal("not-sent"), failure: AuditFailureSchema,
  }),
  Schema.Struct({
    ordinal: Schema.Number, operation: Schema.Literals(["score", "classify", "batchClassify"]),
    state: Schema.Literal("admitted"), request: Schema.String, attempts: Schema.Array(AuditAttemptSchema),
    mapping: TypeSafeMappingSchema,
    result: Schema.Union([
      Schema.Struct({ state: Schema.Literal("completed"), output: Schema.String }),
      AuditFailureSchema,
      Schema.Struct({ state: Schema.Literal("interrupted") }),
    ]),
  }),
]);
const ScoreMatchAuditV2Schema: Schema.Schema<ScoreMatchAuditV2> = Schema.Struct({
  schemaVersion: Schema.Literal(2), protocol: Schema.Literal("niceeval.score-match-audit/v2"),
  definition: Schema.Struct({
    name: Schema.String, version: Schema.String, config: Schema.String, digest: Schema.String,
    limits: Schema.Struct({ maxCalls: Schema.Number, maxMaterialBytes: Schema.Number, maxAuditBytes: Schema.Number }),
  }),
  input: Schema.String, calls: Schema.Array(TypeSafeAuditCallSchema),
  result: Schema.Union([
    Schema.Struct({ state: Schema.Literal("measured"), value: Schema.Number }),
    AuditFailureSchema,
    Schema.Struct({ state: Schema.Literal("interrupted") }),
  ]),
});
const ScoreMatchAuditV3Schema: Schema.Schema<ScoreMatchAuditV3> = Schema.Struct({
  schemaVersion: Schema.Literal(3), protocol: Schema.Literal("niceeval.score-match-audit/v3"),
  definition: Schema.Struct({ name: Schema.String, version: Schema.String, config: Schema.String, digest: Schema.String,
    limits: Schema.Struct({ maxCalls: Schema.Number, maxMaterialBytes: Schema.Number, maxAuditBytes: Schema.Number }) }),
  input: Schema.String,
  images: Schema.Array(Schema.Struct({ imageId: Schema.String, evidenceIndex: Schema.Number,
    mediaType: Schema.Literals(["image/png", "image/jpeg"]), byteLength: Schema.Number, sha256: Schema.String,
    paths: Schema.Array(Schema.String) })),
  calls: Schema.Array(Schema.Union([
    Schema.Struct({ ordinal: Schema.Number, operation: Schema.Literals(["score", "classify", "extract", "batchClassify"]),
      state: Schema.Literal("rejected"), transport: Schema.Literal("not-sent"), failure: AuditFailureSchema }),
    Schema.Struct({ ordinal: Schema.Number, operation: Schema.Literals(["score", "classify", "extract", "batchClassify"]),
      state: Schema.Literal("admitted"), requestTemplate: Schema.String,
      wireBody: Schema.Struct({ byteLength: Schema.Number, sha256: Schema.String }), attempts: Schema.Array(AuditAttemptSchema),
      result: AuditCallSchema.members[1]!.fields.result }),
  ])),
  result: Schema.Union([Schema.Struct({ state: Schema.Literal("measured"), value: Schema.Number }), AuditFailureSchema,
    Schema.Struct({ state: Schema.Literal("interrupted") })]),
});
const ScoreMatchAuditReadResultSchema: Schema.Schema<ScoreMatchAuditReadResult> = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available"), audit: Schema.Union([ScoreMatchAuditSchema, ScoreMatchAuditV2Schema, ScoreMatchAuditV3Schema]) }),
  Schema.Struct({ state: Schema.Literal("invalid") }),
  Schema.Struct({ state: Schema.Literal("unsupported"), schemaVersion: Schema.Number }),
]);
const BaseProjectedAssertionEntrySchema = createAssertionsRecordSchemas(ProjectedMaterialSchema).entry;
const ProjectedAssertionEntrySchema = Schema.Struct({
  ...BaseProjectedAssertionEntrySchema.fields,
  judgeMaterial: Schema.optional(JudgeMaterialReadResultSchema),
  scoreMatchAudit: Schema.optional(ScoreMatchAuditReadResultSchema),
});

const ProjectedSourceSiteSchema = Schema.Struct({
  entryId: AssertionEntryIdSchema, sourceOrder: Schema.Number,
  role: Schema.Literals(["declaration", "threshold", "score", "gate", "optional", "stop"]),
  source: Schema.Struct({ sourceItemId: Schema.String, sha256: Schema.String }),
  start: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
  end: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
});

const DiagnosticValueSchema = Schema.Union([AssertionFactValueSchema, AssertionConditionValueSchema]);
const DiagnosticReasonSchema = Schema.Literals([
  "condition-not-met", "evidence-unavailable", "source-unavailable", "redacted",
  "evaluator-failed", "producer-interrupted", "invalid-subject", "coverage-not-applicable",
  "not-recorded", "not-declared",
]);
const DiagnosticNodeSchema: Schema.Schema<{
  readonly label: string; readonly state: string;
  readonly expected: typeof DiagnosticValueSchema.Type | null;
  readonly observed: typeof AssertionFactValueSchema.Type | null;
  readonly reason: typeof DiagnosticReasonSchema.Type | null;
  readonly anchor: typeof AssertionFactValueSchema.Type | null;
  readonly children: readonly DiagnosticNode[];
}> = Schema.suspend(() => Schema.Struct({
  label: Schema.String, state: Schema.String,
  expected: Schema.NullOr(DiagnosticValueSchema), observed: Schema.NullOr(AssertionFactValueSchema),
  reason: Schema.NullOr(DiagnosticReasonSchema), anchor: Schema.NullOr(AssertionFactValueSchema),
  children: Schema.Array(DiagnosticNodeSchema),
}));
type DiagnosticNode = typeof DiagnosticNodeSchema.Type;

const UnavailableReasonSchema = Schema.Literals(["historical-not-recorded", "source-unavailable", "ambiguous"]);
const ConversationTargetSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("exact"), turnId: Schema.String, eventId: Schema.String, anchor: Schema.String }),
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: UnavailableReasonSchema }),
]);
const ProjectedLocatorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("tool-occurrence"), toolOccurrenceId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("event"), eventId: Schema.String }),
]);
const MatcherRowSchema = Schema.Struct({
  kind: Schema.Literals(["tool", "event", "legacy-source-row"]), rowId: Schema.String,
  number: Schema.String, phase: Schema.Literals(["at-evaluation", "outside-evaluation-snapshot", "historical"]),
  summary: Schema.String, detail: AssertionFactValueSchema,
  locator: Schema.optional(ProjectedLocatorSchema),
  evaluation: Schema.Struct({
    result: Schema.Literals(["matched", "mismatched", "unavailable", "not-evaluated", "not-retained", "outside-snapshot", "legacy"]),
    difference: Schema.optional(AssertionFactValueSchema),
  }),
  conversationTarget: ConversationTargetSchema,
});
const MatcherSourceCollectionSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: UnavailableReasonSchema, rows: Schema.Tuple([]), limitations: Schema.Tuple([]) }),
  Schema.Struct({ state: Schema.Literals(["complete", "partial"]), rows: Schema.Array(MatcherRowSchema), limitations: Schema.Array(AssertionFactValueSchema) }),
]);
const ProjectedQuerySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("collection-filter"), summary: AssertionFactValueSchema }),
  Schema.Struct({ kind: Schema.Literal("ordered-sequence"), summaries: Schema.Array(AssertionFactValueSchema) }),
]);
const ProjectedOrderStepSchema = Schema.Struct({
  step: Schema.Number, summary: AssertionFactValueSchema,
  state: Schema.Literals(["matched", "possible", "blocked", "not-reached"]),
  sourceRow: Schema.optional(Schema.String), conversationTarget: Schema.optional(ConversationTargetSchema),
});
const MatcherDebuggerSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("legacy"), subject: Schema.Literals(["tool", "event", "source-row"]),
    query: Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("historical-not-recorded") }),
    source: Schema.Struct({ final: MatcherSourceCollectionSchema, atEvaluation: MatcherSourceCollectionSchema }),
    identityRelation: Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("historical-not-recorded") }),
    overlayRetention: Schema.Literal("unavailable"), steps: Schema.Tuple([]),
    legacyDiagnostic: Schema.optional(AssertionFactValueSchema),
  }),
  Schema.Struct({
    state: Schema.Literal("current"), subject: Schema.Literals(["tool", "event", "source-row"]),
    query: ProjectedQuerySchema,
    receipt: Schema.Union([AssertionCollectionReceiptSchema, OrderEvaluationReceiptSchema]),
    source: Schema.Struct({ final: MatcherSourceCollectionSchema, atEvaluation: MatcherSourceCollectionSchema }),
    identityRelation: Schema.Union([
      Schema.Struct({ state: Schema.Literal("exact") }),
      Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literals(["source-unavailable", "ambiguous"]) }),
    ]),
    overlayRetention: Schema.Literals(["complete", "partial", "unavailable"]),
    steps: Schema.Array(ProjectedOrderStepSchema),
  }),
]);
const SandboxCommandJoinSchema = Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") });
const MissingMatcherSchema = Schema.Struct({
  state: Schema.Literal("missing"), sourceState: Schema.Literals(["not-recorded", "invalid"]),
  comparator: Schema.Null, sourceLedger: Schema.Null, receipt: Schema.Null, result: Schema.Null,
  targets: Schema.Tuple([]), debugger: Schema.Null, sandboxCommandJoin: SandboxCommandJoinSchema,
});
const MatcherProjectionSchema = Schema.Union([
  MissingMatcherSchema,
  Schema.Struct({
    state: Schema.Literal("ordinary"), sourceState: Schema.Null, comparator: Schema.Null,
    sourceLedger: Schema.NullOr(AssertionCollectionReceiptSchema), receipt: Schema.NullOr(AssertionCollectionReceiptSchema),
    result: Schema.Null, targets: Schema.Tuple([]), debugger: Schema.Null,
    sandboxCommandJoin: SandboxCommandJoinSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("legacy"), sourceState: Schema.Literal("unavailable"), comparator: Schema.Null,
    sourceLedger: Schema.Null, receipt: Schema.Null, result: Schema.Null, targets: Schema.Tuple([]),
    reason: Schema.Literal("historical-not-recorded"), debugger: MatcherDebuggerSchema,
    sandboxCommandJoin: SandboxCommandJoinSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("available"), sourceState: Schema.Literals(["complete", "partial", "unavailable"]),
    comparator: Schema.NullOr(Schema.Union([MatcherQueryStepSchema, Schema.Array(MatcherQueryStepSchema)])),
    sourceLedger: Schema.Struct({
      sourceSnapshot: MatcherSourceSnapshotSchema,
      receipt: Schema.Union([AssertionCollectionReceiptSchema, OrderEvaluationReceiptSchema]),
    }),
    receipt: Schema.Union([AssertionCollectionReceiptSchema, OrderEvaluationReceiptSchema]),
    result: Schema.NullOr(MatcherOrderedSequenceResultSchema),
    targets: Schema.Array(Schema.Struct({
      state: Schema.Literals(["matched", "mismatched", "unavailable", "not-evaluated"]),
      anchor: ProjectedLocatorSchema, difference: Schema.NullOr(AssertionFactValueSchema),
    })),
    debugger: MatcherDebuggerSchema, sandboxCommandJoin: SandboxCommandJoinSchema,
  }),
]);

export const AssertionDetailResultSchema = Schema.toType(Schema.Union([
  Schema.Struct({
    entryId: Schema.String,
    state: Schema.Literals(["not-recorded", "invalid"]),
    issues: Schema.optional(Schema.Array(Schema.Struct({ code: RecordAttachmentIssueCodeSchema, path: Schema.Array(Schema.String) }))),
    sourceSites: Schema.Tuple([]), check: DiagnosticNodeSchema, matcher: MissingMatcherSchema,
  }),
  Schema.Struct({
    entryId: AssertionEntryIdSchema,
    display: Schema.toType(AssertionDisplaySchema), entry: Schema.toType(ProjectedAssertionEntrySchema),
    sourceSites: Schema.Array(ProjectedSourceSiteSchema), check: DiagnosticNodeSchema, matcher: MatcherProjectionSchema,
  }),
]));
export type AssertionDetailResult = typeof AssertionDetailResultSchema.Type;
