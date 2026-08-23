import { Schema } from "effect";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../codec/identifiers.ts";
import {
  IntervalIdSchema,
  TurnIdSchema,
} from "../../o11y/record/codec.ts";
import {
  EmptyArraySchema,
  PositiveSafeIntegerSchema,
} from "../family/common.ts";

/** One Attempt can retain at most this many physical-send relation rows. */
export const SourceNavigationRelationLimits = Object.freeze({ maximumRows: 256 });

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

export const SourceNavigationRelationRowSchema = Schema.Struct({
  turnId: TurnIdSchema,
  sourceOrder: Schema.NullOr(PositiveSafeIntegerSchema),
  source: SourceNavigationSourceFrameSchema,
  timing: SourceNavigationTimingSchema,
});

export type SourceNavigationRelationRow = Schema.Schema.Type<
  typeof SourceNavigationRelationRowSchema
>;

export const SourceNavigationRelationLimitationSchema = Schema.Union(
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

export type SourceNavigationRelationLimitation = Schema.Schema.Type<
  typeof SourceNavigationRelationLimitationSchema
>;

function limitationKey(value: SourceNavigationRelationLimitation): string {
  return `${value.code}\u0000${value.target}\u0000${value.omittedAtLeast}`;
}

function hasCanonicalLimitations(
  values: readonly SourceNavigationRelationLimitation[],
): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const key = limitationKey(value);
    if (seen.has(key) || (previous !== undefined && previous >= key)) return false;
    seen.add(key);
    previous = key;
  }
  return true;
}

export const SourceNavigationRelationCollectionSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(SourceNavigationRelationLimitationSchema).pipe(
      Schema.filter(hasCanonicalLimitations, {
        identifier: "SourceNavigationRelationPartialLimitations",
        description: "a deterministic deduplicated source navigation limitation sequence",
      }),
    ),
  }),
);

export type SourceNavigationRelationCollection = Schema.Schema.Type<
  typeof SourceNavigationRelationCollectionSchema
>;

function sourceFrameIsOrdered(frame: SourceNavigationSourceFrame): boolean {
  return frame.state !== "mapped" || frame.start.line < frame.end.line ||
    (frame.start.line === frame.end.line && frame.start.column <= frame.end.column);
}

function hasCanonicalRows(payload: {
  readonly collection: SourceNavigationRelationCollection;
  readonly rows: readonly SourceNavigationRelationRow[];
}): boolean {
  if (payload.rows.length > SourceNavigationRelationLimits.maximumRows) return false;
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

/** Package-private reader relation; it is never a durable Attachment. */
export const SourceNavigationRelationSchema = Schema.Struct({
  collection: SourceNavigationRelationCollectionSchema,
  rows: Schema.Array(SourceNavigationRelationRowSchema),
}).pipe(
  Schema.filter(hasCanonicalRows, {
    identifier: "SourceNavigationRelation",
    description: "a bounded canonical physical-send reader relation",
  }),
);

export type SourceNavigationRelation = Schema.Schema.Type<
  typeof SourceNavigationRelationSchema
>;
