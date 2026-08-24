import { Either, ParseResult, Schema } from "effect";
import type { RecordBlobRef } from "../../../attachment/blob-ref.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import type { RecordAttachmentMaintenanceFacet } from "../../../definition/attachment.ts";
import {
  AgentTurnsAttachmentSchema,
  AgentTurnsAttachmentV1Schema,
} from "../definition.ts";

function parseV1(value: unknown): Schema.Schema.Type<typeof AgentTurnsAttachmentV1Schema> {
  const decoded = Schema.decodeUnknownEither(AgentTurnsAttachmentV1Schema, RecordExactParseOptions)(value);
  if (Either.isLeft(decoded)) throw new Error("Agent Turns v1 payload is invalid");
  return decoded.right;
}

function decodeV1(value: unknown): unknown {
  parseV1(value);
  return value;
}

/** Pure wrapping migration: no current identity, cut, or cross-Turn relation is invented. */
function migrateV1(value: unknown): unknown {
  const previous = parseV1(value);
  const migrated = Object.freeze({
    state: "legacy" as const,
    "collection-data": previous.collection,
    "segments-data": previous.segments,
  });
  const decoded = Schema.decodeUnknownEither(AgentTurnsAttachmentSchema, RecordExactParseOptions)(migrated);
  if (Either.isLeft(decoded)) {
    throw new Error(`Agent Turns v1 migration did not produce v2 legacy material: ${ParseResult.TreeFormatter.formatErrorSync(decoded.left)}`);
  }
  return migrated;
}

export const agentTurnsV1Maintenance: RecordAttachmentMaintenanceFacet = Object.freeze({
  historicalCodecs: Object.freeze([
    Object.freeze({
      schemaVersion: 1,
      decode: decodeV1,
      verify: (_payload: unknown, blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[]) => blobs.length === 0,
    }),
  ]),
  adjacentMigrations: Object.freeze([
    Object.freeze({
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      retention: Object.freeze({
        retainedFacts: Object.freeze([
          "legacy-terminal-turns",
          "legacy-source-local-call-relations",
          "usage-observations",
          "safe-text",
        ]),
        droppedFacts: Object.freeze([
          "current-event-identity",
          "current-tool-occurrence-identity",
          "session-scope",
          "session-sequence",
          "cross-turn-lifecycle-relation",
          "capture-time-cut",
        ]),
        rerunRecommendation: "Rerun the affected evaluation to collect current observed event identity and cuts.",
      }),
      migrate: migrateV1,
    }),
  ]),
});
