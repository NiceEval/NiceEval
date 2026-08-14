import { createHash } from "node:crypto";

import { Either, Schema, Stream } from "effect";
import {
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentWrite,
  type RecordBlobRef,
} from "../record/attachment/index.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { sourcesRecordFamily } from "../record/family/catalog.ts";
import {
  SourcesAttachmentSchema,
  sourcesBlobRefs as fixedSourcesBlobRefs,
  type SourcesAttachment,
} from "../record/family/sources.ts";
import {
  AssertionSourceSiteSchema,
  type AssertionSourceSite,
} from "../record/family/assertions.ts";
import {
  canonicalizeSourceText,
  isStrictUnicodeText,
} from "./codec.ts";
import type {
  AssertionSourceSitesDocument,
  SourcesDocument,
} from "./model.ts";

/** Capture input only. It is flattened before durable encoding. */
export interface SourceItemAttachmentInput {
  readonly sourceItemId: string;
  readonly path: string;
  readonly text: string;
}

/**
 * `packages` remains an in-memory capture convenience for the existing
 * source collector. It never appears in the fixed Sources payload.
 */
export interface SourcesAttachmentInput {
  readonly items?: readonly SourceItemAttachmentInput[];
  readonly packages?: readonly {
    readonly files: readonly {
      readonly fileItemId: string;
      readonly path: string;
      readonly text: string;
    }[];
  }[];
}

export type SourcesAttachmentWriteError = {
  readonly code: "sources-attachment-input-invalid";
};

export type AssertionSourceSitesAttachmentWriteError = {
  readonly code: "assertion-source-sites-input-invalid";
};

const sourcesInputInvalid: SourcesAttachmentWriteError = Object.freeze({
  code: "sources-attachment-input-invalid" as const,
});
const sourceSitesInputInvalid: AssertionSourceSitesAttachmentWriteError = Object.freeze({
  code: "assertion-source-sites-input-invalid" as const,
});

/** The fixed catalog, not this producer, owns schema and migration identity. */
export const sourcesAttachmentWrite = sourcesRecordFamily.write;

/** Complete closure projection for the one Run-owned Sources payload. */
export function sourceBlobRefs(
  document: SourcesAttachment,
): readonly RecordBlobRef[] {
  return fixedSourcesBlobRefs(document);
}

function sourceItems(
  input: SourcesAttachmentInput,
): readonly SourceItemAttachmentInput[] | undefined {
  if (input.items !== undefined && input.packages !== undefined) return undefined;
  if (input.items !== undefined) return input.items;
  if (input.packages === undefined) return undefined;
  return input.packages.flatMap((sourcePackage) =>
    sourcePackage.files.map((file) =>
      Object.freeze({
        sourceItemId: file.fileItemId,
        path: file.path,
        text: file.text,
      }),
    ),
  );
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Writes the exact source closure as a flat owner-local manifest. Text is
 * canonicalized before both digesting and blob creation, so reader validation
 * never relies on the current worktree or package installation.
 */
export function createSourcesAttachmentWrite(
  input: SourcesAttachmentInput,
): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  SourcesAttachmentWriteError
> {
  const items = sourceItems(input);
  if (items === undefined || items.some((item) => !isStrictUnicodeText(item.text))) {
    return Either.left(sourcesInputInvalid);
  }

  const write = makeFixedRecordAttachmentWrite(sourcesAttachmentWrite, (blobs) => {
    const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
    const candidateItems = items.map((item) => {
      const text = canonicalizeSourceText(item.text);
      const content = new TextEncoder().encode(text);
      const draft = blobs.add(makeRecordBlobSource(Stream.succeed(content)));
      drafts.push(draft);
      return Object.freeze({
        sourceItemId: item.sourceItemId,
        path: item.path,
        byteLength: content.byteLength,
        sha256: digest(text),
        content: draft.ref,
      });
    });
    candidateItems.sort((left, right) => left.sourceItemId.localeCompare(right.sourceItemId));
    const decoded = Schema.decodeUnknownEither(
      SourcesAttachmentSchema,
      RecordExactParseOptions,
    )(Object.freeze({ items: Object.freeze(candidateItems) }));
    if (Either.isLeft(decoded)) {
      throw new Error("Sources collector produced an invalid fixed-family payload");
    }
    return Object.freeze({ payload: decoded.right, blobs: Object.freeze(drafts) });
  });
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("Sources collector produced an invalid owner-local closure");
  }
  return Either.right(write);
}

/**
 * Converts the old runtime source journal to the semantic rows embedded in
 * `niceeval.assertions`. This is intentionally a pure adapter: source
 * sites are no longer an Attempt-owned attachment or writer path.
 */
export function deriveAssertionSourceSites(
  input: AssertionSourceSitesDocument,
): Either.Either<
  readonly AssertionSourceSite[],
  AssertionSourceSitesAttachmentWriteError
> {
  const rows: unknown[] = [];
  const orders = new Set<number>();
  for (const entry of input.entries) {
    for (const site of entry.sites) {
      const leaf = site.trace.frames.at(-1);
      if (
        leaf === undefined
        || leaf.target.kind !== "file"
        || !("coordinate" in leaf)
      ) continue;
      for (const occurrence of site.occurrences) {
        if (orders.has(occurrence.sourceOrder)) return Either.left(sourceSitesInputInvalid);
        orders.add(occurrence.sourceOrder);
        rows.push(Object.freeze({
          entryId: entry.entryId,
          sourceOrder: occurrence.sourceOrder,
          role: occurrence.role,
          sourceItemId: leaf.target.fileItemId,
          sha256: leaf.target.sha256,
          start: Object.freeze({
            line: leaf.coordinate.line,
            column: leaf.coordinate.column,
          }),
          end: Object.freeze({
            line: leaf.coordinate.line,
            column: leaf.coordinate.column,
          }),
        }));
      }
    }
  }
  const decoded = Schema.decodeUnknownEither(
    Schema.Array(AssertionSourceSiteSchema),
    RecordExactParseOptions,
  )(rows);
  if (Either.isLeft(decoded)) return Either.left(sourceSitesInputInvalid);
  const ordered = [...decoded.right].sort((left, right) => {
    const byEntry = left.entryId.localeCompare(right.entryId);
    return byEntry === 0 ? left.sourceOrder - right.sourceOrder : byEntry;
  });
  return Either.right(Object.freeze(ordered));
}

/** A fixed Sources payload is the only durable source document in v1. */
export type SourcesPayload = SourcesAttachment;

/** Retained for domain-only callers while they migrate from the old grouping. */
export type LegacySourcesDocument = SourcesDocument<RecordBlobRef>;
