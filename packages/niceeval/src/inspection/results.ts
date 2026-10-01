import { Schema } from "effect";
import {
  AdapterCallPriceReceiptSchema,
  AdapterUsageCallSchema,
  AdapterUsageModelSlotSchema,
} from "../record/family/adapter-usage/schema.ts";
import { CollectionStateSchema, NonNegativeSafeIntegerSchema } from "../record/family/common.ts";
import {
  JudgeUsageCallSchema, JudgePriceReceiptSchema, validateJudgeUsageAttachment,
} from "../record/family/judge-usage/schema.ts";
import {
  compareJudgeUsageCalls, JUDGE_USAGE_PREVIEW_BYTE_LIMIT, JUDGE_USAGE_PREVIEW_CALL_LIMIT,
} from "../o11y/judge-usage-projection.ts";
import { utf8ByteLength } from "./bytes.ts";
import { CurrencyCodeSchema } from "../record/family/source-receipt/codec.ts";
import { compareAdapterModelGroups } from "../o11y/adapter-usage-projection.ts";

import {
  AttemptDocumentSchema,
  MemberDocumentSchema,
  RecordSlotIdentitySchema,
  RunDocumentSchema,
} from "../record/codec/core.ts";
import {
  ExperimentIdSchema,
  RunIdSchema,
  Sha256DigestSchema,
  SourceItemIdSchema,
  UtcMillisSchema,
} from "../record/codec/identifiers.ts";
import {
  AgentTurnUsageObservationSchema,
} from "../record/family/agent-turns/schema.ts";
import {
  ExecutionTraceEventRecordSchema,
  ExecutionTraceHeaderRecordSchema,
} from "../record/family/execution-traces/schema.ts";
import {
  FileChangesCollectionLimitationSchema,
} from "../record/family/file-changes/schema.ts";
import { SourceReceiptLimitationSchema } from "../record/family/source-receipt/index.ts";
import {
  ACTIVITY_OUTCOMES,
  AGENT_TURN_OUTCOMES,
  COMMAND_NOT_STARTED_REASONS,
  COMMAND_TERMINATION_REASONS,
  SANDBOX_COMMAND_PHASES,
} from "../record/family/protocol-values.ts";
import {
  SessionScopeIdSchema,
  TurnIdSchema,
} from "../record/family/source-receipt/codec.ts";
import {
  isCommandId,
  isItemId,
  isToolOccurrenceId,
} from "../record/family/source-receipt/model.ts";
import { INSPECTION_BEHAVIOR_VERSION, QUERY_PROTOCOL } from "./protocol-values.ts";
import {
  RunAbsentPublicationSchema,
  RunPendingPublicationSchema,
  RunPublishedPublicationSchema,
  RunStateSchema,
} from "../run/index.ts";
import {
  AdapterIdentitySchema,
  RunContextSchema,
} from "../record/model/run-context.ts";
import type {
  InspectionOperationId,
  InspectionSuccessDocument,
  InspectionSuccessDocumentFor,
} from "./protocol.ts";

const MetricStateSchema = Schema.Literals([
  "available", "partial", "unavailable", "empty", "unsupported", "failed",
]);
const ItemIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isItemId)));
const ToolOccurrenceIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isToolOccurrenceId)));
const CommandIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isCommandId)));
const AssertionLimitationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("redacted"), fieldCount: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("sampled"), captured: Schema.Number, knownTotal: Schema.optional(Schema.Number) }),
  Schema.Struct({ kind: Schema.Literal("truncated"), omittedBytes: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("provider-limited") }),
  Schema.Struct({ kind: Schema.Literal("capacity-limited"), capturedItems: Schema.Number, knownTotalItems: Schema.Number, omittedBytes: Schema.NullOr(Schema.Number) }),
]);
const OverviewIssueSchema = Schema.Union([
  Schema.Struct({
    code: Schema.Literals(["assertions-not-recorded", "assertions-revision-unsupported", "assertions-current-invalid"]),
    locator: Schema.String,
  }),
  Schema.Struct({
    code: Schema.Literals(["attempt-origin-missing", "attempt-not-observed"]),
    runId: Schema.String,
    slotId: Schema.String,
    evalId: Schema.String,
    attemptOrdinal: Schema.Number,
  }),
  Schema.Struct({
    code: Schema.Literal("score-contribution-unavailable"),
    locator: Schema.String,
    entryId: Schema.String,
    reason: Schema.Literals(["source-unavailable", "evaluation-errored", "not-applicable"]),
  }),
  Schema.Struct({ code: Schema.Literal("score-partial"), locator: Schema.NullOr(Schema.String) }),
]);
const AttemptRefSchema = Schema.Struct({
  identity: Schema.Struct({ kind: Schema.Literal("attempt"), locator: Schema.String }),
});
const MetricSchema = Schema.Struct({
  state: MetricStateSchema,
  value: Schema.NullOr(Schema.Number),
  samples: Schema.Number,
  total: Schema.Number,
  basis: Schema.Literals(["slot", "eval"]),
  issues: Schema.Array(OverviewIssueSchema),
  refs: Schema.Array(AttemptRefSchema),
  unit: Schema.optional(Schema.Literals(["points", "USD", "ms", "tokens"])),
  bounds: Schema.optional(Schema.Struct({ min: Schema.Number, max: Schema.Number })),
});
const CostMetricSchema = Schema.Struct({
  ...MetricSchema.fields,
  source: Schema.NullOr(Schema.Literals(["reported", "estimated", "mixed"])),
});
const OverviewCoverageSchema = Schema.Union([
  Schema.Struct({
    identity: Schema.Struct({ kind: Schema.Literal("attempt"), locator: Schema.String }),
    state: Schema.Literals(["not-recorded", "unsupported", "failed"]),
  }),
  Schema.Struct({
    identity: Schema.Struct({ kind: Schema.Literal("attempt"), locator: Schema.String }),
    entryId: Schema.String,
    groupPath: Schema.Array(Schema.String),
    state: Schema.Literals(["complete", "partial", "unavailable", "not-applicable"]),
    reason: Schema.optional(Schema.Literals(["sampled", "truncated", "redacted", "provider-limited", "capacity-limited", "not-collected", "source-unavailable", "producer-failed", "optional-material", "unsupported-subject"])),
    limitations: Schema.Array(AssertionLimitationSchema),
  }),
]);
const AggregateFields = {
  evaluationKind: Schema.Literals(["pass", "points", "mixed"]),
  denominator: Schema.Struct({
    expected: Schema.Number,
    observed: Schema.Number,
    classified: Schema.Number,
    missing: Schema.Number,
  }),
  verdict: Schema.Struct({
    tally: Schema.Struct({
      passed: Schema.Number,
      failed: Schema.Number,
      errored: Schema.Number,
      skipped: Schema.Number,
    }),
    passRate: MetricSchema,
  }),
  score: MetricSchema,
  costUSD: CostMetricSchema,
  durationMs: MetricSchema,
  tokens: MetricSchema,
  coverage: Schema.Array(OverviewCoverageSchema),
  issues: Schema.Array(OverviewIssueSchema),
} as const;
const OverviewPublishedMemberSchema = Schema.Struct({
  ...RunPublishedPublicationSchema.fields,
  verdict: Schema.NullOr(Schema.Literals(["passed", "failed", "errored", "skipped"])),
  score: MetricSchema,
  costUSD: CostMetricSchema,
  durationMs: MetricSchema,
  tokens: MetricSchema,
});
const InspectionExecutionValueSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available"), value: Schema.String }),
  Schema.Struct({ state: Schema.Literal("mixed") }),
  Schema.Struct({ state: Schema.Literal("unavailable") }),
]);
const InspectionLabelsSchema = Schema.Record(
  Schema.String,
  InspectionExecutionValueSchema,
);
const OverviewMemberSchema = Schema.Struct({
  runId: Schema.String,
  slotId: Schema.String,
  evalId: Schema.String,
  attemptOrdinal: Schema.Number,
  labels: InspectionLabelsSchema,
  publication: Schema.Union([
    RunPendingPublicationSchema,
    OverviewPublishedMemberSchema,
    RunAbsentPublicationSchema,
  ]),
});
const OverviewGroupSchema = Schema.Struct({
  groupPath: Schema.Array(Schema.String),
  ...AggregateFields,
});
const OverviewExperimentSchema = Schema.Struct({
  experimentId: Schema.String,
  adapter: Schema.Union([
    Schema.Struct({ state: Schema.Literal("available"), value: AdapterIdentitySchema }),
    Schema.Struct({ state: Schema.Literal("mixed") }),
  ]),
  model: InspectionExecutionValueSchema,
  labels: InspectionLabelsSchema,
  groups: Schema.Array(OverviewGroupSchema),
  ...AggregateFields,
});
const OverviewCellSchema = Schema.Struct({
  experimentId: Schema.String,
  evalId: Schema.String,
  groupPath: Schema.Array(Schema.String),
  members: Schema.Array(OverviewMemberSchema),
  ...AggregateFields,
});
export const InspectionOverviewResultSchema = Schema.Struct({
  totals: Schema.Struct(AggregateFields),
  experiments: Schema.Array(OverviewExperimentSchema),
  cells: Schema.Array(OverviewCellSchema),
});
export type InspectionOverviewResult = Schema.Schema.Type<typeof InspectionOverviewResultSchema>;

