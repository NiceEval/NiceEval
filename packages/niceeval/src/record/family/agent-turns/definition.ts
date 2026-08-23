import { Schema } from "effect";

import {
  CallIdSchema,
  CurrencyCodeSchema,
  ItemIdSchema,
  NonNegativeSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
  SourceNativeToolNameSchema,
  TurnIdSchema,
  UsageObservationIdSchema,
} from "../../../o11y/record/codec.ts";
import { defineRecordAttachment } from "../../definition/index.ts";
import {
  NoBlobSourceReceiptBudget,
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt.ts";
import { FixedAttachmentValueLimits, PositiveSafeIntegerSchema } from "../common.ts";

const AgentTurnItemBase = {
  itemId: ItemIdSchema,
  sequence: PositiveSafeIntegerSchema,
} as const;

export const AgentTurnItemSchema = Schema.Union(
  Schema.Struct({ ...AgentTurnItemBase, kind: Schema.Literal("message"), role: Schema.Literal("user", "assistant"), text: SafeTextSchema }),
  Schema.Struct({ ...AgentTurnItemBase, kind: Schema.Literal("tool-call"), callId: CallIdSchema, tool: SourceNativeToolNameSchema, inputSummary: SafeTextSchema }),
  Schema.Struct({ ...AgentTurnItemBase, kind: Schema.Literal("tool-result"), callId: CallIdSchema, outcome: Schema.Literal("completed", "rejected", "failed", "cancelled"), outputSummary: SafeTextSchema }),
  Schema.Struct({ ...AgentTurnItemBase, kind: Schema.Literal("thinking-summary", "compaction", "context-injection"), summary: SafeTextSchema }),
  Schema.Struct({ ...AgentTurnItemBase, kind: Schema.Literal("subagent"), state: Schema.Literal("started", "completed", "failed"), label: SafeIdentifierSchema, summary: SafeTextSchema }),
  Schema.Struct({ ...AgentTurnItemBase, kind: Schema.Literal("input-request"), state: Schema.Literal("requested", "answered", "cancelled"), promptSummary: SafeTextSchema, responseSummary: Schema.NullOr(SafeTextSchema) }),
  Schema.Struct({ ...AgentTurnItemBase, kind: Schema.Literal("skill-load", "conversation-error"), code: SafeIdentifierSchema, summary: SafeTextSchema }),
);

export const AgentTurnUsageObservationSchema = Schema.Union(
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("token-bucket"), provider: SafeIdentifierSchema, bucket: Schema.Literal("input", "output", "cache-read", "cache-write", "reasoning", "other"), tokens: NonNegativeSafeIntegerSchema }),
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("request"), provider: SafeIdentifierSchema, requestKind: Schema.Literal("model", "tool") }),
  Schema.Struct({ usageObservationId: UsageObservationIdSchema, kind: Schema.Literal("provider-cost"), provider: SafeIdentifierSchema, amount: Schema.String.pipe(Schema.filter((value) => /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value))), currency: CurrencyCodeSchema }),
);

export const AgentTurnReceiptSchema = Schema.Struct({
  segmentId: SourceSegmentIdSchema,
  turnId: TurnIdSchema,
  sequence: PositiveSafeIntegerSchema,
  outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted"),
  terminal: Schema.Union(
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
  ),
  items: Schema.Array(AgentTurnItemSchema),
  usage: Schema.Array(AgentTurnUsageObservationSchema),
});

export const AgentTurnsAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(Schema.fromKey("collection-data")),
  segments: Schema.propertySignature(Schema.Array(AgentTurnReceiptSchema)).pipe(Schema.fromKey("segments-data")),
}).pipe(Schema.filter((value) => {
  if (!hasCanonicalSourceSegments(value.segments)) return false;
  const turnIds = new Set<string>();
  const itemIds = new Set<string>();
  const usageIds = new Set<string>();
  let expectedItemSequence = 1;
  for (const segment of value.segments) {
    if (turnIds.has(segment.turnId)) return false;
    turnIds.add(segment.turnId);
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
    for (const usage of segment.usage) {
      if (usageIds.has(usage.usageObservationId)) return false;
      usageIds.add(usage.usageObservationId);
    }
  }
  return value.collection.limitations.every((limitation) =>
    (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" || limitation.stage === "adapter" || limitation.stage === "attempt-finalizer") &&
    ["turn", "turn-item", "usage-observation", "payload-byte"].includes(limitation.target)
  );
}, { identifier: "AgentTurnsAttachment", description: "canonical terminal Turn receipts owned by the Adapter boundary" }));

export type AgentTurnsAttachment = Schema.Schema.Type<typeof AgentTurnsAttachmentSchema>;

export const agentTurnsRecordAttachment = defineRecordAttachment({
  family: "niceeval.agent-turns",
  current: { schemaVersion: 1, owners: { attempt: { schema: AgentTurnsAttachmentSchema, limits: FixedAttachmentValueLimits, blobs: { refs: () => Object.freeze([]), budget: NoBlobSourceReceiptBudget, verify: () => Object.freeze([]) } } } },
});
