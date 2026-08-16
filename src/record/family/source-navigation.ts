import { Either, Schema } from "effect";

import {
  makeFixedRecordAttachmentWrite,
  validateRecordAttachmentWrite,
  type FixedAttachmentWriteSpec,
  type RecordAttachmentWrite,
} from "../attachment/index.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../attachment/errors.ts";
import { RecordExactParseOptions } from "../codec/core.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../codec/identifiers.ts";
import { defineRecordAttachment } from "../definition/index.ts";
import {
  IntervalIdSchema,
  TurnIdSchema,
} from "../../o11y/record/codec.ts";
import type { AttemptObservabilityAttachment } from "./observability.ts";
import type { SourcesAttachment } from "./sources.ts";
import {
  EmptyArraySchema,
  FixedAttachmentValueLimits,
  PositiveSafeIntegerSchema,
} from "./common.ts";

/** One Attempt can retain at most this many physical send navigation rows. */
export const SourceNavigationLimits = Object.freeze({ maximumRows: 256 });

const SourceNavigationPositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

export const SourceNavigationSourceFrameSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("mapped"),
    sourceItemId: SourceItemIdSchema,
    sha256: Sha256DigestSchema,
    start: SourceNavigationPositionSchema,
    end: SourceNavigationPositionSchema,
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

export type SourceNavigationSourceFrame = Schema.Schema.Type<
  typeof SourceNavigationSourceFrameSchema
>;

export const SourceNavigationTimingSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("linked"), intervalId: IntervalIdSchema }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literal("timing-not-recorded"),
  }),
);

export type SourceNavigationTiming = Schema.Schema.Type<typeof SourceNavigationTimingSchema>;

/** Exactly one row for each retained physical ConversationTurn. */
export const SourceNavigationRowSchema = Schema.Struct({
  turnId: TurnIdSchema,
  sourceOrder: Schema.NullOr(PositiveSafeIntegerSchema),
  source: SourceNavigationSourceFrameSchema,
  timing: SourceNavigationTimingSchema,
});

export type SourceNavigationRow = Schema.Schema.Type<typeof SourceNavigationRowSchema>;

export const SourceNavigationCollectionLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached"),
    target: Schema.Literal("navigation-row"),
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("capture-unrecoverable"),
    target: Schema.Literal("timing-link"),
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
);

export type SourceNavigationCollectionLimitation = Schema.Schema.Type<
  typeof SourceNavigationCollectionLimitationSchema
>;

function sourceNavigationLimitationKey(value: SourceNavigationCollectionLimitation): string {
  return `${value.code}\u0000${value.target}\u0000${value.omittedAtLeast}`;
}

function hasCanonicalLimitations(values: readonly SourceNavigationCollectionLimitation[]): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const key = sourceNavigationLimitationKey(value);
    if (seen.has(key) || (previous !== undefined && previous >= key)) return false;
    seen.add(key);
    previous = key;
  }
  return true;
}

export const SourceNavigationCollectionSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(SourceNavigationCollectionLimitationSchema).pipe(
      Schema.filter(hasCanonicalLimitations, {
        identifier: "SourceNavigationPartialLimitations",
        description: "a deterministic deduplicated source navigation limitation sequence",
      }),
    ),
  }),
);

export type SourceNavigationCollection = Schema.Schema.Type<typeof SourceNavigationCollectionSchema>;

function sourceFrameIsOrdered(frame: SourceNavigationSourceFrame): boolean {
  return frame.state !== "mapped" || frame.start.line < frame.end.line ||
    (frame.start.line === frame.end.line && frame.start.column <= frame.end.column);
}

function hasCanonicalRows(payload: {
  readonly collection: SourceNavigationCollection;
  readonly rows: readonly SourceNavigationRow[];
}): boolean {
  if (
    payload.rows.length > SourceNavigationLimits.maximumRows
  ) return false;
  const turnIds = new Set<string>();
  const sourceOrders = new Set<number>();
  const timingIntervals = new Set<string>();
  for (const row of payload.rows) {
    if (turnIds.has(row.turnId)) return false;
    turnIds.add(row.turnId);
    if (!sourceFrameIsOrdered(row.source)) return false;
    if (row.source.state === "mapped" && row.sourceOrder === null) return false;
    if (row.sourceOrder !== null) {
      if (sourceOrders.has(row.sourceOrder)) return false;
      sourceOrders.add(row.sourceOrder);
    }
    if (row.timing.state === "linked") {
      if (timingIntervals.has(row.timing.intervalId)) return false;
      timingIntervals.add(row.timing.intervalId);
    }
  }
  return true;
}

/**
 * Package-private, Attempt-owned navigation facts.  This family has no blob
 * closure: a mapped frame is only an exact semantic join to origin Sources.
 */