export const InspectionExperimentResultSchema = Schema.Struct({
  costSummary: Schema.suspend(() => ExperimentCostSummarySchema),
  modelUsage: Schema.Struct({
    attempts: Schema.Array(Schema.Struct({
      locator: Schema.String,
      originRunId: Schema.String,
      usage: Schema.suspend(() => Schema.Struct({
        state: InspectionAttemptUsageResultSchema.fields.state,
        configuredModels: InspectionAttemptUsageResultSchema.fields.configuredModels,
        modelGroups: InspectionAttemptUsageResultSchema.fields.modelGroups,
        judgeUsage: JudgeUsageSummarySchema,
        totalCosts: InspectionAttemptUsageResultSchema.fields.totalCosts,
        totals: InspectionAttemptUsageResultSchema.fields.totals,
      })),
    })),
    totalAttemptCount: NonNegativeSafeIntegerSchema,
    omittedAttemptCount: NonNegativeSafeIntegerSchema,
    unresolvedAttemptCount: NonNegativeSafeIntegerSchema,
  }).check(Schema.makeFilter((usage) => usage.attempts.length <= 64 &&
    usage.totalAttemptCount === usage.attempts.length + usage.omittedAttemptCount &&
    usage.attempts.every((entry, index) => index === 0 ||
      usage.attempts[index - 1]!.originRunId < entry.originRunId ||
      usage.attempts[index - 1]!.originRunId === entry.originRunId && usage.attempts[index - 1]!.locator < entry.locator))),
  experiment: OverviewExperimentSchema,
  cells: Schema.Array(OverviewCellSchema),
});
export type InspectionExperimentResult = Schema.Schema.Type<typeof InspectionExperimentResultSchema>;

/** Inspection lifecycle projection; durable Core remains unchanged. */
export const InspectionRunValueSchema = Schema.Struct({
  runId: RunIdSchema,
  experimentId: ExperimentIdSchema,
  state: RunStateSchema,
  context: Schema.optional(RunContextSchema),
  startedAt: UtcMillisSchema,
  completedAt: Schema.optional(UtcMillisSchema),
  expectedSlots: Schema.Array(RecordSlotIdentitySchema),
});
export type InspectionRunValue = Schema.Schema.Type<typeof InspectionRunValueSchema>;

export const InspectionRunResultSchema = Schema.Struct({
  value: InspectionRunValueSchema,
  members: Schema.Array(MemberDocumentSchema),
  attempts: Schema.Array(AttemptDocumentSchema),
});
export type InspectionRunResult = Schema.Schema.Type<typeof InspectionRunResultSchema>;

export const InspectionRunListResultSchema = Schema.Array(Schema.Struct({
  runId: RunIdSchema,
  state: Schema.Literal("completed"),
  experimentId: ExperimentIdSchema,
  invocationId: Schema.Null,
  startedAt: UtcMillisSchema,
  completedAt: UtcMillisSchema,
  coverage: Schema.Struct({
    published: Schema.Number,
    expected: Schema.Number,
  }),
}));
export type InspectionRunListResult = Schema.Schema.Type<typeof InspectionRunListResultSchema>;

export const InspectionScoredValueSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-scored") }),
  Schema.Struct({ state: Schema.Literal("complete"), earned: Schema.Number, possible: Schema.Number }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    earned: Schema.Number,
    possible: Schema.Number,
    unavailable: Schema.Number,
  }),
]);
export type InspectionScoredValue = Schema.Schema.Type<typeof InspectionScoredValueSchema>;
const VerdictSchema = Schema.NullOr(Schema.Literals(["passed", "failed", "errored", "skipped"]));
export const InspectionRunSummaryResultSchema = Schema.Struct({
  runs: Schema.Array(RunDocumentSchema),
  denominator: Schema.Struct({ expected: Schema.Number, observed: Schema.Number }),
  members: Schema.Array(Schema.Struct({
    runId: Schema.String,
    slotId: Schema.String,
    evalId: Schema.String,
    attemptOrdinal: Schema.Number,
    executionIdentityDigest: Schema.String,
    state: Schema.Literals([
      "executed", "carried", "accepted", "not-dispatched", "interrupted", "missing",
    ]),
    locator: Schema.NullOr(Schema.String),
    outcome: Schema.NullOr(Schema.Literals(["completed", "errored", "cancelled", "interrupted"])),
    verdict: VerdictSchema,
    score: Schema.optional(InspectionScoredValueSchema),
  })),
});
export type InspectionRunSummaryResult = Schema.Schema.Type<typeof InspectionRunSummaryResultSchema>;

