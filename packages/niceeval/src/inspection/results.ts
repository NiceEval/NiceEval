import { Schema } from "effect";

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
import { QUERY_PROTOCOL, type InspectionOperationId } from "./codec.ts";

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
  unit: Schema.optional(Schema.Literal("points")),
  bounds: Schema.optional(Schema.Struct({ min: Schema.Number, max: Schema.Number })),
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
    reason: Schema.optional(Schema.Literals(["sampled", "truncated", "redacted", "provider-limited", "not-collected", "source-unavailable", "producer-failed", "optional-material", "unsupported-subject"])),
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
  coverage: Schema.Array(OverviewCoverageSchema),
  issues: Schema.Array(OverviewIssueSchema),
} as const;
const OverviewMemberSchema = Schema.Struct({
  runId: Schema.String,
  slotId: Schema.String,
  action: Schema.Literals([
    "executed", "carried", "accepted", "not-dispatched", "interrupted",
  ]),
  evalId: Schema.String,
  attemptOrdinal: Schema.Number,
  locator: Schema.NullOr(Schema.String),
  relation: Schema.NullOr(Schema.Literals(["origin", "reference"])),
  originRunId: Schema.NullOr(Schema.String),
  score: MetricSchema,
});
const OverviewGroupSchema = Schema.Struct({
  groupPath: Schema.Array(Schema.String),
  ...AggregateFields,
});
const OverviewExperimentSchema = Schema.Struct({
  experimentId: Schema.String,
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
  format: Schema.Literal("niceeval.inspection.overview/v1"),
  totals: Schema.Struct(AggregateFields),
  experiments: Schema.Array(OverviewExperimentSchema),
  cells: Schema.Array(OverviewCellSchema),
});
export type InspectionOverviewResult = Schema.Schema.Type<typeof InspectionOverviewResultSchema>;

export const InspectionExperimentResultSchema = Schema.Struct({
  format: Schema.Literal("niceeval.inspection.experiment/v1"),
  experiment: OverviewExperimentSchema,
  cells: Schema.Array(OverviewCellSchema),
});
export type InspectionExperimentResult = Schema.Schema.Type<typeof InspectionExperimentResultSchema>;

