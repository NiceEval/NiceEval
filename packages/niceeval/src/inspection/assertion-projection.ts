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

const ExpandedContentSchema = Schema.Struct({
  state: Schema.Literal("available"), byteLength: Schema.Number,
  sha256: Schema.String, base64: Schema.String,
});
const ProjectedMaterialSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
  Schema.Struct({
    kind: Schema.Literal("content"), content: ExpandedContentSchema,
    encoding: Schema.Literals(["json", "utf-8", "binary"]),
    byteLength: Schema.Number, preview: Schema.NullOr(Schema.String),
  }),
]);
const ProjectedAssertionEntrySchema = createAssertionsRecordSchemas(ProjectedMaterialSchema).entry;

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
    format: Schema.Literal("niceeval.inspection.assertion-detail/v1"), entryId: Schema.String,
    state: Schema.Literals(["not-recorded", "invalid"]),
    issues: Schema.optional(Schema.Array(Schema.Struct({ code: RecordAttachmentIssueCodeSchema, path: Schema.Array(Schema.String) }))),
    sourceSites: Schema.Tuple([]), check: DiagnosticNodeSchema, matcher: MissingMatcherSchema,
  }),
  Schema.Struct({
    format: Schema.Literal("niceeval.inspection.assertion-detail/v1"), entryId: AssertionEntryIdSchema,
    display: Schema.toType(AssertionDisplaySchema), entry: Schema.toType(ProjectedAssertionEntrySchema),
    sourceSites: Schema.Array(ProjectedSourceSiteSchema), check: DiagnosticNodeSchema, matcher: MatcherProjectionSchema,
  }),
]));
export type AssertionDetailResult = typeof AssertionDetailResultSchema.Type;
