import { Either, Schema } from "effect";
import { RecordExactParseOptions } from "../codec/core.ts";
import type { RecordAttachmentMaintenanceFacet } from "../definition/attachment.ts";
import {
  AttemptObservabilityAttachmentSchema,
  RunObservabilityAttachmentSchema,
} from "./observability.ts";

const ObservabilityV1PayloadSchema = Schema.Union(
  AttemptObservabilityAttachmentSchema,
  RunObservabilityAttachmentSchema,
);

/**
 * v1 differs only in that every timing label was a SafeIdentifier. The v2
 * decoder accepts that complete subset; reject the one v2-only slash form so
 * maintenance still proves the original bytes against the historical shape.
 */
function decodeObservabilityV1(value: unknown): unknown {
  const decoded = Schema.decodeUnknownEither(
    ObservabilityV1PayloadSchema,
    RecordExactParseOptions,
  )(value);
  if (Either.isLeft(decoded)) throw new Error("Observability v1 payload is invalid");
  if (
    decoded.right.timing.intervals.some(
      (interval) => interval.phase === "agent.send" && interval.label.includes("/"),
    )
  ) {
    throw new Error("Observability v1 agent.send labels cannot contain a slash");
  }
  // Historical validation must not normalize, clone, or project the durable
  // object. The only v1 -> v2 write is the envelope version; returning the
  // original value lets the adjacent step prove that invariant explicitly.
  return value;
}

/** v1 -> v2 preserves the hydrated payload and its blob references verbatim. */
function migrateObservabilityV1(value: unknown): unknown {
  return value;
}

/** Loaded only through the fixed-family maintenance facet. */
export const observabilityV1Maintenance: RecordAttachmentMaintenanceFacet = Object.freeze({
  historicalCodecs: Object.freeze([
    Object.freeze({ schemaVersion: 1, decode: decodeObservabilityV1 }),
  ]),
  adjacentMigrations: Object.freeze([
    Object.freeze({
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      migrate: migrateObservabilityV1,
    }),
  ]),
});
