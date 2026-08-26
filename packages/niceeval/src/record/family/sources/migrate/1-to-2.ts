import { createHash } from "node:crypto";

import { Effect, Result, Schema } from "effect";

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
const HistoricalContentSchema: Schema.Codec<RecordMigrationContent> = Schema.declare(
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
  items: Schema.Array(HistoricalSourceItemSchema),
}).pipe(Schema.encodeKeys({ items: "items-data" }));

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
): Result.Result<string, RecordAttachmentIssue> {
  const bytes = document.content.bytes(item.content);
  if (Result.isFailure(bytes)) return Result.fail(invalid([...path, "content"]));
  if (bytes.success.byteLength !== item.byteLength) {
    return Result.fail(invalid([...path, "byteLength"]));
  }
  if (createHash("sha256").update(bytes.success).digest("hex") !== item.sha256) {
    return Result.fail(invalid([...path, "sha256"]));
  }
  try {
    return Result.succeed(decoder.decode(bytes.success));
  } catch {
    return Result.fail(invalid([...path, "content"]));
  }
}

function parseSourcesRevision1(
  document: RecordMigrationDocument,
): Result.Result<SourcesRevision1, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownResult(
    SourcesRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Result.isFailure(decoded)) return Result.fail(invalid([]));

  if (
    decoded.success.items.length > SourcesLimits.maximumItems ||
    !isCanonicalIdentitySequence(decoded.success.items.map((item) => item.sourceItemId)) ||
    new Set(decoded.success.items.map((item) => item.path)).size !== decoded.success.items.length
  ) {
    return Result.fail(invalid(["items"]));
  }

  let totalBytes = 0;
  const items: SourcesRevision1["items"][number][] = [];
  for (const [index, item] of decoded.success.items.entries()) {
    totalBytes += item.byteLength;
    if (
      item.byteLength > SourcesLimits.maximumContentBytes ||
      totalBytes > maximumTotalContentBytes
    ) {
      return Result.fail(invalid(["items", String(index), "byteLength"]));
    }
    const text = verifiedText(document, item, ["items", String(index)]);
    if (Result.isFailure(text)) return Result.fail(text.failure);
    items.push(Object.freeze({
      sourceItemId: item.sourceItemId,
      path: item.path,
      byteLength: item.byteLength,
      sha256: item.sha256,
      text: text.success,
    }));
  }
  return Result.succeed(Object.freeze({ items: Object.freeze(items) }));
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
