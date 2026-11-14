import * as Schema from "effect/Schema";
import { AGENT_TURN_OUTCOMES } from "../protocol-values.ts";

import { projectObservedSourceEvents } from "../../../o11y/derive.ts";
import {
  CurrencyCodeSchema,
  EventIdSchema,
  ItemIdSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema as ObservabilityPositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
  SessionScopeIdSchema,
  SourceNativeToolNameSchema,
  ToolOccurrenceIdSchema,
  TurnIdSchema,
  UsageObservationIdSchema,
} from "../source-receipt/codec.ts";
import { MAX_CONVERSATION_TEXT_BYTES } from "../source-receipt/limits.ts";
import { isBoundedSafeText } from "../source-receipt/model.ts";
import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import {
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
  type SourceReceiptCollection,
} from "../source-receipt/index.ts";
import { PositiveSafeIntegerSchema } from "../common.ts";

const CurrentAgentTurnItemBase = {
  itemId: ItemIdSchema,
  eventId: EventIdSchema,
  sessionSequence: ObservabilityPositiveSafeIntegerSchema,
} as const;

const ToolOccurrenceRelationSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("exact"), toolOccurrenceId: ToolOccurrenceIdSchema }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["orphan-finish", "ambiguous-operation"]),
  }),
]);

export const CurrentAgentTurnItemSchema = Schema.Union([
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("message"), role: Schema.Literals(["user", "assistant"]), text: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("tool-start"), toolOccurrenceId: ToolOccurrenceIdSchema, tool: SourceNativeToolNameSchema, inputSummary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("tool-finish"), occurrence: ToolOccurrenceRelationSchema, outcome: Schema.Literals(["completed", "rejected", "failed", "cancelled"]), outputSummary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literals(["thinking-summary", "compaction", "context-injection"]), summary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("subagent"), state: Schema.Literals(["started", "completed", "failed"]), label: SafeIdentifierSchema, summary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("input-request"), state: Schema.Literals(["requested", "answered", "cancelled"]), promptSummary: SafeTextSchema, responseSummary: Schema.NullOr(SafeTextSchema) }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literals(["skill-load", "conversation-error"]), code: SafeIdentifierSchema, summary: SafeTextSchema }),
]);

export const AgentTurnUsageObservationSchema = Schema.Union([
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("token-bucket"), provider: SafeIdentifierSchema, bucket: Schema.Literals(["input", "output", "cache-read", "cache-write", "reasoning", "other"]), tokens: NonNegativeSafeIntegerSchema }),
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("request"), provider: SafeIdentifierSchema, requestKind: Schema.Literals(["model", "tool"]) }),
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("provider-cost"), provider: SafeIdentifierSchema, amount: Schema.String.pipe(Schema.check(Schema.makeFilter((value) => /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value)))), currency: CurrencyCodeSchema }),
]);

const AgentTurnCoverageStatusSchema = Schema.Literals(["complete", "partial", "unavailable"]);
const AgentTurnCoverageReasonSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => value.trim().length > 0 &&
    Boolean(isBoundedSafeText(value, MAX_CONVERSATION_TEXT_BYTES)), {
    identifier: "AgentTurnEvidenceCoverageReason",
    description: "non-empty durable coverage reason within the conversation text limit",
  })),
);

const AgentTurnEvidenceCoverageEntrySchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("complete") }),
  Schema.Struct({
    status: Schema.Literals(["partial", "unavailable"]),
    reason: AgentTurnCoverageReasonSchema,
  }),
]);

const AgentTurnEvidenceCoverageSchema = Schema.Struct({
  events: AgentTurnEvidenceCoverageEntrySchema,
  actions: AgentTurnEvidenceCoverageEntrySchema,
  messages: AgentTurnEvidenceCoverageEntrySchema,
  usage: AgentTurnEvidenceCoverageEntrySchema,
  status: AgentTurnEvidenceCoverageEntrySchema,
  data: AgentTurnEvidenceCoverageEntrySchema,
});

export const AgentTurnTerminalSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("recorded"),
    status: Schema.Literals(["completed", "failed", "waiting"]),
    evidenceCoverage: AgentTurnEvidenceCoverageSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["send-failed", "send-interrupted"]),
  }),
]);

const AgentTurnReceiptBase = {
  segmentId: SourceSegmentIdSchema,
  turnId: TurnIdSchema,
  sequence: PositiveSafeIntegerSchema,
  outcome: Schema.Literals(AGENT_TURN_OUTCOMES),
  usage: Schema.Array(AgentTurnUsageObservationSchema),
} as const;

export const CurrentAgentTurnReceiptSchema = Schema.Struct({
  ...AgentTurnReceiptBase,
  sessionId: SessionScopeIdSchema,
  terminal: AgentTurnTerminalSchema,
  items: Schema.Array(CurrentAgentTurnItemSchema),
});

const CurrentAgentTurnsAttachmentSchema = Schema.Struct({
  state: Schema.Literal("current"),
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(CurrentAgentTurnReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

export const AgentTurnsAttachmentSchema = CurrentAgentTurnsAttachmentSchema;

export type AgentTurnsAttachment = typeof AgentTurnsAttachmentSchema.Type;
export type CurrentAgentTurnReceipt = typeof CurrentAgentTurnReceiptSchema.Type;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function permittedLimitations(
  collection: SourceReceiptCollection,
): boolean {
  return collection.limitations.every((limitation) =>
    (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
      limitation.stage === "adapter" ||
      limitation.stage === "attempt-finalizer" ||
      limitation.stage === "session-manager") &&
    ["turn", "turn-item", "usage-observation", "value-byte"].includes(limitation.target)
  );
}

function validateReceiptEnvelope(input: {
  readonly collection: SourceReceiptCollection;
  readonly segments: readonly {
    readonly segmentId: string;
    readonly sequence: number;
    readonly turnId: string;
    readonly usage: readonly { readonly usageObservationId: string }[];
  }[];
}): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!hasCanonicalSourceSegments(input.segments) || !permittedLimitations(input.collection)) {
    issues.push(invalid([]));
  }
  const turnIds = new Set<string>();
  const usageIds = new Set<string>();
  for (const [segmentIndex, segment] of input.segments.entries()) {
    if (turnIds.has(segment.turnId)) {
      issues.push(invalid(["segments", String(segmentIndex), "turnId"]));
    }
    turnIds.add(segment.turnId);
    for (const [usageIndex, usage] of segment.usage.entries()) {
      if (usageIds.has(usage.usageObservationId)) {
        issues.push(invalid([
          "segments",
          String(segmentIndex),
          "usage",
          String(usageIndex),
          "usageObservationId",
        ]));
      }
      usageIds.add(usage.usageObservationId);
    }
  }
  return issues;
}

export function validateAgentTurnsAttachment(
  value: AgentTurnsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues = [...validateReceiptEnvelope(value)];
  if (projectObservedSourceEvents(value.segments).state !== "available") {
    issues.push(invalid(["segments"]));
  }
  return Object.freeze(issues);
}
