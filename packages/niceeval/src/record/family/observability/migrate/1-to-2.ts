import { Either, Schema } from "effect";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import type { RecordAttachmentMaintenanceFacet } from "../../../definition/attachment.ts";
import {
  AttemptObservabilityAttachmentV1Schema,
  RunObservabilityAttachmentSchema,
} from "../definition.ts";

const ObservabilityV1PayloadSchema = Schema.Union(
  AttemptObservabilityAttachmentV1Schema,
  RunObservabilityAttachmentSchema,
);

/** v1 differs only in that every timing label was a SafeIdentifier. */
function decodeObservabilityV1(value: unknown): unknown {
  const decoded = Schema.decodeUnknownEither(
    ObservabilityV1PayloadSchema,
    RecordExactParseOptions,
  )(value);
  if (Either.isLeft(decoded)) throw new Error("Observability v1 payload is invalid");
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
      retention: Object.freeze({
        retainedFacts: Object.freeze(["payload", "blobs"]),
        droppedFacts: Object.freeze([]),
        rerunRecommendation: null,
      }),
      migrate: migrateObservabilityV1,
    }),
  ]),
});
