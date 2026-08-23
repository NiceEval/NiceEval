import { createHash } from "node:crypto";
import { Either, ParseResult, Schema } from "effect";
import type { RecordBlobRef } from "../../../attachment/blob-ref.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import type { RecordAttachmentMaintenanceFacet } from "../../../definition/attachment.ts";
import { AssertionsAttachmentSchema, AssertionsAttachmentV1Schema } from "../definition.ts";

function parseAssertionsV1(value: unknown): Schema.Schema.Type<typeof AssertionsAttachmentV1Schema> {
  const decoded = Schema.decodeUnknownEither(AssertionsAttachmentV1Schema, RecordExactParseOptions)(value);
  if (Either.isLeft(decoded)) throw new Error("Assertions v1 payload is invalid");
  return decoded.right;
}

function decodeAssertionsV1(value: unknown): unknown {
  parseAssertionsV1(value);
  return value;
}

/** Pure adjacent payload transform. Record maintenance exclusively owns physical I/O. */
function migrateAssertionsV1(value: unknown): unknown {
  const previous = parseAssertionsV1(value);
  const migrated = Object.freeze({
    "entries-data": Object.freeze(previous.entries.map((entry) => Object.freeze({
      entryId: entry.entryId,
      display: entry.display,
      criterion: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
      materials: Object.freeze({
        source: Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
        evidence: Object.freeze([]),
        coverage: Object.freeze({ state: "unavailable" as const, reason: "not-collected" as const }),
        limitations: Object.freeze([]),
      }),
      evaluation: Object.freeze({
        observed: Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
      }),
      decision: Object.freeze({
        result: entry.result.state,
        reason: "reason" in entry.result ? entry.result.reason : null,
        gate: entry.result.gate,
      }),
      policy: Object.freeze({
        requirement: entry.result.gate === "not-gate"
          ? Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const })
          : Object.freeze({ state: "available" as const, value: "required" as const }),
        condition: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
      }),
      contribution: entry.result.score,
      explanationRetention: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
    }))),
    "source-sites-data": previous.sourceSites,
  });
  const decoded = Schema.decodeUnknownEither(AssertionsAttachmentSchema, RecordExactParseOptions)(migrated);
  if (Either.isLeft(decoded)) {
    throw new Error(`Assertions v1 migration did not produce a current payload: ${ParseResult.TreeFormatter.formatErrorSync(decoded.left)}`);
  }
  return migrated;
}

export const assertionsV1Maintenance: RecordAttachmentMaintenanceFacet = Object.freeze({
  historicalCodecs: Object.freeze([
    Object.freeze({
      schemaVersion: 1,
      decode: decodeAssertionsV1,
      verify: (payload: unknown, blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[]) => {
        const previous = parseAssertionsV1(payload);
        const byRef = new Map(blobs.map((blob) => [blob.ref, blob.bytes] as const));
        const materials = previous.entries.flatMap((entry) => [entry.subject, ...entry.evidence]);
        return materials.every((material) => {
          if (material.kind !== "blob") return true;
          const bytes = byRef.get(material.ref);
          return bytes !== undefined &&
            bytes.byteLength === material.byteLength &&
            createHash("sha256").update(bytes).digest("hex") === material.sha256;
        });
      },
    }),
  ]),
  adjacentMigrations: Object.freeze([
    Object.freeze({
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      retention: Object.freeze({
        retainedFacts: Object.freeze([
          "display",
          "decision",
          "provable-policy",
          "contribution",
          "source-sites",
        ]),
        droppedFacts: Object.freeze([
          "criterion",
          "subject",
          "evidence",
          "coverage",
          "limitations",
          "result.diagnostic",
          "result.receipt",
        ]),
        rerunRecommendation: "Rerun the affected evaluation to collect current assertion facts.",
      }),
      migrate: migrateAssertionsV1,
    }),
  ]),
});
