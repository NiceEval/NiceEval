import { Schema } from "effect";

import {
  EmptyArraySchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
} from "../common.ts";

export const SourceSegmentIdSchema = SafeIdentifierSchema;

export const SourceReceiptStageSchema = Schema.Literals([
  "adapter",
  "session-manager",
  "sandbox-wrapper",
  "runner-clock",
  "runner-diagnostic-sink",
  "attempt-finalizer",
  "run-teardown",
]);

export const SourceRetentionTargetSchema = Schema.Literals([
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
  "value-byte",
  "content-byte",
]);

export const SourceReceiptLimitationSchema = Schema.Union([
  Schema.Struct({
    code: Schema.Literals(["capture-failed", "capture-interrupted"]),
    stage: SourceReceiptStageSchema,
    target: SourceRetentionTargetSchema,
  }),
  Schema.Struct({
    code: Schema.Literals(["collection-cap-reached", "unsupported-input"]),
    target: SourceRetentionTargetSchema,
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literals([
      "text-truncated",
      "redacted",
      "invalid-utf8-replaced",
      "unsafe-control-stripped",
    ]),
    target: SourceRetentionTargetSchema,
    replacementOrOmittedCount: PositiveSafeIntegerSchema,
  }),
]);

export type SourceReceiptLimitation = Schema.Schema.Type<
  typeof SourceReceiptLimitationSchema
>;

function limitationKey(value: SourceReceiptLimitation): string {
  return JSON.stringify(value);
}

function canonicalLimitations(values: readonly SourceReceiptLimitation[]): boolean {
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

export const SourceReceiptCollectionSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(SourceReceiptLimitationSchema).pipe(
      Schema.check(Schema.makeFilter(canonicalLimitations)),
    ),
  }),
]);

export type SourceReceiptCollection = Schema.Schema.Type<
  typeof SourceReceiptCollectionSchema
>;

export interface SourceReceiptSegment {
  readonly segmentId: string;
  readonly sequence: number;
}

export function hasCanonicalSourceSegments(
  segments: readonly SourceReceiptSegment[],
): boolean {
  const ids = new Set<string>();
  for (const [index, segment] of segments.entries()) {
    if (
      ids.has(segment.segmentId) ||
      segment.sequence !== index + 1
    ) return false;
    ids.add(segment.segmentId);
  }
  return true;
}

export const NoBlobSourceReceiptBudget = Object.freeze({
  maximumBlobs: 1,
  maximumBlobBytes: 1,
  maximumTotalBytes: 1,
});
