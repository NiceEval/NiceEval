import { createHash } from "node:crypto";

import { Either, Schema } from "effect";

import {
  createAssertionsRecordSchemas,
  AssertionEntryIdSchema,
  BoundedJsonValueSchema,
  MAX_ASSERTION_DOCUMENT_BYTES,
} from "../../../../assertions/record/codec.ts";
import { isRecordMigrationContent } from "../../../attachment/protocol.ts";
import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationContent,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../../codec/identifiers.ts";
import { PositiveSafeIntegerSchema } from "../../common.ts";
import {
  AssertionSourcePositionSchema,
  AssertionSourceRoleSchema,
} from "../reference.ts";

const Revision2ContentSchema: Schema.Schema<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

/** The retired revision 2 physical material union, private to migration. */
export const AssertionsRevision2MaterialSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literal("not-recorded"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    value: BoundedJsonValueSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("blob"),
    ref: Revision2ContentSchema,
    encoding: Schema.Literal("utf-8", "binary"),
    byteLength: Schema.JsonNumber.pipe(
      Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
    ),
    sha256: Sha256DigestSchema,
    preview: Schema.String.pipe(
      Schema.filter((value) => new TextEncoder().encode(value).byteLength <= 8 * 1024),
    ),
  }),
);

const revision2Entries = createAssertionsRecordSchemas(
  AssertionsRevision2MaterialSchema,
).historicalV2Entries;

export const AssertionsRevision2SourceSiteSchema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  sourceOrder: PositiveSafeIntegerSchema,
  role: AssertionSourceRoleSchema,
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: AssertionSourcePositionSchema,
  end: AssertionSourcePositionSchema,
});

export const AssertionsRevision2Schema = Schema.Struct({
  entries: Schema.propertySignature(revision2Entries).pipe(
    Schema.fromKey("entries-data"),
  ),
  sourceSites: Schema.propertySignature(
    Schema.Array(AssertionsRevision2SourceSiteSchema),
  ).pipe(Schema.fromKey("source-sites-data")),
});

export type AssertionsRevision2 = typeof AssertionsRevision2Schema.Type;
export type AssertionsRevision2Material = typeof AssertionsRevision2MaterialSchema.Type;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function isWithinDocumentLimit(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined &&
      new TextEncoder().encode(encoded).byteLength <= MAX_ASSERTION_DOCUMENT_BYTES;
  } catch {
    return false;
  }
}

function validateMaterial(
  document: RecordMigrationDocument,
  material: AssertionsRevision2Material,
  path: readonly string[],
): RecordAttachmentIssue | undefined {
  if (material.kind !== "blob") return undefined;
  const bytes = document.content.bytes(material.ref);
  if (
    Either.isLeft(bytes) ||
    bytes.right.byteLength !== material.byteLength ||
    createHash("sha256").update(bytes.right).digest("hex") !== material.sha256
  ) {
    return invalid(path);
  }
  return undefined;
}

/** Strict revision 2 parser used only by the adjacent 2→3 migration. */
export function parseAssertionsRevision2(
  document: RecordMigrationDocument,
): Either.Either<AssertionsRevision2, RecordAttachmentIssue> {
  const wire = Schema.decodeUnknownEither(
    AssertionsRevision2Schema,
    RecordExactParseOptions,
  )(document.value);
  const decoded = Either.isRight(wire)
    ? wire
    : Schema.validateEither(
      AssertionsRevision2Schema,
      RecordExactParseOptions,
    )(document.value);
  if (Either.isLeft(decoded)) return Either.left(invalid([]));
  if (!isWithinDocumentLimit(document.value)) return Either.left(invalid([]));

  const entryIds = new Set<string>();
  for (const [entryIndex, entry] of decoded.right.entries.entries()) {
    if (entryIds.has(entry.entryId)) {
      return Either.left(invalid(["entries", String(entryIndex), "entryId"]));
    }
    entryIds.add(entry.entryId);
    const sourceIssue = validateMaterial(
      document,
      entry.materials.source,
      ["entries", String(entryIndex), "materials", "source"],
    );
    if (sourceIssue !== undefined) return Either.left(sourceIssue);
    for (const [evidenceIndex, material] of entry.materials.evidence.entries()) {
      const issue = validateMaterial(
        document,
        material,
        ["entries", String(entryIndex), "materials", "evidence", String(evidenceIndex)],
      );
      if (issue !== undefined) return Either.left(issue);
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