export const InspectionRunResultSchema = Schema.Struct({
  value: RunDocumentSchema,
  members: Schema.Array(MemberDocumentSchema),
  attempts: Schema.Array(AttemptDocumentSchema),
});
export type InspectionRunResult = Schema.Schema.Type<typeof InspectionRunResultSchema>;

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
    reason: Schema.Literals(["sampled", "truncated", "redacted", "provider-limited"]),
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
  format: Schema.Literal("niceeval.inspection.sources/v1"),
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
  format: Schema.Literal("niceeval.inspection.trace/v1"),
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
    toolOccurrenceIds: Schema.Struct({ ids: Schema.Array(ToolOccurrenceIdSchema) }),
    commandIds: Schema.Array(CommandIdSchema),
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
  Schema.Struct({ format: Schema.Literal("niceeval.inspection.trace-detail/v1"), kind: Schema.Literal("item"), itemId: ItemIdSchema, item: InspectionTraceDetailItemSchema }),
  Schema.Struct({
    format: Schema.Literal("niceeval.inspection.trace-detail/v1"),
    kind: Schema.Literal("tool-occurrence"),
    toolOccurrenceId: ToolOccurrenceIdSchema,
    call: Schema.NullOr(InspectionTraceDetailItemSchema),
    result: Schema.NullOr(InspectionTraceDetailItemSchema),
    turn: Schema.Struct({ call: Schema.NullOr(TraceTurnIdentitySchema), result: Schema.NullOr(TraceTurnIdentitySchema) }),
  }),
  Schema.Struct({
    format: Schema.Literal("niceeval.inspection.trace-detail/v1"),
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
const UsageTotalsSchema = Schema.Struct({
  inputTokens: UsageNumericTotalSchema,
  outputTokens: UsageNumericTotalSchema,
  requests: UsageNumericTotalSchema,
  providerCosts: Schema.Struct({
    state: Schema.Literals(["available", "partial", "unavailable"]),
    values: Schema.Array(UsageCostTotalSchema),
    observationCount: Schema.Number,
  }),
});
export const InspectionAttemptUsageResultSchema = Schema.Struct({
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
    state: Schema.Literals(["missing", "not-dispatched", "interrupted"]),
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
    "executed", "carried", "accepted", "not-dispatched", "interrupted", "missing",
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
  format: Schema.Literal("niceeval.inspection.run-overview/v1"),
  identity: Schema.Struct({ runId: RunIdSchema, experimentId: ExperimentIdSchema }),
  startedAt: UtcMillisSchema,
  completedAt: UtcMillisSchema,
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
  Schema.Struct({ format: Schema.Literal("niceeval.inspection.diff/v1"), state: Schema.Literal("not-recorded"), windows: Schema.Tuple([]) }),
  Schema.Struct({ format: Schema.Literal("niceeval.inspection.diff/v1"), state: Schema.Literal("invalid"), issues: Schema.Array(Schema.String), windows: Schema.Tuple([]) }),
  Schema.Struct({
    format: Schema.Literal("niceeval.inspection.diff/v1"),
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
  readonly operation: Kind;
  readonly behaviorVersion: string;
  readonly source: {
    readonly kind: "operational" | "record-snapshot";
    readonly sealedCutoffIdentity: string;
  };
  readonly sealedCutoff: InspectionSealedCutoff;
  readonly selection: InspectionSelectionAudit;
  readonly issues: readonly [];
  readonly evidence: { readonly refs: readonly string[] };
}

export type InspectionOverviewDocument = InspectionResultMetadata<"overview.get"> & { readonly overview: InspectionOverviewResult };
export type InspectionExperimentDocument = InspectionResultMetadata<"experiment.get"> & { readonly experiment: InspectionExperimentResult };
export type InspectionRunDocument = InspectionResultMetadata<"run.get"> & { readonly run: InspectionRunResult };
export type InspectionRunSummaryDocument = InspectionResultMetadata<"run.summary"> & { readonly summary: InspectionRunSummaryResult };
export type InspectionRunOverviewDocument = InspectionResultMetadata<"run.overview"> & { readonly runOverview: InspectionRunOverviewResult };
export type InspectionAttemptDocument = InspectionResultMetadata<"attempt.get"> & { readonly attempt: InspectionAttemptResult };
export type InspectionAttemptSourcesDocument = InspectionResultMetadata<"attempt.sources"> & { readonly sources: InspectionSourcesResult };
export type InspectionAttemptTraceDocument = InspectionResultMetadata<"attempt.trace"> & { readonly trace: InspectionTraceResult };
export type InspectionAttemptTraceDetailDocument = InspectionResultMetadata<"attempt.trace.detail"> & { readonly detail: InspectionTraceDetailResult };
export type InspectionAttemptTimingDocument = InspectionResultMetadata<"attempt.timing"> & { readonly timing: InspectionAttemptTimingResult };
export type InspectionAttemptUsageDocument = InspectionResultMetadata<"attempt.usage"> & { readonly usage: InspectionAttemptUsageResult };
export type InspectionAttemptDiffDocument = InspectionResultMetadata<"attempt.diff"> & { readonly diff: InspectionAttemptDiffResult };

export interface InspectionResultByOperation {
  readonly "overview.get": InspectionOverviewResult;
  readonly "experiment.get": InspectionExperimentResult;
  readonly "run.get": InspectionRunResult;
  readonly "run.summary": InspectionRunSummaryResult;
  readonly "run.overview": InspectionRunOverviewResult;
  readonly "attempt.get": InspectionAttemptResult;
  readonly "attempt.sources": InspectionSourcesResult;
  readonly "attempt.trace": InspectionTraceResult;
  readonly "attempt.trace.detail": InspectionTraceDetailResult;
  readonly "attempt.timing": InspectionAttemptTimingResult;
  readonly "attempt.usage": InspectionAttemptUsageResult;
  readonly "attempt.diff": InspectionAttemptDiffResult;
}

export interface InspectionResultDocumentByOperation {
  readonly "overview.get": InspectionOverviewDocument;
  readonly "experiment.get": InspectionExperimentDocument;
  readonly "run.get": InspectionRunDocument;
  readonly "run.summary": InspectionRunSummaryDocument;
  readonly "run.overview": InspectionRunOverviewDocument;
  readonly "attempt.get": InspectionAttemptDocument;
  readonly "attempt.sources": InspectionAttemptSourcesDocument;
  readonly "attempt.trace": InspectionAttemptTraceDocument;
  readonly "attempt.trace.detail": InspectionAttemptTraceDetailDocument;
  readonly "attempt.timing": InspectionAttemptTimingDocument;
  readonly "attempt.usage": InspectionAttemptUsageDocument;
  readonly "attempt.diff": InspectionAttemptDiffDocument;
}

export type ShowInspectionDocument =
  | InspectionOverviewDocument
  | InspectionExperimentDocument
  | InspectionRunDocument
  | InspectionRunSummaryDocument
  | InspectionRunOverviewDocument
  | InspectionAttemptDocument
  | InspectionAttemptSourcesDocument
  | InspectionAttemptTraceDocument
  | InspectionAttemptTraceDetailDocument
  | InspectionAttemptTimingDocument
  | InspectionAttemptUsageDocument
  | InspectionAttemptDiffDocument;