const AttemptCoverageFactSchema = Schema.Struct({
  channel: Schema.Literals(["events", "actions", "messages", "usage", "status", "data"]),
  status: Schema.Literals(["complete", "partial", "unavailable"]),
  reason: Schema.optional(Schema.String),
});
const AttemptLimitationSchema = Schema.Union([
  AttemptCoverageFactSchema,
  Schema.Struct({
    owner: Schema.Literal("assertion-material"),
    state: Schema.Literal("partial"),
    reason: Schema.Literals(["sampled", "truncated", "redacted", "provider-limited", "capacity-limited"]),
    limitations: Schema.Array(AssertionLimitationSchema),
  }),
  Schema.Struct({
    owner: Schema.Literal("assertion-material"),
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["not-collected", "source-unavailable", "producer-failed"]),
    limitations: Schema.Array(AssertionLimitationSchema),
  }),
  Schema.Struct({
    owner: Schema.Literal("assertion-material"),
    state: Schema.Literal("not-applicable"),
    reason: Schema.Literals(["optional-material", "unsupported-subject"]),
    limitations: Schema.Array(AssertionLimitationSchema),
  }),
]);
const SectionStateSchema = Schema.Struct({
  state: Schema.Literals(["available", "not-recorded", "partial", "unavailable"]),
});
const SectionsSchema = Schema.Struct({
  assertions: SectionStateSchema,
  trace: SectionStateSchema,
  sources: SectionStateSchema,
  diff: SectionStateSchema,
  artifacts: SectionStateSchema,
  timing: SectionStateSchema,
  usage: SectionStateSchema,
  conversation: SectionStateSchema,
  commands: SectionStateSchema,
  diagnostics: SectionStateSchema,
});
const AssertionIndexSchema = Schema.Struct({
  state: Schema.Literals(["available", "not-recorded", "invalid"]),
  entries: Schema.Array(Schema.Struct({
    entryId: Schema.String,
    display: Schema.Struct({
      label: Schema.optional(Schema.String),
      key: Schema.optional(Schema.String),
      groupPath: Schema.Array(Schema.String),
    }),
  })),
});
const AssertionEvidenceSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-recorded"), entryCount: Schema.Literal(0) }),
  Schema.Struct({
    state: Schema.Literal("available"),
    entryCount: Schema.Number,
    sourceSiteCount: Schema.Number,
  }),
  Schema.Struct({
    state: Schema.Literals(["unsupported", "failed", "invalid"]),
    entryCount: Schema.Literal(0),
  }),
]);
export const InspectionAttemptResultSchema = Schema.Struct({
  core: AttemptDocumentSchema,
  locator: Schema.String,
  originRun: RunDocumentSchema,
  targets: Schema.Array(Schema.Struct({ runId: Schema.String, member: MemberDocumentSchema })),
  evidence: AssertionEvidenceSchema,
  assertions: AssertionIndexSchema,
  sections: SectionsSchema,
  verdict: VerdictSchema,
  score: InspectionScoredValueSchema,
  evidenceCoverage: Schema.Array(AttemptCoverageFactSchema),
  limitations: Schema.Array(AttemptLimitationSchema),
});
export type InspectionAttemptResult = Schema.Schema.Type<typeof InspectionAttemptResultSchema>;

const SourceContentSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available"), text: Schema.String }),
  Schema.Struct({
    state: Schema.Literal("omitted"),
    reason: Schema.Literal("inspection-result-byte-limit"),
    byteLength: Schema.Number,
    byteLimit: Schema.Number,
  }),
]);
const AssertionSourceSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("mapped"), sourceItemId: Schema.String, sha256: Schema.String }),
  Schema.Struct({
    state: Schema.Literal("unmapped"),
    reason: Schema.Literals(["source-snapshot-not-recorded", "position-unrepresentable"]),
  }),
]);
const SourceSiteSchema = Schema.Struct({
  entryId: Schema.String,
  sourceOrder: Schema.Number,
  role: Schema.Literals(["declaration", "threshold", "score", "gate", "optional", "stop"]),
  start: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
  end: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
  source: AssertionSourceSchema,
});
const SourcesAssertionsSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literals(["not-recorded", "invalid"]),
    sourceSites: Schema.Tuple([]),
    hasMoreSourceSites: Schema.Literal(false),
    omittedSourceSiteCount: Schema.Literal(0),
  }),
  Schema.Struct({
    state: Schema.Literal("available"),
    sourceSites: Schema.Array(SourceSiteSchema),
    hasMoreSourceSites: Schema.Boolean,
    omittedSourceSiteCount: Schema.Number,
  }),
]);
export const InspectionSourcesResultSchema = Schema.Struct({
  state: Schema.Literals(["available", "not-recorded", "invalid"]),
  items: Schema.Array(Schema.Struct({
    sourceItemId: Schema.String,
    path: Schema.String,
    byteLength: Schema.Number,
    sha256: Schema.String,
    content: SourceContentSchema,
  })),
  hasMore: Schema.Boolean,
  omittedItemCount: Schema.Number,
  assertions: SourcesAssertionsSchema,
});
export type InspectionSourcesResult = Schema.Schema.Type<typeof InspectionSourcesResultSchema>;

