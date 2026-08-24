import { createHash } from "node:crypto";

import { Effect, Either, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationContent,
  type RecordMigrationDocument,
  type RecordMigrationImpact,
} from "../../../attachment/index.ts";
import { isRecordMigrationContent } from "../../../attachment/protocol.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  CanonicalProjectRelativePathSchema,
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../../codec/identifiers.ts";
import {
  NonNegativeSafeIntegerSchema,
  isCanonicalIdentitySequence,
} from "../../common.ts";
import { SourcesLimits } from "../schema.ts";

/**
 * Revision 1 alone knows that a source content field was a BlobRef. Core has
 * already resolved and verified that pointer into this storage-neutral token.
 */
const HistoricalContentSchema: Schema.Schema<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const HistoricalSourceItemSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  path: CanonicalProjectRelativePathSchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: HistoricalContentSchema,
});

const SourcesRevision1Schema = Schema.Struct({
  items: Schema.propertySignature(Schema.Array(HistoricalSourceItemSchema)).pipe(
    Schema.fromKey("items-data"),
  ),
});

type HistoricalSourcesRevision1 = typeof SourcesRevision1Schema.Type;
type SourcesRevision1 = {
  readonly items: readonly (Omit<HistoricalSourcesRevision1["items"][number], "content"> & {
    readonly text: string;
  })[];
};

const decoder = new TextDecoder("utf-8", { fatal: true });
const maximumTotalContentBytes = 128 * 1024 * 1024;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function verifiedText(
  document: RecordMigrationDocument,
  item: HistoricalSourcesRevision1["items"][number],
  path: readonly string[],
): Either.Either<string, RecordAttachmentIssue> {
  const bytes = document.content.bytes(item.content);
  if (Either.isLeft(bytes)) return Either.left(invalid([...path, "content"]));
  if (bytes.right.byteLength !== item.byteLength) {
    return Either.left(invalid([...path, "byteLength"]));
  }
  if (createHash("sha256").update(bytes.right).digest("hex") !== item.sha256) {
    return Either.left(invalid([...path, "sha256"]));
  }
  try {
    return Either.right(decoder.decode(bytes.right));
  } catch {
    return Either.left(invalid([...path, "content"]));
  }
}

function parseSourcesRevision1(
  document: RecordMigrationDocument,
): Either.Either<SourcesRevision1, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownEither(
    SourcesRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(decoded)) return Either.left(invalid([]));

  if (
    decoded.right.items.length > SourcesLimits.maximumItems ||
    !isCanonicalIdentitySequence(decoded.right.items.map((item) => item.sourceItemId)) ||
    new Set(decoded.right.items.map((item) => item.path)).size !== decoded.right.items.length
  ) {
    return Either.left(invalid(["items"]));
  }

  let totalBytes = 0;
  const items: SourcesRevision1["items"][number][] = [];
  for (const [index, item] of decoded.right.items.entries()) {
    totalBytes += item.byteLength;
    if (
      item.byteLength > SourcesLimits.maximumContentBytes ||
      totalBytes > maximumTotalContentBytes
    ) {
      return Either.left(invalid(["items", String(index), "byteLength"]));
    }
    const text = verifiedText(document, item, ["items", String(index)]);
    if (Either.isLeft(text)) return Either.left(text.left);
    items.push(Object.freeze({
      sourceItemId: item.sourceItemId,
      path: item.path,
      byteLength: item.byteLength,
      sha256: item.sha256,
      text: text.right,
    }));
  }
  return Either.right(Object.freeze({ items: Object.freeze(items) }));
}

export const sourcesV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseSourcesRevision1,
  migrate: ({ value: previous, build }) => {
    const impact: RecordMigrationImpact[] = [];
    const items = previous.items.map((item, index) => {
      impact.push(Object.freeze({
        code: "migration-content-retained" as const,
        path: Object.freeze(["items", String(index), "content"]),
        count: 1,
        recommendation: "none" as const,
      }));
      return Object.freeze({
        sourceItemId: item.sourceItemId,
        path: item.path,
        byteLength: item.byteLength,
        sha256: item.sha256,
        content: build.content.text(item.text),
      });
    });
    return Effect.succeed(Object.freeze({
      value: Object.freeze({ items: Object.freeze(items) }),
      references: Object.freeze([]),
      impact: Object.freeze(impact),
    }));
  },
});
