import { Schema } from "effect";

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

const ToolOccurrenceRelationSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("exact"), toolOccurrenceId: ToolOccurrenceIdSchema }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literal("orphan-finish", "ambiguous-operation"),
  }),
);

export const CurrentAgentTurnItemSchema = Schema.Union(
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("message"), role: Schema.Literal("user", "assistant"), text: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("tool-start"), toolOccurrenceId: ToolOccurrenceIdSchema, tool: SourceNativeToolNameSchema, inputSummary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("tool-finish"), occurrence: ToolOccurrenceRelationSchema, outcome: Schema.Literal("completed", "rejected", "failed", "cancelled"), outputSummary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("thinking-summary", "compaction", "context-injection"), summary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("subagent"), state: Schema.Literal("started", "completed", "failed"), label: SafeIdentifierSchema, summary: SafeTextSchema }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("input-request"), state: Schema.Literal("requested", "answered", "cancelled"), promptSummary: SafeTextSchema, responseSummary: Schema.NullOr(SafeTextSchema) }),
  Schema.Struct({ ...CurrentAgentTurnItemBase, kind: Schema.Literal("skill-load", "conversation-error"), code: SafeIdentifierSchema, summary: SafeTextSchema }),
);

const LegacyAgentTurnItemBase = {
  itemId: ItemIdSchema,
  sequence: PositiveSafeIntegerSchema,
} as const;

export const LegacyAgentTurnItemSchema = Schema.Union(
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("message"), role: Schema.Literal("user", "assistant"), text: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("tool-call"), callId: LegacySourceLocalCallIdSchema, tool: SourceNativeToolNameSchema, inputSummary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("tool-result"), callId: LegacySourceLocalCallIdSchema, outcome: Schema.Literal("completed", "rejected", "failed", "cancelled"), outputSummary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("thinking-summary", "compaction", "context-injection"), summary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("subagent"), state: Schema.Literal("started", "completed", "failed"), label: SafeIdentifierSchema, summary: SafeTextSchema }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("input-request"), state: Schema.Literal("requested", "answered", "cancelled"), promptSummary: SafeTextSchema, responseSummary: Schema.NullOr(SafeTextSchema) }),
  Schema.Struct({ ...LegacyAgentTurnItemBase, kind: Schema.Literal("skill-load", "conversation-error"), code: SafeIdentifierSchema, summary: SafeTextSchema }),
);

export const AgentTurnUsageObservationSchema = Schema.Union(
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("token-bucket"), provider: SafeIdentifierSchema, bucket: Schema.Literal("input", "output", "cache-read", "cache-write", "reasoning", "other"), tokens: NonNegativeSafeIntegerSchema }),
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("request"), provider: SafeIdentifierSchema, requestKind: Schema.Literal("model", "tool") }),
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("provider-cost"), provider: SafeIdentifierSchema, amount: Schema.String.pipe(Schema.filter((value) => /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value))), currency: CurrencyCodeSchema }),
);

export const AgentTurnTerminalSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("recorded"),
    status: Schema.Literal("completed", "failed", "waiting"),
    evidenceCoverage: Schema.Struct({
      events: Schema.Literal("complete", "partial", "unavailable"),
      actions: Schema.Literal("complete", "partial", "unavailable"),
      messages: Schema.Literal("complete", "partial", "unavailable"),
      usage: Schema.Literal("complete", "partial", "unavailable"),
      status: Schema.Literal("complete", "partial", "unavailable"),
      data: Schema.Literal("complete", "partial", "unavailable"),
    }),
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literal("send-failed", "send-interrupted"),
  }),
);

const AgentTurnReceiptBase = {
  segmentId: SourceSegmentIdSchema,
  turnId: TurnIdSchema,
  sequence: PositiveSafeIntegerSchema,
  outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted"),
  terminal: AgentTurnTerminalSchema,
  usage: Schema.Array(AgentTurnUsageObservationSchema),
} as const;

export const CurrentAgentTurnReceiptSchema = Schema.Struct({
  ...AgentTurnReceiptBase,
  sessionId: SessionScopeIdSchema,
  items: Schema.Array(CurrentAgentTurnItemSchema),
});

export const LegacyAgentTurnReceiptSchema = Schema.Struct({
  ...AgentTurnReceiptBase,
  items: Schema.Array(LegacyAgentTurnItemSchema),
});

/** Revision 2 receipt alias retained only for its adjacent migration. */
export const AgentTurnReceiptSchema = LegacyAgentTurnReceiptSchema;

export const AgentTurnsRevision2AttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(LegacyAgentTurnReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

const CurrentAgentTurnsAttachmentSchema = Schema.Struct({
  state: Schema.Literal("current"),
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(CurrentAgentTurnReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

const LegacyAgentTurnsAttachmentSchema = Schema.Struct({
  state: Schema.Literal("legacy"),
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(LegacyAgentTurnReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

export const AgentTurnsAttachmentSchema = Schema.Union(
  CurrentAgentTurnsAttachmentSchema,
  LegacyAgentTurnsAttachmentSchema,
);

export type AgentTurnsAttachment = typeof AgentTurnsAttachmentSchema.Type;
export type AgentTurnsRevision2Attachment = typeof AgentTurnsRevision2AttachmentSchema.Type;
export type CurrentAgentTurnReceipt = typeof CurrentAgentTurnReceiptSchema.Type;
export type LegacyAgentTurnReceipt = typeof LegacyAgentTurnReceiptSchema.Type;

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
  segments: readonly LegacyAgentTurnReceipt[],
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