const ProjectionStateSchema = Schema.Literals(["complete", "partial", "not-recorded", "invalid"]);
const TraceProjectionLimitationSchema = Schema.Union([
  SourceReceiptLimitationSchema,
  Schema.Struct({ issue: Schema.String }),
  Schema.Struct({
    source: Schema.Literal("agent-turns"),
    turnId: TurnIdSchema,
    channel: Schema.Literals(["conversation", "events", "actions", "messages", "status", "data"]),
    state: Schema.Literals(["partial", "unavailable"]),
    reason: Schema.String,
  }),
  Schema.Struct({
    source: Schema.Literal("turn-contexts"),
    state: Schema.Literals(["partial", "not-recorded", "invalid"]),
    limitations: Schema.Array(Schema.Union([
      SourceReceiptLimitationSchema,
      Schema.Struct({ issue: Schema.String }),
    ])),
  }),
]);
const TurnOutcomeSchema = Schema.Literals(AGENT_TURN_OUTCOMES);
const TraceTurnContextSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-recorded") }),
  Schema.Struct({
    state: Schema.Literal("unmapped"),
    reason: Schema.Literals([
      "location-not-captured",
      "source-snapshot-not-recorded",
      "position-unrepresentable",
    ]),
    sessionIndex: Schema.Number,
    turnIndex: Schema.Number,
    sourceOrder: Schema.NullOr(Schema.Number),
  }),
  Schema.Struct({
    state: Schema.Literal("mapped"),
    sourceItemId: SourceItemIdSchema,
    sha256: Sha256DigestSchema,
    start: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
    end: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
    sessionIndex: Schema.Number,
    turnIndex: Schema.Number,
    sourceOrder: Schema.Number,
  }),
]);
const TraceTurnCoverageEntrySchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("complete") }),
  Schema.Struct({
    state: Schema.Literals(["partial", "unavailable"]),
    reason: Schema.String,
  }),
]);
const TraceTurnTerminalSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("recorded"),
    status: Schema.Literals(["completed", "failed", "waiting"]),
    coverage: Schema.Struct({
      events: TraceTurnCoverageEntrySchema,
      actions: TraceTurnCoverageEntrySchema,
      messages: TraceTurnCoverageEntrySchema,
      status: TraceTurnCoverageEntrySchema,
      data: TraceTurnCoverageEntrySchema,
    }),
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["send-failed", "send-interrupted"]),
    coverage: Schema.Struct({
      state: Schema.Literal("unavailable"),
      reason: Schema.Literals(["send-failed", "send-interrupted"]),
    }),
  }),
]);
const TraceDiagnosticsLimitationSchema = Schema.Union([
  SourceReceiptLimitationSchema,
  Schema.Struct({ issue: Schema.String }),
]);
const TraceDiagnosticSourceFrameSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
  end: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
});
const TraceDiagnosticsSchema = Schema.Struct({
  state: ProjectionStateSchema,
  limitations: Schema.Array(TraceDiagnosticsLimitationSchema),
  limitationsTruncated: Schema.Boolean,
  omittedLimitationCount: Schema.Number,
  items: Schema.Array(Schema.Struct({
    diagnosticId: Schema.String,
    sequence: Schema.Number,
    turnId: Schema.NullOr(Schema.String),
    phase: Schema.Literals([
      "attempt.setup",
      "sandbox.prepare",
      "agent.ensure",
      "eval.run",
      "agent.send",
      "sandbox.command",
      "assertion.evaluate",
      "verdict.fold",
      "attempt.teardown",
    ]),
    kind: Schema.Literals(["advisory", "execution-error"]),
    code: Schema.String,
    summary: Schema.String,
    summaryTruncated: Schema.Boolean,
    causes: Schema.Array(Schema.Struct({
      code: Schema.String,
      summary: Schema.String,
      summaryTruncated: Schema.Boolean,
    })),
    causesTruncated: Schema.Boolean,
    omittedCauseCount: Schema.Number,
    redaction: Schema.Union([
      Schema.Struct({ state: Schema.Literal("none") }),
      Schema.Struct({ state: Schema.Literal("applied"), replacements: Schema.Number }),
    ]),
    sourceFrame: Schema.NullOr(TraceDiagnosticSourceFrameSchema),
  })),
  hasMore: Schema.Boolean,
  omittedDiagnosticCount: Schema.Number,
});
const ExecutionDisplayPreviewTextSchema = Schema.Struct({ preview: Schema.String, omittedBytes: Schema.Number });
const ExecutionDisplayRoleSchema = Schema.Literals(["user", "assistant", "system", "other"]);
export const ExecutionDisplayPreviewSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({
    state: Schema.Literal("present"),
    blocks: Schema.Array(Schema.Union([
      Schema.Struct({ kind: Schema.Literal("text"), text: ExecutionDisplayPreviewTextSchema }),
      Schema.Struct({
        kind: Schema.Literal("message"),
        role: ExecutionDisplayRoleSchema,
        speaker: Schema.optional(Schema.String),
        text: ExecutionDisplayPreviewTextSchema,
      }),
      Schema.Struct({
        kind: Schema.Literal("fields"),
        fields: Schema.Array(Schema.Struct({
          label: Schema.String,
          value: Schema.Union([ExecutionDisplayPreviewTextSchema, Schema.Number, Schema.Boolean, Schema.Null]),
        })),
      }),
      Schema.Struct({ kind: Schema.Literal("code"), language: Schema.optional(Schema.String), text: ExecutionDisplayPreviewTextSchema }),
      Schema.Struct({
        kind: Schema.Literal("image"),
        artifactId: Schema.String,
        alt: Schema.String,
        mediaType: Schema.String,
        byteLength: Schema.Number,
        sha256: Schema.String,
      }),
    ])),
  }),
]);
const TraceItemBase = { itemId: ItemIdSchema, turnId: Schema.String, sequence: Schema.Number } as const;
export const InspectionTraceItemSchema = Schema.Union([
  Schema.Struct({ ...TraceItemBase, kind: Schema.Literal("message"), role: Schema.Literals(["user", "assistant"]), text: Schema.String, textTruncated: Schema.Boolean }),
  Schema.Struct({ ...TraceItemBase, kind: Schema.Literal("tool-call"), tool: Schema.String, input: Schema.String, inputTruncated: Schema.Boolean, toolOccurrenceId: Schema.optional(ToolOccurrenceIdSchema) }),
  Schema.Struct({ ...TraceItemBase, kind: Schema.Literal("tool-result"), outcome: Schema.Literals(["completed", "rejected", "failed", "cancelled"]), output: Schema.String, outputTruncated: Schema.Boolean, toolOccurrenceId: Schema.optional(ToolOccurrenceIdSchema) }),
  Schema.Struct({ ...TraceItemBase, kind: Schema.Literals(["thinking-summary", "compaction", "context-injection"]), summary: Schema.String, summaryTruncated: Schema.Boolean }),
  Schema.Struct({ ...TraceItemBase, kind: Schema.Literal("subagent"), state: Schema.Literals(["started", "completed", "failed"]), label: Schema.String, summary: Schema.String, summaryTruncated: Schema.Boolean }),
  Schema.Struct({ ...TraceItemBase, kind: Schema.Literal("input-request"), state: Schema.Literals(["requested", "answered", "cancelled"]), prompt: Schema.String, promptTruncated: Schema.Boolean, response: Schema.NullOr(Schema.String), responseTruncated: Schema.Boolean }),
  Schema.Struct({ ...TraceItemBase, kind: Schema.Literals(["skill-load", "conversation-error"]), code: Schema.String, summary: Schema.String, summaryTruncated: Schema.Boolean }),
]);
const CommandOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("exited"), exitCode: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("terminated"), reason: Schema.Literals(COMMAND_TERMINATION_REASONS) }),
  Schema.Struct({ kind: Schema.Literal("not-started"), reason: Schema.Literals(COMMAND_NOT_STARTED_REASONS) }),
]);
export const InspectionTraceResultSchema = Schema.Struct({
  execution: Schema.Struct({
    state: ProjectionStateSchema,
    limitations: Schema.Array(Schema.Union([
      Schema.Struct({ code: Schema.Literal("capture-failed"), stage: Schema.Literal("adapter") }),
      Schema.Struct({ code: Schema.Literal("capture-interrupted"), stage: Schema.Literal("attempt-finalizer") }),
      Schema.Struct({ code: Schema.Literal("collection-cap-reached"), omittedAtLeast: Schema.Number }),
      Schema.Struct({
        code: Schema.Literal("legacy-source-state"),
        state: Schema.Literals(["partial", "invalid"]),
        message: Schema.String,
      }),
    ])),
    traces: Schema.Array(ExecutionTraceHeaderRecordSchema.pipe(Schema.fieldsAssign({ eventCount: Schema.Number }))),
    events: Schema.Array(Schema.Struct({
      traceId: Schema.String,
      eventId: Schema.String,
      origin: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("execution-event"), eventId: Schema.String }),
        Schema.Struct({ kind: Schema.Literal("agent-item"), itemId: ItemIdSchema }),
      ]),
      ordinal: Schema.Number,
      type: Schema.String,
      source: ExecutionTraceEventRecordSchema.fields.source,
      actor: ExecutionTraceEventRecordSchema.fields.actor,
      time: ExecutionTraceEventRecordSchema.fields.time,
      summary: Schema.String,
      links: ExecutionTraceEventRecordSchema.fields.links,
      evidence: Schema.Array(Schema.Struct({ evidenceId: Schema.String, key: Schema.String, label: Schema.String })),
      scopeMemberships: ExecutionTraceEventRecordSchema.fields.scopeMemberships,
      display: ExecutionDisplayPreviewSchema,
    })),
    identityIndex: Schema.Struct({
      traceIds: Schema.Array(Schema.String),
      omittedTraceIdCount: Schema.Number,
      eventIds: Schema.Array(Schema.String),
      omittedEventIdCount: Schema.Number,
      evidenceIds: Schema.Array(Schema.String),
      omittedEvidenceIdCount: Schema.Number,
    }),
    hasMore: Schema.Boolean,
    omittedEventCount: Schema.Number,
    continuation: Schema.optional(Schema.String),
  }),
  conversation: Schema.Struct({
    state: ProjectionStateSchema,
    limitations: Schema.Array(TraceProjectionLimitationSchema),
    limitationsTruncated: Schema.Boolean,
    omittedLimitationCount: Schema.Number,
    turns: Schema.Array(Schema.Struct({
      turnId: Schema.String,
      sequence: Schema.Number,
      sessionId: Schema.optional(SessionScopeIdSchema),
      outcome: TurnOutcomeSchema,
      terminal: TraceTurnTerminalSchema,
      context: TraceTurnContextSchema,
    })),
    turnsTruncated: Schema.Boolean,
    omittedTurnCount: Schema.Number,
    items: Schema.Array(InspectionTraceItemSchema),
    itemsTruncated: Schema.Boolean,
    omittedItemCount: Schema.Number,
  }),
  commands: Schema.Struct({
    state: ProjectionStateSchema,
    limitations: Schema.Array(TraceProjectionLimitationSchema),
    limitationsTruncated: Schema.Boolean,
    omittedLimitationCount: Schema.Number,
    items: Schema.Array(Schema.Struct({
      commandId: CommandIdSchema,
      phase: Schema.Literals(SANDBOX_COMMAND_PHASES),
      outcome: CommandOutcomeSchema,
    })),
    hasMore: Schema.Boolean,
    omittedCommandCount: Schema.Number,
  }),
  diagnostics: TraceDiagnosticsSchema,
  identityIndex: Schema.Struct({
    itemIds: Schema.Array(ItemIdSchema),
    omittedItemIdCount: Schema.Number,
    toolOccurrenceIds: Schema.Struct({ ids: Schema.Array(ToolOccurrenceIdSchema), omittedIdCount: Schema.Number }),
    commandIds: Schema.Array(CommandIdSchema),
    omittedCommandIdCount: Schema.Number,
  }),
});
export type InspectionTraceResult = Schema.Schema.Type<typeof InspectionTraceResultSchema>;

