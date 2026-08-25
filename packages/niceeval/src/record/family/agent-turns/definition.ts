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
} from "../../../o11y/record/codec.ts";
import { defineRecordAttachment } from "../../definition/index.ts";
import {
  NoBlobSourceReceiptBudget,
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
  type SourceReceiptCollection,
} from "../source-receipt.ts";
import { FixedAttachmentValueLimits, PositiveSafeIntegerSchema } from "../common.ts";

const CurrentAgentTurnItemBase = {
  itemId: ItemIdSchema,
  eventId: EventIdSchema,
  sessionSequence: ObservabilityPositiveSafeIntegerSchema,
} as const;

const ToolOccurrenceRelationSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("exact"), toolOccurrenceId: ToolOccurrenceIdSchema }),
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("orphan-finish", "ambiguous-operation") }),
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
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("send-failed", "send-interrupted") }),
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

function permittedAgentTurnsLimitations(
  collection: SourceReceiptCollection,
  state: "current" | "legacy",
): boolean {
  return collection.limitations.every((limitation) =>
    (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
      limitation.stage === "adapter" ||
      limitation.stage === "attempt-finalizer" ||
      (state === "current" && limitation.stage === "session-manager")) &&
    ["turn", "turn-item", "usage-observation", "payload-byte"].includes(limitation.target)
  );
}

function validReceiptEnvelope(input: {
  readonly collection: SourceReceiptCollection;
  readonly segments: readonly {
    readonly segmentId: string;
    readonly sequence: number;
    readonly turnId: string;
    readonly usage: readonly { readonly usageObservationId: string }[];
  }[];
}, state: "current" | "legacy"): boolean {
  if (!hasCanonicalSourceSegments(input.segments) || !permittedAgentTurnsLimitations(input.collection, state)) return false;
  const turnIds = new Set<string>();
  const usageIds = new Set<string>();
  for (const segment of input.segments) {
    if (turnIds.has(segment.turnId)) return false;
    turnIds.add(segment.turnId);
    for (const usage of segment.usage) {
      if (usageIds.has(usage.usageObservationId)) return false;
      usageIds.add(usage.usageObservationId);
    }
  }
  return true;
}

function validLegacyItems(segments: readonly Schema.Schema.Type<typeof LegacyAgentTurnReceiptSchema>[]): boolean {
  const itemIds = new Set<string>();
  let expectedItemSequence = 1;
  for (const segment of segments) {
    const calls = new Map<string, number>();
    const results = new Set<string>();
    for (const item of segment.items) {
      if (itemIds.has(item.itemId) || item.sequence !== expectedItemSequence) return false;
      expectedItemSequence += 1;
      itemIds.add(item.itemId);
      if (item.kind === "tool-call") {
        if (calls.has(item.callId)) return false;
        calls.set(item.callId, item.sequence);
      } else if (item.kind === "tool-result") {
        const callSequence = calls.get(item.callId);
        if (callSequence === undefined || callSequence >= item.sequence || results.has(item.callId)) return false;
        results.add(item.callId);
      }
    }
  }
  return true;
}

const CurrentAgentTurnsAttachmentSchema = Schema.Struct({
  state: Schema.Literal("current"),
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(Schema.fromKey("collection-data")),
  segments: Schema.propertySignature(Schema.Array(CurrentAgentTurnReceiptSchema)).pipe(Schema.fromKey("segments-data")),
}).pipe(Schema.filter((value) =>
  validReceiptEnvelope(value, "current") && projectObservedSourceEvents(value.segments).state === "available",
));

const LegacyAgentTurnsAttachmentSchema = Schema.Struct({
  state: Schema.Literal("legacy"),
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(Schema.fromKey("collection-data")),
  segments: Schema.propertySignature(Schema.Array(LegacyAgentTurnReceiptSchema)).pipe(Schema.fromKey("segments-data")),
}).pipe(Schema.filter((value) =>
  validReceiptEnvelope(value, "legacy") && validLegacyItems(value.segments),
));

/** Current v2 root keeps current and explicitly typed historical material disjoint. */
export const AgentTurnsAttachmentSchema = Schema.Union(
  CurrentAgentTurnsAttachmentSchema,
  LegacyAgentTurnsAttachmentSchema,
);

/** @internal Exact historical v1 wire root, loaded only by maintenance. */
export const AgentTurnsAttachmentV1Schema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(Schema.fromKey("collection-data")),
  segments: Schema.propertySignature(Schema.Array(LegacyAgentTurnReceiptSchema)).pipe(Schema.fromKey("segments-data")),
}).pipe(Schema.filter((value) =>
  validReceiptEnvelope(value, "legacy") && validLegacyItems(value.segments),
));

export type AgentTurnsAttachment = Schema.Schema.Type<typeof AgentTurnsAttachmentSchema>;
export type CurrentAgentTurnReceipt = Schema.Schema.Type<typeof CurrentAgentTurnReceiptSchema>;
export type LegacyAgentTurnReceipt = Schema.Schema.Type<typeof LegacyAgentTurnReceiptSchema>;

export const agentTurnsRecordAttachment = defineRecordAttachment({
  family: "niceeval.agent-turns",
  current: {
    schemaVersion: 2,
    owners: {
      attempt: {
        schema: AgentTurnsAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: () => Object.freeze([]),
          budget: NoBlobSourceReceiptBudget,
          verify: () => Object.freeze([]),
        },
      },
    },
  },
  maintenance: () => import("./migrate/index.ts").then(
    ({ agentTurnsMaintenance }) => agentTurnsMaintenance,
  ),
  adjacentMigrationLinks: Object.freeze([
    Object.freeze({ fromSchemaVersion: 1, toSchemaVersion: 2, rewritePayload: true }),
  ]),
});