export const SourceNavigationAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceNavigationCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  rows: Schema.propertySignature(Schema.Array(SourceNavigationRowSchema)).pipe(
    Schema.fromKey("rows-data"),
  ),
}).pipe(
  Schema.filter(hasCanonicalRows, {
    identifier: "SourceNavigationAttachment",
    description: "a bounded canonical physical-send navigation collection",
  }),
);

export type SourceNavigationAttachment = Schema.Schema.Type<
  typeof SourceNavigationAttachmentSchema
>;

const SourceNavigationBlobBudget = Object.freeze({
  // The shared declaration validator requires a positive bounded policy.
  // This family remains no-blob: refs() is permanently empty and its writer
  // always emits an empty blob list, so none of these capacity units is usable.
  maximumBlobs: 1,
  maximumBlobBytes: 1,
  maximumTotalBytes: 1,
});

/** The sole current declaration for Attempt-owned source navigation. */
export const sourceNavigationRecordAttachment = defineRecordAttachment({
  family: "niceeval.source-navigation",
  current: {
    schemaVersion: 1,
    owners: {
      attempt: {
        schema: SourceNavigationAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: () => Object.freeze([]),
          budget: SourceNavigationBlobBudget,
          verify: () => Object.freeze([]),
        },
      },
    },
  },
});

/** Builds the no-blob fixed writer and rejects a non-exact v1 candidate. */
export function createSourceNavigationAttachmentWrite(
  input: unknown,
  writeSpec: FixedAttachmentWriteSpec<"attempt", SourceNavigationAttachment>,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  { readonly code: "source-navigation-attachment-input-invalid" }
> {
  const decoded = Schema.validateEither(
    SourceNavigationAttachmentSchema,
    RecordExactParseOptions,
  )(input);
  if (Either.isLeft(decoded)) {
    return Either.left(Object.freeze({ code: "source-navigation-attachment-input-invalid" as const }));
  }
  const write = makeFixedRecordAttachmentWrite(
    writeSpec,
    () => Object.freeze({ payload: decoded.right, blobs: Object.freeze([]) }),
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("Fixed source navigation write closure was invalid");
  }
  return Either.right(write);
}

/**
 * Host-only semantic join. It compares explicit identities only: no source
 * bytes are scanned and no relationship is inferred from array position.
 */
export function sourceNavigationIntegrityIssues(input: {
  readonly payload: SourceNavigationAttachment;
  readonly observability: AttemptObservabilityAttachment;
  readonly sources: SourcesAttachment | undefined;
}): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  const rowsByTurn = new Map<string, SourceNavigationRow>(
    input.payload.rows.map((row) => [row.turnId, row] as const),
  );
  const turns = [...input.observability.conversation.turns].sort((left, right) => left.sequence - right.sequence);
  const turnsById = new Map<string, AttemptObservabilityAttachment["conversation"]["turns"][number]>(
    turns.map((turn) => [turn.turnId, turn] as const),
  );
  if (rowsByTurn.size !== input.payload.rows.length || turnsById.size !== input.observability.conversation.turns.length) {
    issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["rows"]));
  }
  for (const [turnId] of turnsById) {
    if (!rowsByTurn.has(turnId)) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["rows", turnId]));
    }
  }
  for (const [turnId] of rowsByTurn) {
    if (!turnsById.has(turnId)) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["rows", turnId]));
    }
  }
  for (const [index, turn] of turns.entries()) {
    if (input.payload.rows[index]?.turnId !== turn.turnId) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["rows", String(index), "turnId"]));
    }
  }

  const navigationCap = input.payload.collection.limitations.find((limitation) =>
    limitation.code === "collection-cap-reached" && limitation.target === "navigation-row"
  );
  const conversationCap = input.observability.conversation.collection.limitations.find((limitation) =>
    limitation.code === "collection-cap-reached" && limitation.target === "conversation"
  );
  if (
    navigationCap !== undefined &&
    (conversationCap === undefined ||
      !("omittedAtLeast" in conversationCap) ||
      conversationCap.omittedAtLeast !== navigationCap.omittedAtLeast)
  ) {
    issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["collection"]));
  }
  if (
    input.payload.collection.state === "partial" &&
    input.observability.conversation.collection.state !== "partial"
  ) {
    issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["collection"]));
  }

  const intervals = new Map(input.observability.timing.intervals.map((interval) => [interval.intervalId, interval] as const));
  const sources = input.sources === undefined
    ? undefined
    : new Map(input.sources.items.map((item) => [item.sourceItemId, item] as const));
  for (const [index, row] of input.payload.rows.entries()) {
    if (row.timing.state === "linked") {
      const interval = intervals.get(row.timing.intervalId);
      if (interval === undefined || interval.phase !== "agent.send") {
        issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["rows", String(index), "timing"]));
      }
    }
    if (row.source.state === "mapped") {
      const source = sources?.get(row.source.sourceItemId);
      if (source === undefined || source.sha256 !== row.source.sha256 || !sourceFrameIsOrdered(row.source)) {
        issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["rows", String(index), "source"]));
      }
    }
  }
  return Object.freeze(issues);
}
