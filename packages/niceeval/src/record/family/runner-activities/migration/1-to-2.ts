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
  AttemptRunnerActivitiesAttachmentSchema,
  AttemptRunnerActivityReceiptSchema,
  RunRunnerActivitiesAttachmentSchema,
  RunRunnerActivityReceiptSchema,
  validateAttemptRunnerActivitiesAttachment,
  validateRunRunnerActivitiesAttachment,
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

const AttemptRunnerActivitiesRevision1Schema = Schema.Struct({
  collection: Schema.propertySignature(HistoricalSourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(
    Schema.Array(AttemptRunnerActivityReceiptSchema),
  ).pipe(Schema.fromKey("segments-data")),
});

const RunRunnerActivitiesRevision1Schema = Schema.Struct({
  collection: Schema.propertySignature(HistoricalSourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(RunRunnerActivityReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

type AttemptRunnerActivitiesRevision1 =
  typeof AttemptRunnerActivitiesRevision1Schema.Type;
type RunRunnerActivitiesRevision1 = typeof RunRunnerActivitiesRevision1Schema.Type;
type RunnerActivitiesRevision1 =
  | { readonly owner: "attempt"; readonly value: AttemptRunnerActivitiesRevision1 }
  | { readonly owner: "run"; readonly value: RunRunnerActivitiesRevision1 };

function currentLimitation(limitation: HistoricalSourceReceiptLimitation) {
  if (limitation.target === "payload-byte") {
    return Object.freeze({ ...limitation, target: "value-byte" as const });
  }
  if (limitation.target === "blob-byte") {
    return Object.freeze({ ...limitation, target: "content-byte" as const });
  }
  return limitation;
}

function currentCollection(
  collection: AttemptRunnerActivitiesRevision1["collection"],
) {
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

function currentValue<Segment>(value: {
  readonly collection: AttemptRunnerActivitiesRevision1["collection"];
  readonly segments: readonly Segment[];
}) {
  return Object.freeze({
    collection: currentCollection(value.collection),
    segments: value.segments,
  });
}

function invalid(path: readonly string[] = []): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function parseRunnerActivitiesRevision1(
  document: RecordMigrationDocument,
): Either.Either<RunnerActivitiesRevision1, RecordAttachmentIssue> {
  if (document.contents.length !== 0 || document.references.length !== 0) {
    return Either.left(invalid());
  }
  const attempt = Schema.decodeUnknownEither(
    AttemptRunnerActivitiesRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isRight(attempt)) {
    const current = Schema.validateEither(
      AttemptRunnerActivitiesAttachmentSchema,
      RecordExactParseOptions,
    )(currentValue(attempt.right));
    if (Either.isRight(current)) {
      const [issue] = validateAttemptRunnerActivitiesAttachment(current.right);
      if (issue === undefined) {
        return Either.right(Object.freeze({ owner: "attempt" as const, value: attempt.right }));
      }
    }
  }

  const run = Schema.decodeUnknownEither(
    RunRunnerActivitiesRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(run)) return Either.left(invalid());
  const current = Schema.validateEither(
    RunRunnerActivitiesAttachmentSchema,
    RecordExactParseOptions,
  )(currentValue(run.right));
  if (Either.isLeft(current)) return Either.left(invalid());
  const [issue] = validateRunRunnerActivitiesAttachment(current.right);
  return issue === undefined
    ? Either.right(Object.freeze({ owner: "run" as const, value: run.right }))
    : Either.left(issue);
}

export const runnerActivitiesV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseRunnerActivitiesRevision1,
  migrate: ({ value: previous }) => {
    const value = previous.owner === "attempt"
      ? currentValue(previous.value)
      : currentValue(previous.value);
    return Effect.succeed(Object.freeze({
      value,
      references: Object.freeze([]),
      impact: Object.freeze([]),
    }));
  },
});
