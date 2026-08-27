import { Effect, Result, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../../codec/identifiers.ts";
import { EmptyArraySchema, PositiveSafeIntegerSchema } from "../../common.ts";
import {
  SourceReceiptStageSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../../source-receipt/index.ts";
import { TurnIdSchema } from "../../source-receipt/codec.ts";
import { sourcesRecordAttachment } from "../../sources/definition.ts";

const HistoricalSourceRetentionTargetSchema = Schema.Literals([
  "turn",
  "turn-item",
  "usage-observation",
  "turn-context",
  "command",
  "stdout",
  "stderr",
  "activity",
  "diagnostic",
  "diagnostic-cause",
  "payload-byte",
  "blob-byte",
]);

const HistoricalSourceReceiptLimitationSchema = Schema.Union([
  Schema.Struct({
    code: Schema.Literals(["capture-failed", "capture-interrupted"]),
    stage: SourceReceiptStageSchema,
    target: HistoricalSourceRetentionTargetSchema,
  }),
  Schema.Struct({
    code: Schema.Literals(["collection-cap-reached", "unsupported-input"]),
    target: HistoricalSourceRetentionTargetSchema,
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literals([
      "text-truncated",
      "redacted",
      "invalid-utf8-replaced",
      "unsafe-control-stripped",
    ]),
    target: HistoricalSourceRetentionTargetSchema,
    replacementOrOmittedCount: PositiveSafeIntegerSchema,
  }),
]);

type HistoricalSourceReceiptLimitation =
  typeof HistoricalSourceReceiptLimitationSchema.Type;

function limitationKey(value: object): string {
  return JSON.stringify(value);
}

function canonicalLimitations(
  values: readonly HistoricalSourceReceiptLimitation[],
): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const key = limitationKey(value);
    if (seen.has(key) || previous !== undefined && previous >= key) return false;
    seen.add(key);
    previous = key;
  }
  return true;
}

const HistoricalSourceReceiptCollectionSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(HistoricalSourceReceiptLimitationSchema).pipe(
      Schema.check(Schema.makeFilter(canonicalLimitations)),
    ),
  }),
]);

const HistoricalPositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

const HistoricalMappedSourceSchema = Schema.Struct({
  state: Schema.Literal("mapped"),
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: HistoricalPositionSchema,
  end: HistoricalPositionSchema,
});

const HistoricalTurnContextSourceSchema = Schema.Union([
  HistoricalMappedSourceSchema,
  Schema.Struct({
    state: Schema.Literal("unmapped"),
    reason: Schema.Literals([
      "location-not-captured",
      "source-snapshot-not-recorded",
      "position-unrepresentable",
    ]),
  }),
]);

const HistoricalTurnContextReceiptSchema = Schema.Struct({
  segmentId: SourceSegmentIdSchema,
  sequence: PositiveSafeIntegerSchema,
  turnId: TurnIdSchema,
  sessionIndex: PositiveSafeIntegerSchema,
  turnIndex: PositiveSafeIntegerSchema,
  sourceOrder: Schema.NullOr(PositiveSafeIntegerSchema),
  source: HistoricalTurnContextSourceSchema,
});

const TurnContextsRevision1Schema = Schema.Struct({
  collection: HistoricalSourceReceiptCollectionSchema,
  segments: Schema.Array(HistoricalTurnContextReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

type TurnContextsRevision1 = typeof TurnContextsRevision1Schema.Type;

function currentLimitation(limitation: HistoricalSourceReceiptLimitation) {
  if (limitation.target === "payload-byte") {
    return Object.freeze({ ...limitation, target: "value-byte" as const });
  }
  if (limitation.target === "blob-byte") {
    return Object.freeze({ ...limitation, target: "content-byte" as const });
  }
  return limitation;
}

function currentCollection(collection: TurnContextsRevision1["collection"]) {
  if (collection.state === "complete") return collection;
  return Object.freeze({
    ...collection,
    limitations: Object.freeze(
      collection.limitations
        .map(currentLimitation)
        .sort((left, right) => {
          const leftKey = limitationKey(left);
          const rightKey = limitationKey(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }),
    ),
  });
}

function invalid(path: readonly string[] = []): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function validateRevision1(value: TurnContextsRevision1): RecordAttachmentIssue | undefined {
  if (!hasCanonicalSourceSegments(value.segments)) return invalid(["segments"]);
  const turnIds = new Set<string>();
  const sourceOrders = new Set<number>();
  let priorSessionIndex = 0;
  let priorTurnIndex = 0;
  for (const [index, segment] of value.segments.entries()) {
    if (turnIds.has(segment.turnId)) {
      return invalid(["segments", String(index), "turnId"]);
    }
    turnIds.add(segment.turnId);
    if (
      segment.sessionIndex < priorSessionIndex ||
      segment.sessionIndex === priorSessionIndex && segment.turnIndex <= priorTurnIndex
    ) {
      return invalid(["segments", String(index), "sessionIndex"]);
    }
    priorSessionIndex = segment.sessionIndex;
    priorTurnIndex = segment.turnIndex;
    if (segment.source.state === "mapped") {
      if (segment.sourceOrder === null) {
        return invalid(["segments", String(index), "sourceOrder"]);
      }
      const { start, end } = segment.source;
      if (start.line > end.line || start.line === end.line && start.column > end.column) {
        return invalid(["segments", String(index), "source"]);
      }
    }
    if (segment.sourceOrder !== null) {
      if (sourceOrders.has(segment.sourceOrder)) {
        return invalid(["segments", String(index), "sourceOrder"]);
      }
      sourceOrders.add(segment.sourceOrder);
    }
  }
  for (const [index, limitation] of currentCollection(value.collection).limitations.entries()) {
    if (
      (limitation.code === "capture-failed" || limitation.code === "capture-interrupted") &&
      limitation.stage !== "session-manager" &&
      limitation.stage !== "attempt-finalizer" ||
      !["turn-context", "value-byte"].includes(limitation.target)
    ) {
      return invalid(["collection", "limitations", String(index)]);
    }
  }
  return undefined;
}

function parseTurnContextsRevision1(
  document: RecordMigrationDocument,
): Result.Result<TurnContextsRevision1, RecordAttachmentIssue> {
  if (document.contents.length !== 0) return Result.fail(invalid());
  const decoded = Schema.decodeUnknownResult(
    TurnContextsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Result.isFailure(decoded)) return Result.fail(invalid());
  const issue = validateRevision1(decoded.success);
  return issue === undefined ? Result.succeed(decoded.success) : Result.fail(issue);
}

export const turnContextsV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseTurnContextsRevision1,
  migrate: ({ value, build }) => {
    const references: ReturnType<typeof build.reference.to>[] = [];
    const segments = value.segments.map((segment) => {
      if (segment.source.state === "unmapped") return segment;
      const source = build.reference.to(sourcesRecordAttachment, segment.source);
      references.push(source);
      return Object.freeze({ ...segment, source });
    });
    return Effect.succeed(Object.freeze({
      value: Object.freeze({
        collection: currentCollection(value.collection),
        segments: Object.freeze(segments),
      }),
      references: Object.freeze(references),
      impact: Object.freeze([]),
    }));
  },
});