const FullTraceItemBase = {
  itemId: ItemIdSchema,
  turnId: Schema.String,
  turnSequence: Schema.Number,
  turnOutcome: TurnOutcomeSchema,
  sessionId: Schema.optional(Schema.String),
  eventId: Schema.optional(Schema.String),
  sequence: Schema.optional(Schema.Number),
} as const;
export const InspectionTraceDetailItemSchema = Schema.Union([
  Schema.Struct({ ...FullTraceItemBase, kind: Schema.Literal("message"), role: Schema.Literals(["user", "assistant"]), text: Schema.String }),
  Schema.Struct({ ...FullTraceItemBase, kind: Schema.Literal("tool-call"), toolOccurrenceId: Schema.optional(ToolOccurrenceIdSchema), tool: Schema.String, input: Schema.String }),
  Schema.Struct({ ...FullTraceItemBase, kind: Schema.Literal("tool-result"), toolOccurrenceId: Schema.optional(ToolOccurrenceIdSchema), outcome: Schema.Literals(["completed", "rejected", "failed", "cancelled"]), output: Schema.String }),
  Schema.Struct({ ...FullTraceItemBase, kind: Schema.Literals(["thinking-summary", "compaction", "context-injection"]), summary: Schema.String }),
  Schema.Struct({ ...FullTraceItemBase, kind: Schema.Literal("subagent"), state: Schema.Literals(["started", "completed", "failed"]), label: Schema.String, summary: Schema.String }),
  Schema.Struct({ ...FullTraceItemBase, kind: Schema.Literal("input-request"), state: Schema.Literals(["requested", "answered", "cancelled"]), prompt: Schema.String, response: Schema.NullOr(Schema.String) }),
  Schema.Struct({ ...FullTraceItemBase, kind: Schema.Literals(["skill-load", "conversation-error"]), code: Schema.String, summary: Schema.String }),
]);
const TraceTurnIdentitySchema = Schema.Struct({ turnId: Schema.String, sequence: Schema.Number, outcome: TurnOutcomeSchema });
const CommandInvocationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("shell"), command: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("argv"), executable: Schema.String, arguments: Schema.Array(Schema.String) }),
]);
const WorkingDirectorySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("sandbox-default") }),
  Schema.Struct({ kind: Schema.Literal("project-relative"), path: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("redacted") }),
]);
const CommandStreamSchema = Schema.Struct({
  text: Schema.String,
  retainedBytes: Schema.Number,
  totalSafeUtf8Bytes: Schema.Number,
  sha256: Schema.String,
  truncation: Schema.Struct({ state: Schema.Literals(["not-truncated", "truncated"]), omittedSafeUtf8Bytes: Schema.Number }),
});
export const InspectionTraceDetailResultSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("execution-event"),
    event: ExecutionTraceEventRecordSchema,
    evidence: Schema.Array(Schema.Struct({
      evidenceId: Schema.String,
      key: Schema.String,
      label: Schema.String,
      artifactId: Schema.String,
      pointer: Schema.String,
      targetSha256: Schema.String,
      targetByteLength: Schema.Number,
      offset: Schema.Literal(0),
      base64: Schema.String,
      nextOffset: Schema.NullOr(Schema.Number),
      truncated: Schema.Boolean,
    })),
  }),
  Schema.Struct({
    kind: Schema.Literal("execution-evidence"),
    evidenceId: Schema.String,
    eventId: Schema.String,
    traceId: Schema.String,
    key: Schema.String,
    label: Schema.String,
    artifactId: Schema.String,
    pointer: Schema.String,
    artifactSha256: Schema.String,
    targetSha256: Schema.String,
    targetByteLength: Schema.Number,
    offset: Schema.Number,
    base64: Schema.String,
    nextOffset: Schema.NullOr(Schema.Number),
  }),
  Schema.Struct({ kind: Schema.Literal("item"), itemId: ItemIdSchema, item: InspectionTraceDetailItemSchema }),
  Schema.Struct({
    kind: Schema.Literal("tool-occurrence"),
    toolOccurrenceId: ToolOccurrenceIdSchema,
    call: Schema.NullOr(InspectionTraceDetailItemSchema),
    result: Schema.NullOr(InspectionTraceDetailItemSchema),
    turn: Schema.Struct({ call: Schema.NullOr(TraceTurnIdentitySchema), result: Schema.NullOr(TraceTurnIdentitySchema) }),
  }),
  Schema.Struct({
    kind: Schema.Literal("command"),
    commandId: CommandIdSchema,
    invocation: CommandInvocationSchema,
    workingDirectory: WorkingDirectorySchema,
    outcome: CommandOutcomeSchema,
    turnId: Schema.NullOr(Schema.String),
    phase: Schema.Literals(["attempt.setup", "sandbox.prepare", "agent.ensure", "eval.run", "sandbox.command", "attempt.teardown"]),
    sequence: Schema.Number,
    stdout: CommandStreamSchema,
    stderr: CommandStreamSchema,
  }),
]);
export type InspectionTraceDetailResult = Schema.Schema.Type<typeof InspectionTraceDetailResultSchema>;

const InvalidProjectionLimitationSchema = Schema.Struct({ issue: Schema.String });
const ProjectionLimitationSchema = Schema.Union([SourceReceiptLimitationSchema, InvalidProjectionLimitationSchema]);
const UsageCoverageSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("complete") }),
  Schema.Struct({ state: Schema.Literals(["partial", "unavailable"]), reason: Schema.String }),
]);
const UsageLimitationSchema = Schema.Union([
  ProjectionLimitationSchema,
  Schema.Struct({
    source: Schema.Literal("agent-turns"),
    turnId: Schema.String,
    channel: Schema.Literal("usage"),
    state: Schema.Literals(["partial", "unavailable"]),
    reason: Schema.String,
  }),
]);
const [TokenBucketUsageObservationSchema, RequestUsageObservationSchema, ProviderCostUsageObservationSchema] =
  AgentTurnUsageObservationSchema.members;
