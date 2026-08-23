import { Schema } from "effect";
import type { ProcessReceipt } from "./process.js";
import {
  CanonicalAttemptLocatorSchema,
  decodeShowSchema,
  ShowAttemptEnvelopeFields,
  ShowSourceCollectionSchema,
} from "./show-schema.js";

const NonNegativeSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value >= 0, {
    identifier: "ShowNonNegativeSafeInteger",
    description: "a non-negative safe integer",
  }),
);

const SafeIdentifierSchema = Schema.String.pipe(
  Schema.filter((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value), {
    identifier: "ShowSafeIdentifier",
    description: "a safe timing identifier",
  }),
);

const PORTABLE_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/;
const WINDOWS_RESERVED_SEGMENT_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const PortableSegmentSchema = Schema.String.pipe(
  Schema.filter(
    (value) => PORTABLE_SEGMENT_PATTERN.test(value) && !WINDOWS_RESERVED_SEGMENT_PATTERN.test(value),
    {
      identifier: "ShowPortableSegment",
      description: "a portable non-reserved path segment",
    },
  ),
);

const ShowTimingIntervalSchema = Schema.Struct({
  intervalId: SafeIdentifierSchema,
  phase: Schema.Literal(
    "attempt.setup",
    "sandbox.prepare",
    "agent.ensure",
    "eval.run",
    "agent.send",
    "sandbox.command",
    "assertion.evaluate",
    "verdict.fold",
    "attempt.teardown",
  ),
  label: SafeIdentifierSchema,
  startOffsetMs: NonNegativeSafeIntegerSchema,
  durationMs: NonNegativeSafeIntegerSchema,
  parentIntervalId: Schema.NullOr(SafeIdentifierSchema),
  outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted", "unknown"),
});

export type ShowTimingInterval = Schema.Schema.Type<typeof ShowTimingIntervalSchema>;

export const ShowTimingDetailSchema = Schema.Struct({
  dependencies: Schema.Tuple(Schema.Literal("niceeval.runner-activities")),
  collection: ShowSourceCollectionSchema,
  intervals: Schema.Array(ShowTimingIntervalSchema),
}).pipe(
  Schema.filter(
    (detail) => hasCanonicalTimingIntervals(detail.collection.state, detail.intervals),
    {
      identifier: "CanonicalShowTimingDetail",
      description: "canonical, bounded and acyclic timing intervals",
    },
  ),
);

export type ShowTimingDetail = Schema.Schema.Type<typeof ShowTimingDetailSchema>;

const ShowTimingAttemptSchema = Schema.Struct({
  kind: Schema.Literal("attempt"),
  locator: CanonicalAttemptLocatorSchema,
  originRunId: PortableSegmentSchema,
});

export type ShowTimingAttempt = Schema.Schema.Type<typeof ShowTimingAttemptSchema>;

const ShowTimingEntrySchema = Schema.Union(
  Schema.Struct({
    attempt: ShowTimingAttemptSchema,
    state: Schema.Literal("available"),
    timing: ShowTimingDetailSchema,
  }),
  Schema.Struct({
    attempt: ShowTimingAttemptSchema,
    state: Schema.Literal("not-recorded", "unsupported", "invalid"),
    view: Schema.Literal("attempt-observability"),
  }),
  Schema.Struct({
    attempt: ShowTimingAttemptSchema,
    state: Schema.Literal("failed"),
    view: Schema.Literal("attempt-observability"),
    detail: Schema.String,
  }),
);

export type ShowTimingEntry = Schema.Schema.Type<typeof ShowTimingEntrySchema>;

const ShowTimingDocumentSchema = Schema.Struct({
  ...ShowAttemptEnvelopeFields,
  data: Schema.Struct({
    kind: Schema.Literal("timing"),
    timing: Schema.NonEmptyArray(ShowTimingEntrySchema),
  }),
}).pipe(
  Schema.filter(
    (document) => document.data.timing.every(
      (entry) => entry.attempt.locator === document.selection.locator,
    ),
    {
      identifier: "SelectedShowTimingDocument",
      description: "timing entries belonging to the selected Attempt locator",
    },
  ),
);

export type ShowTimingDocument = Schema.Schema.Type<typeof ShowTimingDocumentSchema>;

/** Decode the public timing facts through the current unversioned show API. */
export function decodeShowTiming(receipt: ProcessReceipt): ShowTimingDocument {
  return decodeShowSchema(ShowTimingDocumentSchema, receipt, "decodeShowTiming()");
}

function hasCanonicalTimingIntervals(
  collectionState: "complete" | "partial" | "not-recorded" | "migration-required" | "unsupported" | "invalid",
  intervals: readonly ShowTimingInterval[],
): boolean {
  let previousId: string | undefined;
  const byId = new Map<string, ShowTimingInterval>();
  for (const interval of intervals) {
    if (previousId !== undefined && previousId >= interval.intervalId) return false;
    if (byId.has(interval.intervalId)) return false;
    if (!Number.isSafeInteger(interval.startOffsetMs + interval.durationMs)) return false;
    previousId = interval.intervalId;
    byId.set(interval.intervalId, interval);
  }
  for (const interval of intervals) {
    if (interval.parentIntervalId === null) continue;
    const parent = byId.get(interval.parentIntervalId);
    if (parent === undefined) return false;
    const intervalEnd = interval.startOffsetMs + interval.durationMs;
    const parentEnd = parent.startOffsetMs + parent.durationMs;
    if (!Number.isSafeInteger(parentEnd) || interval.startOffsetMs < parent.startOffsetMs ||
      intervalEnd > parentEnd) return false;
    const visited = new Set<string>([interval.intervalId]);
    let cursor: ShowTimingInterval | undefined = parent;
    while (cursor !== undefined) {
      if (visited.has(cursor.intervalId)) return false;
      visited.add(cursor.intervalId);
      if (cursor.parentIntervalId === null) break;
      cursor = byId.get(cursor.parentIntervalId);
      if (cursor === undefined) return false;
    }
  }
  return collectionState !== "complete" || intervals.every((interval) => interval.outcome !== "unknown");
}
