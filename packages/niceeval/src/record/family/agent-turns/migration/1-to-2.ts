import { Effect, Either, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import { EmptyArraySchema, PositiveSafeIntegerSchema } from "../../common.ts";
import { SourceReceiptStageSchema } from "../../source-receipt/index.ts";
import {
  AgentTurnReceiptSchema,
  AgentTurnsAttachmentSchema,
  validateAgentTurnsAttachment,
} from "../schema.ts";

const HistoricalSourceRetentionTargetSchema = Schema.Literal(
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
);

const HistoricalSourceReceiptLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-failed", "capture-interrupted"),
    stage: SourceReceiptStageSchema,
    target: HistoricalSourceRetentionTargetSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached", "unsupported-input"),
    target: HistoricalSourceRetentionTargetSchema,
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literal(
      "text-truncated",
      "redacted",
      "invalid-utf8-replaced",
      "unsafe-control-stripped",
    ),
    target: HistoricalSourceRetentionTargetSchema,
    replacementOrOmittedCount: PositiveSafeIntegerSchema,
  }),
);

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

const HistoricalSourceReceiptCollectionSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(HistoricalSourceReceiptLimitationSchema).pipe(
      Schema.filter(canonicalLimitations),
    ),
  }),
);

const AgentTurnsRevision1Schema = Schema.Struct({
  collection: Schema.propertySignature(HistoricalSourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(AgentTurnReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

type AgentTurnsRevision1 = typeof AgentTurnsRevision1Schema.Type;

function currentLimitation(limitation: HistoricalSourceReceiptLimitation) {
  if (limitation.target === "payload-byte") {
    return Object.freeze({ ...limitation, target: "value-byte" as const });
  }
  if (limitation.target === "blob-byte") {
    return Object.freeze({ ...limitation, target: "content-byte" as const });
  }
  return limitation;
}

function currentCollection(collection: AgentTurnsRevision1["collection"]) {
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

function currentValue(value: AgentTurnsRevision1) {
  return Object.freeze({
    collection: currentCollection(value.collection),
    segments: value.segments,
  });
}

function invalid(path: readonly string[] = []): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function parseAgentTurnsRevision1(
  document: RecordMigrationDocument,
): Either.Either<AgentTurnsRevision1, RecordAttachmentIssue> {
  if (document.contents.length !== 0 || document.references.length !== 0) {
    return Either.left(invalid());
  }
  const decoded = Schema.decodeUnknownEither(
    AgentTurnsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(decoded)) return Either.left(invalid());
  const current = Schema.validateEither(
    AgentTurnsAttachmentSchema,
    RecordExactParseOptions,
  )(currentValue(decoded.right));
  if (Either.isLeft(current)) return Either.left(invalid());
  const [issue] = validateAgentTurnsAttachment(current.right);
  return issue === undefined ? Either.right(decoded.right) : Either.left(issue);
}

export const agentTurnsV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseAgentTurnsRevision1,
  migrate: ({ value }) => Effect.succeed(Object.freeze({
    value: currentValue(value),
    references: Object.freeze([]),
    impact: Object.freeze([]),
  })),
});