const UsageObservationSchema = Schema.Union([
  Schema.Struct({ turnId: TurnIdSchema, ...TokenBucketUsageObservationSchema.fields }),
  Schema.Struct({ turnId: TurnIdSchema, ...RequestUsageObservationSchema.fields }),
  Schema.Struct({ turnId: TurnIdSchema, ...ProviderCostUsageObservationSchema.fields }),
]);
const UsageNumericTotalSchema = Schema.Struct({
  state: Schema.Literals(["available", "partial", "unavailable"]),
  value: Schema.NullOr(Schema.Number),
  observationCount: Schema.Number,
});
const UsageCostTotalSchema = Schema.Struct({
  currency: Schema.String,
  value: Schema.String,
  observationCount: Schema.Number,
});
const validUsageCurrency = Schema.is(CurrencyCodeSchema);
// Summed amounts may be longer than one call's bounded receipt; Query owns the output byte budget.
const UsageDecimalSchema = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$(?![\s\S])/u));
const UsageCurrencySchema = Schema.String.check(Schema.makeFilter((value): boolean => validUsageCurrency(value)));
const EffectiveCostSchema = Schema.Struct({
  amount: UsageDecimalSchema,
  currency: UsageCurrencySchema,
  source: Schema.Struct({
    kind: Schema.Literals(["reported", "estimated"]),
    id: Schema.String,
  }),
  state: Schema.Literals(["complete", "partial"]),
});
const AdapterUsageInspectionCallSchema = Schema.Struct({
  ...AdapterUsageCallSchema.fields,
  effectiveCost: Schema.NullOr(EffectiveCostSchema),
});
const EffectiveCostTotalSchema = Schema.Struct({
  state: Schema.Literals(["complete", "partial", "unavailable"]),
  source: Schema.NullOr(Schema.Literals(["reported", "estimated", "mixed"])),
  values: Schema.Array(Schema.Struct({
    currency: UsageCurrencySchema,
    value: UsageDecimalSchema,
    source: Schema.Literals(["reported", "estimated", "mixed"]),
    coveredCalls: NonNegativeSafeIntegerSchema,
    reportedCalls: NonNegativeSafeIntegerSchema,
    estimatedCalls: NonNegativeSafeIntegerSchema,
  })),
  totalCalls: NonNegativeSafeIntegerSchema,
});
const RecordedCallCountSchema = NonNegativeSafeIntegerSchema.check(Schema.isLessThanOrEqualTo(4_000));
const ModelGroupTokenTotalSchema = Schema.Struct({
  state: Schema.Literals(["available", "partial", "unavailable"]),
  value: Schema.NullOr(NonNegativeSafeIntegerSchema),
  observationCount: RecordedCallCountSchema,
}).check(Schema.makeFilter((value) => (value.state === "unavailable") === (value.value === null)));
const ConfiguredModelsSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-recorded") }),
  Schema.Struct({
    state: Schema.Literal("available"),
    bindings: Schema.Array(Schema.Struct({
      modelSlot: AdapterUsageModelSlotSchema,
      model: Schema.NullOr(Schema.String.check(Schema.isPattern(/\S/u))),
      reasoningEffort: Schema.NullOr(Schema.String.check(Schema.isPattern(/\S/u))),
      recordedCalls: Schema.NullOr(RecordedCallCountSchema),
    })).check(Schema.makeFilter((bindings) => bindings.length <= 64 &&
      bindings.every((entry, index) => index === 0 || bindings[index - 1]!.modelSlot < entry.modelSlot))),
  }),
]);
const ModelGroupSchema = Schema.Struct({
  modelSlot: Schema.NullOr(AdapterUsageModelSlotSchema),
  provider: AdapterUsageCallSchema.fields.provider,
  model: AdapterUsageCallSchema.fields.model,
  recordedCalls: RecordedCallCountSchema.check(Schema.isGreaterThan(0)),
  tokens: Schema.Struct({
    inputTotalTokens: ModelGroupTokenTotalSchema,
    outputTokens: ModelGroupTokenTotalSchema,
    totalTokens: ModelGroupTokenTotalSchema,
  }),
  costs: EffectiveCostTotalSchema,
}).check(Schema.makeFilter((group) => group.costs.totalCalls === group.recordedCalls &&
  Object.values(group.tokens).every((total) => total.observationCount <= group.recordedCalls)));
const ModelGroupsSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("available"),
    basis: Schema.Literal("recorded-calls"),
    groups: Schema.Array(ModelGroupSchema).check(Schema.makeFilter((groups) => groups.length <= 64 &&
      groups.every((entry, index) => index === 0 || compareAdapterModelGroups(groups[index - 1]!, entry) < 0))),
    totalGroupCount: RecordedCallCountSchema,
    groupsTruncated: Schema.Boolean,
    omittedGroupCount: RecordedCallCountSchema,
  }).check(Schema.makeFilter((value) => value.totalGroupCount === value.groups.length + value.omittedGroupCount &&
    value.groups.length === Math.min(value.totalGroupCount, 64) &&
    value.groupsTruncated === (value.omittedGroupCount > 0))),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    basis: Schema.Literals(["recorded-calls", "reported-sends", "unavailable"]),
    reason: Schema.Literals(["source-invalid", "usage-not-recorded", "physical-call-identity-not-recorded"]),
    groups: Schema.Tuple([]),
    totalGroupCount: Schema.Null,
    groupsTruncated: Schema.Literal(false),
    omittedGroupCount: Schema.Literal(0),
  }),
]);
const TotalUsageCostsSchema = Schema.Struct({
  state: Schema.Literals(["complete", "partial", "unavailable"]),
  values: Schema.Array(Schema.Struct({
    currency: UsageCurrencySchema,
    value: UsageDecimalSchema,
    source: Schema.Literals(["reported", "estimated", "mixed"]),
  })),
  missingSources: Schema.Array(Schema.Literals(["application", "judge"])).check(Schema.makeFilter((sources) =>
    sources.length <= 2 && sources.every((source, index) => index === 0 || sources[index - 1] === "application" && source === "judge"))),
}).check(Schema.makeFilter((value) => value.state === (value.missingSources.length === 0
    ? "complete" : value.values.length === 0 ? "unavailable" : "partial") &&
  value.values.every((entry, index) => index === 0 || value.values[index - 1]!.currency < entry.currency)));
export type TotalUsageCosts = Schema.Schema.Type<typeof TotalUsageCostsSchema>;

const ExperimentCostSummarySchema = Schema.Struct({
  scope: Schema.Literal("latest-recorded-slots"),
  totalCosts: TotalUsageCostsSchema,
  coverage: Schema.Struct({
    selectedSlotCount: NonNegativeSafeIntegerSchema,
    resolvedSlotCount: NonNegativeSafeIntegerSchema,
    originAttemptCount: NonNegativeSafeIntegerSchema,
    completeAttemptCount: NonNegativeSafeIntegerSchema,
    partialAttemptCount: NonNegativeSafeIntegerSchema,
    unavailableAttemptCount: NonNegativeSafeIntegerSchema,
    unresolvedSlotCount: NonNegativeSafeIntegerSchema,
  }).check(Schema.makeFilter((value) =>
    value.selectedSlotCount === value.resolvedSlotCount + value.unresolvedSlotCount &&
    value.originAttemptCount <= value.resolvedSlotCount &&
    value.originAttemptCount === value.completeAttemptCount + value.partialAttemptCount + value.unavailableAttemptCount)),
});

