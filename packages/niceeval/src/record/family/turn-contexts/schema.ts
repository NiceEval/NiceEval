import { Schema } from "effect";

import {
  RecordAttachmentReference,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
import { sourcesRecordAttachment } from "../sources/definition.ts";
import { TurnIdSchema } from "../source-receipt/codec.ts";
import { PositiveSafeIntegerSchema } from "../common.ts";
import {
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt/index.ts";

const PositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

export const MappedTurnContextSourceSchema = Schema.Struct({
  state: Schema.Literal("mapped"),
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: PositionSchema,
  end: PositionSchema,
});

export const TurnContextSourceSchema = Schema.Union([
  RecordAttachmentReference.to(
    sourcesRecordAttachment,
    MappedTurnContextSourceSchema,
  ),
  Schema.Struct({
    state: Schema.Literal("unmapped"),
    reason: Schema.Literals([
      "location-not-captured",
      "source-snapshot-not-recorded",
      "position-unrepresentable",
    ]),
  }),
]);

export const TurnContextReceiptSchema = Schema.Struct({
  segmentId: SourceSegmentIdSchema,
  sequence: PositiveSafeIntegerSchema,
  turnId: TurnIdSchema,
  sessionIndex: PositiveSafeIntegerSchema,
  turnIndex: PositiveSafeIntegerSchema,
  sourceOrder: Schema.NullOr(PositiveSafeIntegerSchema),
  source: TurnContextSourceSchema,
});

export const TurnContextsAttachmentSchema = Schema.Struct({
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(TurnContextReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

export type TurnContextsAttachment = Schema.Schema.Type<
  typeof TurnContextsAttachmentSchema
>;

export function validateTurnContextsAttachment(
  value: TurnContextsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!hasCanonicalSourceSegments(value.segments)) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["segments"]));
  }
  const turnIds = new Set<string>();
  const sourceOrders = new Set<number>();
  let priorSessionIndex = 0;
  let priorTurnIndex = 0;
  for (const [index, segment] of value.segments.entries()) {
    if (turnIds.has(segment.turnId)) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(index), "turnId"],
      ));
    }
    turnIds.add(segment.turnId);
    if (
      segment.sessionIndex < priorSessionIndex ||
      segment.sessionIndex === priorSessionIndex && segment.turnIndex <= priorTurnIndex
    ) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(index), "sessionIndex"],
      ));
    }
    priorSessionIndex = segment.sessionIndex;
    priorTurnIndex = segment.turnIndex;
    if (!("state" in segment.source)) {
      if (segment.sourceOrder === null) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(index), "sourceOrder"],
        ));
      }
      const { start, end } = segment.source.value;
      if (start.line > end.line || start.line === end.line && start.column > end.column) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(index), "source"],
        ));
      }
    }
    if (segment.sourceOrder !== null) {
      if (sourceOrders.has(segment.sourceOrder)) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(index), "sourceOrder"],
        ));
      }
      sourceOrders.add(segment.sourceOrder);
    }
  }
  value.collection.limitations.forEach((limitation, index) => {
    if (
      (limitation.code === "capture-failed" || limitation.code === "capture-interrupted") &&
      limitation.stage !== "session-manager" &&
      limitation.stage !== "attempt-finalizer" ||
      !["turn-context", "value-byte"].includes(limitation.target)
    ) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["collection", "limitations", String(index)],
      ));
    }
  });
  return Object.freeze(issues);
}
