import { Schema } from "effect";
import { AGENT_TURN_OUTCOMES } from "../protocol-values.ts";

import { projectObservedSourceEvents } from "../../../o11y/derive.ts";
import {
  CurrencyCodeSchema,
  EventIdSchema,
  ItemIdSchema,
  LegacySourceLocalCallIdSchema,
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

const LegacyAgentTurnItemBase = {
  itemId: ItemIdSchema,
  sequence: PositiveSafeIntegerSchema,
} as const;

export const LegacyAgentTurnItemSchema = Schema.Union([
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("message"), role: Schema.Literals(["user", "assistant"]), text: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("tool-call"), callId: LegacySourceLocalCallIdSchema, tool: SourceNativeToolNameSchema, inputSummary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("tool-result"), callId: LegacySourceLocalCallIdSchema, outcome: Schema.Literals(["completed", "rejected", "failed", "cancelled"]), outputSummary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literals(["thinking-summary", "compaction", "context-injection"]), summary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("subagent"), state: Schema.Literals(["started", "completed", "failed"]), label: SafeIdentifierSchema, summary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("input-request"), state: Schema.Literals(["requested", "answered", "cancelled"]), promptSummary: SafeTextSchema, responseSummary: Schema.NullOr(SafeTextSchema) }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literals(["skill-load", "conversation-error"]), code: SafeIdentifierSchema, summary: SafeTextSchema }),
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

const AgentTurnsRevision3TerminalSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("recorded"),
    status: Schema.Literals(["completed", "failed", "waiting"]),
    evidenceCoverage: Schema.Struct({
      events: AgentTurnCoverageStatusSchema,
      actions: AgentTurnCoverageStatusSchema,
      messages: AgentTurnCoverageStatusSchema,
      usage: AgentTurnCoverageStatusSchema,
      status: AgentTurnCoverageStatusSchema,
      data: AgentTurnCoverageStatusSchema,
    }),
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["send-failed", "send-interrupted"]),
  }),
]);

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

export const LegacyAgentTurnReceiptSchema = Schema.Struct({
  ...AgentTurnReceiptBase,
  terminal: AgentTurnTerminalSchema,
  items: Schema.Array(LegacyAgentTurnItemSchema),
});

const AgentTurnsRevision3CurrentReceiptSchema = Schema.Struct({
  ...AgentTurnReceiptBase,
  sessionId: SessionScopeIdSchema,
  terminal: AgentTurnsRevision3TerminalSchema,
  items: Schema.Array(CurrentAgentTurnItemSchema),
});

const AgentTurnsRevision3LegacyReceiptSchema = Schema.Struct({
  ...AgentTurnReceiptBase,
  terminal: AgentTurnsRevision3TerminalSchema,
  items: Schema.Array(LegacyAgentTurnItemSchema),
});

/** Revision 2 receipt alias retained only for its adjacent migration. */
export const AgentTurnReceiptSchema = AgentTurnsRevision3LegacyReceiptSchema;

export const AgentTurnsRevision2AttachmentSchema = Schema.Struct({
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(AgentTurnsRevision3LegacyReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

export const AgentTurnsRevision3AttachmentSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("current"),
    collection: SourceReceiptCollectionSchema,
    segments: Schema.Array(AgentTurnsRevision3CurrentReceiptSchema),
  }).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" })),
  Schema.Struct({
    state: Schema.Literal("legacy"),
    collection: SourceReceiptCollectionSchema,
    segments: Schema.Array(AgentTurnsRevision3LegacyReceiptSchema),
  }).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" })),
]);

const CurrentAgentTurnsAttachmentSchema = Schema.Struct({
  state: Schema.Literal("current"),
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(CurrentAgentTurnReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

const LegacyAgentTurnsAttachmentSchema = Schema.Struct({
  state: Schema.Literal("legacy"),
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(LegacyAgentTurnReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

export const AgentTurnsAttachmentSchema = Schema.Union([
  CurrentAgentTurnsAttachmentSchema,
  LegacyAgentTurnsAttachmentSchema,
]);

export type AgentTurnsAttachment = typeof AgentTurnsAttachmentSchema.Type;
export type AgentTurnsRevision2Attachment = typeof AgentTurnsRevision2AttachmentSchema.Type;
export type AgentTurnsRevision3Attachment = typeof AgentTurnsRevision3AttachmentSchema.Type;
export type CurrentAgentTurnReceipt = typeof CurrentAgentTurnReceiptSchema.Type;
export type LegacyAgentTurnReceipt = typeof LegacyAgentTurnReceiptSchema.Type;
type LegacyAgentTurnItem = typeof LegacyAgentTurnItemSchema.Type;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function permittedLimitations(
  collection: SourceReceiptCollection,
  state: "current" | "legacy",
): boolean {
  return collection.limitations.every((limitation) =>
    (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
      limitation.stage === "adapter" ||
      limitation.stage === "attempt-finalizer" ||
      state === "current" && limitation.stage === "session-manager") &&
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
}, state: "current" | "legacy"): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!hasCanonicalSourceSegments(input.segments) || !permittedLimitations(input.collection, state)) {
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

function validateLegacyItems(
  segments: readonly { readonly items: readonly LegacyAgentTurnItem[] }[],
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  const itemIds = new Set<string>();
  let expectedItemSequence = 1;
  for (const [segmentIndex, segment] of segments.entries()) {
    const calls = new Map<string, number>();
    const results = new Set<string>();
    for (const [itemIndex, item] of segment.items.entries()) {
      const path = ["segments", String(segmentIndex), "items", String(itemIndex)];
      if (itemIds.has(item.itemId) || item.sequence !== expectedItemSequence) {
        issues.push(invalid(path));
      }
      expectedItemSequence += 1;
      itemIds.add(item.itemId);
      if (item.kind === "tool-call") {
        if (calls.has(item.callId)) issues.push(invalid([...path, "callId"]));
        calls.set(item.callId, item.sequence);
      } else if (item.kind === "tool-result") {
        const callSequence = calls.get(item.callId);
        if (
          callSequence === undefined ||
          callSequence >= item.sequence ||
          results.has(item.callId)
        ) {
          issues.push(invalid([...path, "callId"]));
        }
        results.add(item.callId);
      }
    }
  }
  return issues;
}

export function validateAgentTurnsRevision2Attachment(
  value: AgentTurnsRevision2Attachment,
): readonly RecordAttachmentIssue[] {
  return Object.freeze([
    ...validateReceiptEnvelope(value, "legacy"),
    ...validateLegacyItems(value.segments),
  ]);
}

export function validateAgentTurnsRevision3Attachment(
  value: AgentTurnsRevision3Attachment,
): readonly RecordAttachmentIssue[] {
  const issues = [...validateReceiptEnvelope(value, value.state)];
  if (value.state === "legacy") {
    issues.push(...validateLegacyItems(value.segments));
  } else if (projectObservedSourceEvents(value.segments.map(({ sessionId, turnId, items }) =>
    Object.freeze({ sessionId, turnId, items }))).state !== "available") {
    issues.push(invalid(["segments"]));
  }
  return Object.freeze(issues);
}

export function validateAgentTurnsAttachment(
  value: AgentTurnsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues = [...validateReceiptEnvelope(value, value.state)];
  if (value.state === "legacy") {
    issues.push(...validateLegacyItems(value.segments));
  } else if (projectObservedSourceEvents(value.segments).state !== "available") {
    issues.push(invalid(["segments"]));
  }
  return Object.freeze(issues);
}