const JudgeCostTotalsSchema = EffectiveCostTotalSchema.check(Schema.makeFilter((costs) =>
  costs.totalCalls <= 4_000 &&
  (costs.source === null) === (costs.values.length === 0) &&
  costs.values.every((entry, index) => entry.coveredCalls <= entry.reportedCalls + entry.estimatedCalls &&
    entry.reportedCalls + entry.estimatedCalls <= costs.totalCalls &&
    entry.source === (entry.reportedCalls === 0 ? "estimated" : entry.estimatedCalls === 0 ? "reported" : "mixed") &&
    (index === 0 || costs.values[index - 1]!.currency < entry.currency)) &&
  costs.values.reduce((count, entry) => count + entry.reportedCalls + entry.estimatedCalls, 0) <= costs.totalCalls &&
  (costs.state !== "unavailable" || costs.values.length === 0) &&
  (costs.state !== "complete" || costs.values.reduce((count, entry) => count + entry.coveredCalls, 0) === costs.totalCalls)));
const JudgeUsageUnavailableSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("judge-usage-not-recorded") }),
  Schema.Struct({ state: Schema.Literal("invalid"), reason: Schema.Literal("judge-usage-source-invalid") }),
]);
const JudgeUsageSummaryFields = {
  state: Schema.Literals(["complete", "partial"]),
  coverage: Schema.Literal("physical-transmissions"),
  collection: CollectionStateSchema,
  totals: Schema.Struct({
    requests: ModelGroupTokenTotalSchema,
    inputTotalTokens: ModelGroupTokenTotalSchema,
    outputTokens: ModelGroupTokenTotalSchema,
    totalTokens: ModelGroupTokenTotalSchema,
    costs: JudgeCostTotalsSchema,
  }),
};
const JudgeUsageAvailableSummarySchema = Schema.Struct(JudgeUsageSummaryFields).check(Schema.makeFilter((usage) => {
  const requests = usage.totals.requests;
  return usage.state === usage.collection.state && requests.value === requests.observationCount &&
    requests.state === (usage.state === "complete" ? "available" : "partial") &&
    usage.totals.costs.totalCalls === requests.value &&
    (usage.state === "complete" || usage.totals.costs.state !== "complete") &&
    [usage.totals.inputTotalTokens, usage.totals.outputTokens, usage.totals.totalTokens].every((total) =>
      total.observationCount <= requests.observationCount && (total.state !== "available" ||
        usage.state === "complete" && total.observationCount === requests.observationCount)) &&
    (requests.value !== 0 || usage.state !== "complete" ||
      [usage.totals.inputTotalTokens, usage.totals.outputTokens, usage.totals.totalTokens].every((total) =>
        total.state === "available" && total.value === 0) && usage.totals.costs.state === "complete");
}));
const JudgeUsageSummarySchema = Schema.Union([JudgeUsageUnavailableSchema, JudgeUsageAvailableSummarySchema]);
export type JudgeUsageSummary = Schema.Schema.Type<typeof JudgeUsageSummarySchema>;
const JudgeUsageSchema = Schema.Union([
  JudgeUsageUnavailableSchema,
  Schema.Struct({
    ...JudgeUsageSummaryFields,
    calls: Schema.Array(JudgeUsageCallSchema),
    callsTruncated: Schema.Boolean,
    omittedCallCount: RecordedCallCountSchema,
    priceReceipts: Schema.Array(JudgePriceReceiptSchema),
  }).check(Schema.makeFilter((usage) => Schema.is(JudgeUsageAvailableSummarySchema)({
      state: usage.state, coverage: usage.coverage, collection: usage.collection, totals: usage.totals,
    }) && usage.calls.length <= JUDGE_USAGE_PREVIEW_CALL_LIMIT &&
    usage.calls.length + usage.omittedCallCount === usage.totals.requests.value &&
    usage.callsTruncated === (usage.omittedCallCount > 0) &&
    usage.calls.every((call, index) => index === 0 || compareJudgeUsageCalls(usage.calls[index - 1]!, call) < 0) &&
    utf8ByteLength(JSON.stringify({ calls: usage.calls, priceReceipts: usage.priceReceipts })) <= JUDGE_USAGE_PREVIEW_BYTE_LIMIT &&
    validateJudgeUsageAttachment({ collection: usage.collection, calls: usage.calls, priceReceipts: usage.priceReceipts }).length === 0)),
]);
export type JudgeUsage = Schema.Schema.Type<typeof JudgeUsageSchema>;
const UsageTotalsSchema = Schema.Struct({
  inputTotalTokens: Schema.optional(UsageNumericTotalSchema),
  inputTokens: UsageNumericTotalSchema,
  outputTokens: UsageNumericTotalSchema,
  requests: UsageNumericTotalSchema,
  providerCosts: Schema.optional(Schema.Struct({
    state: Schema.Literals(["available", "partial", "unavailable"]),
    values: Schema.Array(UsageCostTotalSchema),
    observationCount: Schema.Number,
  })),
  costs: Schema.optional(EffectiveCostTotalSchema),
});
export const InspectionAttemptUsageResultSchema = Schema.Struct({
  configuredModels: ConfiguredModelsSchema,
  modelGroups: ModelGroupsSchema,
  judgeUsage: JudgeUsageSchema,
  totalCosts: TotalUsageCostsSchema,
  source: Schema.optional(Schema.Literal("adapter")),
  coverage: Schema.optional(Schema.Literal("recorded-calls")),
  calls: Schema.optional(Schema.Array(AdapterUsageInspectionCallSchema)),
  priceReceipts: Schema.optional(Schema.NullOr(Schema.Array(AdapterCallPriceReceiptSchema))),
  callsTruncated: Schema.optional(Schema.Boolean),
  omittedCallCount: Schema.optional(Schema.Number),
  state: ProjectionStateSchema,
  limitations: Schema.Array(UsageLimitationSchema),
  limitationsTruncated: Schema.Boolean,
  omittedLimitationCount: Schema.Number,
  turns: Schema.Array(Schema.Struct({ turnId: Schema.String, coverage: UsageCoverageSchema })),
  turnsTruncated: Schema.Boolean,
  omittedTurnCount: Schema.Number,
  observations: Schema.Array(UsageObservationSchema),
  totals: UsageTotalsSchema,
  hasMore: Schema.Boolean,
  omittedObservationCount: Schema.Number,
});
export type InspectionAttemptUsageResult = Schema.Schema.Type<typeof InspectionAttemptUsageResultSchema>;

