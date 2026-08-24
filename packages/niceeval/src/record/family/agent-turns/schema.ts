import { Schema } from "effect";

import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
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
} from "../source-receipt/codec.ts";
import {
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt/index.ts";
import { PositiveSafeIntegerSchema } from "../common.ts";

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
});

export type AgentTurnsAttachment = Schema.Schema.Type<typeof AgentTurnsAttachmentSchema>;

export function validateAgentTurnsAttachment(
  value: AgentTurnsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!hasCanonicalSourceSegments(value.segments)) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["segments"]));
  }
  const turnIds = new Set<string>();
  const itemIds = new Set<string>();
  const usageIds = new Set<string>();
  let expectedItemSequence = 1;
  for (const [segmentIndex, segment] of value.segments.entries()) {
    if (turnIds.has(segment.turnId)) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(segmentIndex), "turnId"],
      ));
    }
    turnIds.add(segment.turnId);
    const calls = new Map<string, number>();
    const results = new Set<string>();
    for (const [itemIndex, item] of segment.items.entries()) {
      if (itemIds.has(item.itemId) || item.sequence !== expectedItemSequence) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(segmentIndex), "items", String(itemIndex)],
        ));
      }
      expectedItemSequence += 1;
      itemIds.add(item.itemId);
      if (item.kind === "tool-call") {
        if (calls.has(item.callId)) {
          issues.push(recordAttachmentIssue(
            "record-attachment-schema-invalid",
            ["segments", String(segmentIndex), "items", String(itemIndex), "callId"],
          ));
        }
        calls.set(item.callId, item.sequence);
      } else if (item.kind === "tool-result") {
        const callSequence = calls.get(item.callId);
        if (
          callSequence === undefined ||
          callSequence >= item.sequence ||
          results.has(item.callId)
        ) {
          issues.push(recordAttachmentIssue(
            "record-attachment-schema-invalid",
            ["segments", String(segmentIndex), "items", String(itemIndex), "callId"],
          ));
        }
        results.add(item.callId);
      }
    }
    for (const [usageIndex, usage] of segment.usage.entries()) {
      if (usageIds.has(usage.usageObservationId)) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(segmentIndex), "usage", String(usageIndex), "usageObservationId"],
        ));
      }
      usageIds.add(usage.usageObservationId);
    }
  }
  value.collection.limitations.forEach((limitation, index) => {
    if (
      (limitation.code === "capture-failed" || limitation.code === "capture-interrupted") &&
      limitation.stage !== "adapter" &&
      limitation.stage !== "attempt-finalizer" ||
      !["turn", "turn-item", "usage-observation", "value-byte"].includes(
        limitation.target,
      )
    ) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["collection", "limitations", String(index)],
      ));
    }
  });
  return Object.freeze(issues);
}
