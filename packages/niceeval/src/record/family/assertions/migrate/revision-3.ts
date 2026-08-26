import { Either, Schema } from "effect";

import {
  AssertionEntryIdSchema,
  MAX_ASSERTION_DOCUMENT_BYTES,
  createAssertionsRecordSchemas,
} from "../../../../assertions/record/codec.ts";
import { isRecordMigrationContent } from "../../../attachment/protocol.ts";
import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationContent,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import { AssertionSourceSiteSchema } from "../reference.ts";

const Revision3ContentSchema: Schema.Schema<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const Revision3MaterialSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literal("not-recorded"),
  }),
  Schema.Struct({
    kind: Schema.Literal("content"),
    content: Revision3ContentSchema,
    encoding: Schema.Literal("json", "utf-8", "binary"),
    byteLength: Schema.JsonNumber.pipe(
      Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
    ),
    preview: Schema.NullOr(Schema.String.pipe(
      Schema.filter((value) => new TextEncoder().encode(value).byteLength <= 8 * 1024),
    )),
  }),
);

const revision3Entries = createAssertionsRecordSchemas(
  Revision3MaterialSchema,
).historicalV2Entries;

export const AssertionsRevision3Schema = Schema.Struct({
  entries: Schema.propertySignature(revision3Entries).pipe(
    Schema.fromKey("entries-data"),
  ),
  sourceSites: Schema.propertySignature(Schema.Array(AssertionSourceSiteSchema)).pipe(
    Schema.fromKey("source-sites-data"),
  ),
});

export type AssertionsRevision3 = typeof AssertionsRevision3Schema.Type;
export type AssertionsRevision3Material = typeof Revision3MaterialSchema.Type;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function withinDocumentLimit(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined &&
      new TextEncoder().encode(encoded).byteLength <= MAX_ASSERTION_DOCUMENT_BYTES;
  } catch {
    return false;
  }
}

export function parseAssertionsRevision3(
  document: RecordMigrationDocument,
): Either.Either<AssertionsRevision3, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownEither(
    AssertionsRevision3Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(decoded) || !withinDocumentLimit(document.value)) {
    return Either.left(invalid([]));
  }

  const entryIds = new Set<string>();
  for (const [entryIndex, entry] of decoded.right.entries.entries()) {
    if (entryIds.has(entry.entryId)) {
      return Either.left(invalid(["entries", String(entryIndex), "entryId"]));
    }
    entryIds.add(entry.entryId);
    const materials = [entry.materials.source, ...entry.materials.evidence];
    for (const [materialIndex, material] of materials.entries()) {
      if (material.kind !== "content") continue;
      const bytes = document.content.bytes(material.content);
      if (Either.isLeft(bytes) || bytes.right.byteLength !== material.byteLength) {
        return Either.left(invalid([
          "entries",
          String(entryIndex),
          "materials",
          materialIndex === 0 ? "source" : "evidence",
        ]));
      }
    }
  }

  const sourceOrders = new Set<number>();
  let previous: string | undefined;
  for (const [index, site] of decoded.right.sourceSites.entries()) {
    const key = `${site.entryId}\u0000${site.sourceOrder.toString().padStart(16, "0")}`;
    if (
      !entryIds.has(site.entryId) ||
      sourceOrders.has(site.sourceOrder) ||
      site.start.line > site.end.line ||
      site.start.line === site.end.line && site.start.column > site.end.column ||
      previous !== undefined && previous >= key
    ) {
      return Either.left(invalid(["sourceSites", String(index)]));
    }
    sourceOrders.add(site.sourceOrder);
    previous = key;
  }
  return Either.right(decoded.right);
}