const RunOverviewStateSchema = Schema.Literals([
  "complete", "partial", "not-recorded", "invalid", "unavailable",
]);
const RunOverviewCoverageSchema = Schema.Struct({
  state: RunOverviewStateSchema,
  facts: Schema.Array(AttemptCoverageFactSchema),
  limitations: Schema.Array(AttemptLimitationSchema),
});
const RunOverviewUsageSchema = Schema.Struct({
  state: RunOverviewStateSchema,
  summary: Schema.NullOr(Schema.Struct({
    turnCount: Schema.Number,
    observationCount: Schema.Number,
  })),
  totals: UsageTotalsSchema,
  limitations: Schema.Array(UsageLimitationSchema),
  limitationsTruncated: Schema.Boolean,
  omittedLimitationCount: Schema.Number,
});
const RunOverviewMemberLimitationSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("member-not-observed"),
    state: Schema.Literals(["pending", "not-dispatched", "interrupted"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("attempt-unresolved"),
    originRunId: Schema.String,
    attemptId: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("coverage"), detail: AttemptLimitationSchema }),
  Schema.Struct({ kind: Schema.Literal("usage"), detail: UsageLimitationSchema }),
]);
const RunOverviewMemberSchema = Schema.Struct({
  slot: RecordSlotIdentitySchema,
  state: Schema.Literals([
    "executed", "carried", "accepted", "not-dispatched", "interrupted", "pending",
  ]),
  locator: Schema.NullOr(Schema.String),
  relation: Schema.NullOr(Schema.Literals(["origin", "reference"])),
  outcome: Schema.NullOr(Schema.Literals(["completed", "errored", "cancelled", "interrupted"])),
  verdict: VerdictSchema,
  score: Schema.NullOr(InspectionScoredValueSchema),
  coverage: RunOverviewCoverageSchema,
  usage: RunOverviewUsageSchema,
  limitations: Schema.Array(RunOverviewMemberLimitationSchema),
});
const RunOverviewLocatedLimitationSchema = Schema.Struct({
  slotId: Schema.String,
  locator: Schema.NullOr(Schema.String),
  limitation: RunOverviewMemberLimitationSchema,
});
export const InspectionRunOverviewResultSchema = Schema.Struct({
  identity: Schema.Struct({
    runId: RunIdSchema,
    experimentId: ExperimentIdSchema,
    adapter: Schema.NullOr(AdapterIdentitySchema),
  }),
  state: RunStateSchema,
  startedAt: UtcMillisSchema,
  completedAt: Schema.optional(UtcMillisSchema),
  denominator: Schema.Struct({ expected: Schema.Number, observed: Schema.Number }),
  members: Schema.Array(RunOverviewMemberSchema),
  coverage: Schema.Struct({
    state: RunOverviewStateSchema,
    expectedMemberCount: Schema.Number,
    observedMemberCount: Schema.Number,
    completeMemberCount: Schema.Number,
    factCount: Schema.Number,
    limitations: Schema.Array(RunOverviewLocatedLimitationSchema),
  }),
  usage: Schema.Struct({
    state: RunOverviewStateSchema,
    expectedMemberCount: Schema.Number,
    observedMemberCount: Schema.Number,
    recordedAttemptCount: Schema.Number,
    totals: UsageTotalsSchema,
    limitations: Schema.Array(RunOverviewLocatedLimitationSchema),
  }),
  limitations: Schema.Array(RunOverviewLocatedLimitationSchema),
});
export type InspectionRunOverviewResult = Schema.Schema.Type<typeof InspectionRunOverviewResultSchema>;

export const InspectionAttemptTimingResultSchema = Schema.Struct({
  state: ProjectionStateSchema,
  limitations: Schema.Array(ProjectionLimitationSchema),
  limitationsTruncated: Schema.Boolean,
  omittedLimitationCount: Schema.Number,
  activities: Schema.Array(Schema.Struct({
    activityId: Schema.String,
    sequence: Schema.Number,
    parentActivityId: Schema.NullOr(Schema.String),
    turnId: Schema.NullOr(Schema.String),
    phase: Schema.String,
    label: Schema.String,
    startOffsetMs: Schema.Number,
    durationMs: Schema.Number,
    outcome: Schema.Literals(ACTIVITY_OUTCOMES),
  })),
  hasMore: Schema.Boolean,
  omittedActivityCount: Schema.Number,
});
export type InspectionAttemptTimingResult = Schema.Schema.Type<typeof InspectionAttemptTimingResultSchema>;

const FileRevisionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), sha256: Schema.String, byteLength: Schema.Number, content: Schema.Literals(["available", "omitted"]) }),
  Schema.Struct({ kind: Schema.Literal("elided"), reason: Schema.Literals(["binary", "oversized-text"]), byteLength: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("unavailable"), reason: Schema.Literals(["unsupported-input", "capture-failed", "capture-interrupted"]) }),
]);
const FileEndpointSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({ state: Schema.Literal("present"), revision: FileRevisionSchema }),
]);
const DiffWindowSchema = Schema.Struct({
  windowId: Schema.String,
  sequence: Schema.Number,
  changes: Schema.Array(Schema.Struct({
    changeId: Schema.String,
    path: Schema.String,
    kind: Schema.Literals(["created", "modified", "deleted"]),
    before: FileEndpointSchema,
    after: FileEndpointSchema,
  })),
});
export const InspectionAttemptDiffResultSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-recorded"), windows: Schema.Tuple([]) }),
  Schema.Struct({ state: Schema.Literal("invalid"), issues: Schema.Array(Schema.String), windows: Schema.Tuple([]) }),
  Schema.Struct({
    state: Schema.Literals(["complete", "partial"]),
    limitations: Schema.Array(FileChangesCollectionLimitationSchema),
    windows: Schema.Array(DiffWindowSchema),
  }),
]);
export type InspectionAttemptDiffResult = Schema.Schema.Type<typeof InspectionAttemptDiffResultSchema>;

export interface InspectionSealedCutoff {
  readonly kind: "inspection-sealed-cutoff";
  readonly identity: string;
  readonly runCount: number;
  readonly runs: readonly { readonly runId: string; readonly logicalSealIdentity: string }[];
}
export interface InspectionSelectionAudit {
  readonly requestedRunIds: readonly string[];
  readonly selectedRunIds: readonly string[];
  readonly missingRunIds: readonly string[];
}
export interface InspectionResultMetadata<Kind extends InspectionOperationId> {
  readonly protocol: typeof QUERY_PROTOCOL;
  readonly behaviorVersion: typeof INSPECTION_BEHAVIOR_VERSION;
  readonly outcome: "success";
  readonly operation: Kind;
  readonly source: {
    readonly kind: "project-record" | "external-record";
    readonly sealedCutoffIdentity: string;
  };
  readonly sealedCutoff: InspectionSealedCutoff;
  readonly selection: InspectionSelectionAudit;
  readonly issues: readonly [];
  readonly evidence: { readonly refs: readonly string[] };
}

export type InspectionOverviewDocument = InspectionSuccessDocumentFor<"overview.get">;
export type InspectionExperimentDocument = InspectionSuccessDocumentFor<"experiment.get">;
export type InspectionRunListDocument = InspectionSuccessDocumentFor<"runs.list">;
export type InspectionRunDocument = InspectionSuccessDocumentFor<"run.get">;
export type InspectionRunSummaryDocument = InspectionSuccessDocumentFor<"run.summary">;
export type InspectionRunOverviewDocument = InspectionSuccessDocumentFor<"run.overview">;
export type InspectionAttemptDocument = InspectionSuccessDocumentFor<"attempt.get">;
export type InspectionAttemptSourcesDocument = InspectionSuccessDocumentFor<"attempt.sources">;
export type InspectionAttemptTraceDocument = InspectionSuccessDocumentFor<"attempt.trace">;
export type InspectionAttemptTraceDetailDocument = InspectionSuccessDocumentFor<"attempt.trace.detail">;
export type InspectionAttemptTimingDocument = InspectionSuccessDocumentFor<"attempt.timing">;
export type InspectionAttemptUsageDocument = InspectionSuccessDocumentFor<"attempt.usage">;
export type InspectionAttemptDiffDocument = InspectionSuccessDocumentFor<"attempt.diff">;

export type InspectionResultDocumentByOperation = {
  readonly [Kind in InspectionOperationId]: InspectionSuccessDocumentFor<Kind>;
};

type InspectionResultField<Kind extends InspectionOperationId> = Exclude<
  keyof InspectionSuccessDocumentFor<Kind>,
  keyof InspectionResultMetadata<Kind>
>;
export type InspectionResultByOperation = {
  readonly [Kind in InspectionOperationId]: InspectionSuccessDocumentFor<Kind>[
    InspectionResultField<Kind>
  ];
};

export type ShowInspectionDocument = InspectionSuccessDocument;
