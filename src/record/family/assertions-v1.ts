import { Either, ParseResult, Schema } from "effect";
import type { AssertionFactValue, BoundedJsonValue } from "../../assertions/record/model.ts";
import { RecordExactParseOptions } from "../codec/core.ts";
import type { RecordAttachmentMaintenanceFacet } from "../definition/attachment.ts";
import { AssertionsAttachmentSchema, AssertionsAttachmentV1Schema } from "./assertions.ts";

function fact(value: BoundedJsonValue): AssertionFactValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return Object.freeze({ kind: "value", value });
  }
  if (Array.isArray(value)) {
    return Object.freeze({ kind: "list", items: Object.freeze(value.map(fact)) });
  }
  return Object.freeze({
    kind: "fields",
    fields: Object.freeze(Object.entries(value).map(([label, child]) => Object.freeze({
      label,
      value: fact(child),
    }))),
  });
}

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
        source: entry.subject,
        evidence: entry.evidence,
        coverage: entry.coverage,
        limitations: entry.limitations,
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
      explanationRetention: entry.result.diagnostic === undefined
        ? Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const })
        : Object.freeze({ state: "retained" as const, value: fact(entry.result.diagnostic) }),
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
    Object.freeze({ schemaVersion: 1, decode: decodeAssertionsV1 }),
  ]),
  adjacentMigrations: Object.freeze([
    Object.freeze({ fromSchemaVersion: 1, toSchemaVersion: 2, migrate: migrateAssertionsV1 }),
  ]),
});
