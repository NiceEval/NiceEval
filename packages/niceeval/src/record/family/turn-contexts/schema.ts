import { Either, Schema } from "effect";

import {
  makeFixedRecordAttachmentWrite,
  validateRecordAttachmentWrite,
  type FixedAttachmentWriteSpec,
  type RecordAttachmentWrite,
} from "../../attachment/index.ts";
import { RecordExactParseOptions } from "../../codec/core.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
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

export const TurnContextSourceSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("mapped"),
    sourceItemId: SourceItemIdSchema,
    sha256: Sha256DigestSchema,
    start: PositionSchema,
    end: PositionSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("unmapped"),
    reason: Schema.Literal(
      "location-not-captured",
      "source-snapshot-not-recorded",
      "position-unrepresentable",
    ),
  }),
);

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
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(TurnContextReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
}).pipe(
  Schema.filter((value) => {
    if (!hasCanonicalSourceSegments(value.segments)) return false;
    const turnIds = new Set<string>();
    const sourceOrders = new Set<number>();
    let priorSessionIndex = 0;
    let priorTurnIndex = 0;
    for (const segment of value.segments) {
      if (turnIds.has(segment.turnId)) return false;
      turnIds.add(segment.turnId);
      if (
        segment.sessionIndex < priorSessionIndex ||
        segment.sessionIndex === priorSessionIndex && segment.turnIndex <= priorTurnIndex
      ) return false;
      priorSessionIndex = segment.sessionIndex;
      priorTurnIndex = segment.turnIndex;
      if (segment.source.state === "mapped" && segment.sourceOrder === null) return false;
      if (segment.source.state === "mapped") {
        const { start, end } = segment.source;
        if (start.line > end.line || start.line === end.line && start.column > end.column) return false;
      }
      if (segment.sourceOrder !== null) {
        if (sourceOrders.has(segment.sourceOrder)) return false;
        sourceOrders.add(segment.sourceOrder);
      }
    }
    return value.collection.limitations.every((limitation) =>
      (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
        limitation.stage === "session-manager" || limitation.stage === "attempt-finalizer") &&
      ["turn-context", "payload-byte"].includes(limitation.target)
    );
  }, {
    identifier: "TurnContextsAttachment",
    description: "canonical physical-send contexts owned by SessionManager",
  }),
);

export type TurnContextsAttachment = Schema.Schema.Type<
  typeof TurnContextsAttachmentSchema
>;

export function createTurnContextsAttachmentWrite(
  input: unknown,
  writeSpec: FixedAttachmentWriteSpec<"attempt", TurnContextsAttachment>,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  { readonly code: "turn-contexts-attachment-input-invalid" }
> {
  const decoded = Schema.validateEither(
    TurnContextsAttachmentSchema,
    RecordExactParseOptions,
  )(input);
  if (Either.isLeft(decoded)) {
    return Either.left(Object.freeze({
      code: "turn-contexts-attachment-input-invalid" as const,
    }));
  }
  const write = makeFixedRecordAttachmentWrite(
    writeSpec,
    () => Object.freeze({ payload: decoded.right, blobs: Object.freeze([]) }),
  );
  if (Either.isLeft(validateRecordAttachmentWrite(write))) {
    throw new Error("Fixed Turn Context write closure was invalid");
  }
  return Either.right(write);
}
