import { createHash } from "node:crypto";

import { Either, ParseResult, Schema } from "effect";

import type { RecordBlobRef } from "../../../attachment/blob-ref.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import type { RecordAttachmentMaintenanceFacet } from "../../../definition/attachment.ts";
import {
  AssertionsAttachmentSchema,
  AssertionsAttachmentV2Schema,
} from "../definition.ts";

type AssertionsAttachmentV2 = Schema.Schema.Type<typeof AssertionsAttachmentV2Schema>;

function parseAssertionsV2(value: unknown): AssertionsAttachmentV2 {
  const decoded = Schema.decodeUnknownEither(
    AssertionsAttachmentV2Schema,
    RecordExactParseOptions,
  )(value);
  if (Either.isLeft(decoded)) throw new Error("Assertions v2 payload is invalid");
  return decoded.right;
}

function decodeAssertionsV2(value: unknown): unknown {
  parseAssertionsV2(value);
  return value;
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isJsonRecord(value) ? value : undefined;
}

function isHistoricalMatcher(
  entry: AssertionsAttachmentV2["entries"][number],
): boolean {
  if (entry.criterion.state === "available") {
    const criterion = jsonRecord(entry.criterion.value);
    const data = jsonRecord(criterion?.data);
    if (
      criterion?.kind === "builtin" &&
      criterion.id === "occurrence/v1" &&
      (data?.occurrence === "tool" || data?.occurrence === "event")
    ) {
      return true;
    }
  }
  if (entry.materials.source.kind !== "snapshot") return false;
  const source = jsonRecord(entry.materials.source.value);
  return source?.assertion === "tool-order" || source?.assertion === "event-order";
}

/** Pure adjacent payload transform. Record maintenance exclusively owns physical I/O. */
function migrateAssertionsV2(value: unknown): unknown {
  const previous = parseAssertionsV2(value);
  const migrated = Object.freeze({
    "entries-data": Object.freeze(previous.entries.map((entry) => {
      if (!isHistoricalMatcher(entry)) {
        return Object.freeze({
          ...entry,
          evaluation: Object.freeze({
            kind: "ordinary" as const,
            observed: entry.evaluation.observed,
            ...(entry.evaluation.receipt === undefined
              ? {}
              : { receipt: entry.evaluation.receipt }),
          }),
        });
      }
      return Object.freeze({
        ...entry,
        evaluation: Object.freeze({
          kind: "matcher-legacy" as const,
          observed: entry.evaluation.observed,
          reason: "historical-not-recorded" as const,
          ...(entry.explanationRetention.state === "retained"
            ? { legacyDiagnostic: entry.explanationRetention.value }
            : {}),
        }),
        explanationRetention: Object.freeze({
          state: "unavailable" as const,
          reason: "not-recorded" as const,
        }),
      });
    })),
    "source-sites-data": previous.sourceSites,
  });
  const decoded = Schema.decodeUnknownEither(
    AssertionsAttachmentSchema,
    RecordExactParseOptions,
  )(migrated);
  if (Either.isLeft(decoded)) {
    throw new Error(
      `Assertions v2 migration did not produce a current payload: ${
        ParseResult.TreeFormatter.formatErrorSync(decoded.left)
      }`,
    );
  }
  return migrated;
}

function verifyAssertionsV2Blobs(
  payload: unknown,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): boolean {
  const previous = parseAssertionsV2(payload);
  const byRef = new Map(blobs.map((blob) => [blob.ref, blob.bytes] as const));
  const materials = previous.entries.flatMap((entry) => [
    entry.materials.source,
    ...entry.materials.evidence,
  ]);
  return materials.every((material) => {
    if (material.kind !== "blob") return true;
    const bytes = byRef.get(material.ref);
    return bytes !== undefined &&
      bytes.byteLength === material.byteLength &&
      createHash("sha256").update(bytes).digest("hex") === material.sha256;
  });
}

export const assertionsV2Maintenance: RecordAttachmentMaintenanceFacet = Object.freeze({
  historicalCodecs: Object.freeze([
    Object.freeze({
      schemaVersion: 2,
      decode: decodeAssertionsV2,
      verify: verifyAssertionsV2Blobs,
    }),
  ]),
  adjacentMigrations: Object.freeze([
    Object.freeze({
      fromSchemaVersion: 2,
      toSchemaVersion: 3,
      retention: Object.freeze({
        retainedFacts: Object.freeze([
          "display",
          "criterion",
          "materials",
          "observed",
          "decision",
          "policy",
          "contribution",
          "ordinary-explanation",
          "legacy-matcher-diagnostic",
          "source-sites",
        ]),
        droppedFacts: Object.freeze([
          "matcher-receipt-without-source-identity",
          "matcher-current-artifact",
        ]),
        rerunRecommendation: "Rerun matcher assertions to collect current source identity and query artifacts.",
      }),
      migrate: migrateAssertionsV2,
    }),
  ]),
});
