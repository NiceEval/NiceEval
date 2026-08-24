import { createHash } from "node:crypto";

import { Either, Schema } from "effect";

import { RecordExactParseOptions } from "../record/codec/core.ts";
import {
  CanonicalProjectRelativePathSchema,
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../record/codec/identifiers.ts";
import { sourcesRecordAttachment } from "../record/family/sources/definition.ts";
import {
  SourcesAttachmentSchema,
  SourcesLimits,
  type SourcesAttachment,
} from "../record/family/sources/schema.ts";
import type {
  CanonicalProjectRelativePath,
  Sha256Digest,
  SourceItemId,
} from "../record/model/identifiers.ts";
import {
  AssertionSourceSiteSchema,
  type AssertionSourceSite,
} from "../record/family/assertions/definition.ts";
import type { RecordAttachmentSessionBuilder } from "../record/writer/current-attachment.ts";
import {
  canonicalizeSourceText,
  isStrictUnicodeText,
} from "./codec.ts";
import type { AssertionSourceSitesDocument } from "./model.ts";

/** Capture input only. It is flattened before the current logical value is built. */
export interface SourceItemAttachmentInput {
  readonly sourceItemId: string;
  readonly path: string;
  readonly text: string;
}

/**
 * `packages` remains an in-memory capture convenience for the existing
 * source collector. It never appears in the current Sources value.
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

export type SourcesAttachmentBuildError = {
  readonly code: "sources-attachment-input-invalid";
};

export type AssertionSourceSitesAttachmentBuildError = {
  readonly code: "assertion-source-sites-input-invalid";
};

const sourcesInputInvalid: SourcesAttachmentBuildError = Object.freeze({
  code: "sources-attachment-input-invalid" as const,
});
const sourceSitesInputInvalid: AssertionSourceSitesAttachmentBuildError = Object.freeze({
  code: "assertion-source-sites-input-invalid" as const,
});

export type SourcesAttachmentBuild = (
  build: RecordAttachmentSessionBuilder,
) => SourcesAttachment;

export interface SourcesAttachmentItemCapture {
  readonly sourceItemId: SourceItemId;
  readonly path: CanonicalProjectRelativePath;
  readonly text: string;
  readonly byteLength: number;
  readonly sha256: Sha256Digest;
}

export interface SourcesAttachmentPlan {
  /** Exact current value constructor to pass to the Run owner's attach call. */
  readonly value: SourcesAttachmentBuild;
  /** Same canonical capture used by semantic joins before the attach callback runs. */
  readonly items: readonly SourcesAttachmentItemCapture[];
}

export type AssertionSourceSitesBuild = (
  build: RecordAttachmentSessionBuilder,
) => readonly AssertionSourceSite[];

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

function canonicalSourceItem(
  input: SourceItemAttachmentInput,
): SourcesAttachmentItemCapture | undefined {
  if (!isStrictUnicodeText(input.text)) return undefined;
  const sourceItemId = Schema.decodeUnknownEither(
    SourceItemIdSchema,
    RecordExactParseOptions,
  )(input.sourceItemId);
  const path = Schema.decodeUnknownEither(
    CanonicalProjectRelativePathSchema,
    RecordExactParseOptions,
  )(input.path);
  if (Either.isLeft(sourceItemId) || Either.isLeft(path)) return undefined;
  const text = canonicalizeSourceText(input.text);
  const bytes = new TextEncoder().encode(text);
  const byteLength = bytes.byteLength;
  if (byteLength > SourcesLimits.maximumContentBytes) return undefined;
  const sha256 = Schema.decodeUnknownEither(Sha256DigestSchema)(
    createHash("sha256").update(bytes).digest("hex"),
  );
  if (Either.isLeft(sha256)) return undefined;
  return Object.freeze({
    sourceItemId: sourceItemId.right,
    path: path.right,
    text,
    byteLength,
    sha256: sha256.right,
  });
}

/**
 * Builds the exact current Sources value inside the owner session. The
 * producer retains only canonical text; Record Core owns content materialization.
 */
export function createSourcesAttachment(
  input: SourcesAttachmentInput,
): Either.Either<SourcesAttachmentPlan, SourcesAttachmentBuildError> {
  const items = sourceItems(input);
  if (items === undefined || items.length > SourcesLimits.maximumItems) {
    return Either.left(sourcesInputInvalid);
  }
  const canonical: SourcesAttachmentItemCapture[] = [];
  for (const item of items) {
    const decoded = canonicalSourceItem(item);
    if (decoded === undefined) return Either.left(sourcesInputInvalid);
    canonical.push(decoded);
  }
  canonical.sort((left, right) => left.sourceItemId.localeCompare(right.sourceItemId));
  if (
    new Set(canonical.map((item) => item.sourceItemId)).size !== canonical.length ||
    new Set(canonical.map((item) => item.path)).size !== canonical.length
  ) {
    return Either.left(sourcesInputInvalid);
  }
  const frozen = Object.freeze([...canonical]);
  return Either.right(Object.freeze({
    value: (build: RecordAttachmentSessionBuilder) => {
      const candidate = Object.freeze({
        items: Object.freeze(frozen.map((item) => Object.freeze({
          sourceItemId: item.sourceItemId,
          path: item.path,
          byteLength: item.byteLength,
          sha256: item.sha256,
          content: build.content.text(item.text),
        }))),
      });
      const decoded = Schema.validateEither(
        SourcesAttachmentSchema,
        RecordExactParseOptions,
      )(candidate);
      if (Either.isLeft(decoded)) {
        throw new Error("Sources capture violated its current schema");
      }
      return decoded.right;
    },
    items: frozen,
  }));
}

interface PendingAssertionSourceSite {
  readonly entryId: AssertionSourceSite["entryId"];
  readonly sourceOrder: number;
  readonly role: AssertionSourceSite["role"];
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: AssertionSourceSite["start"];
  readonly end: AssertionSourceSite["end"];
}

/**
 * Converts the old runtime source journal to the current semantic rows embedded
 * in `niceeval.assertions`; the callback mints each exact Sources reference.
 */
export function deriveAssertionSourceSites(
  input: AssertionSourceSitesDocument,
): Either.Either<AssertionSourceSitesBuild, AssertionSourceSitesAttachmentBuildError> {
  const rows: PendingAssertionSourceSite[] = [];
  const orders = new Set<number>();
  for (const entry of input.entries) {
    for (const site of entry.sites) {
      const leaf = site.trace.frames.at(-1);
      if (
        leaf === undefined ||
        leaf.target.kind !== "file" ||
        !("coordinate" in leaf)
      ) continue;
      const sourceItemId = Schema.decodeUnknownEither(
        SourceItemIdSchema,
        RecordExactParseOptions,
      )(leaf.target.fileItemId);
      const sha256 = Schema.decodeUnknownEither(Sha256DigestSchema)(leaf.target.sha256);
      if (Either.isLeft(sourceItemId) || Either.isLeft(sha256)) {
        return Either.left(sourceSitesInputInvalid);
      }
      for (const occurrence of site.occurrences) {
        if (orders.has(occurrence.sourceOrder)) return Either.left(sourceSitesInputInvalid);
        orders.add(occurrence.sourceOrder);
        const coordinate = Object.freeze({
          line: leaf.coordinate.line,
          column: leaf.coordinate.column,
        });
        rows.push(Object.freeze({
          entryId: entry.entryId,
          sourceOrder: occurrence.sourceOrder,
          role: occurrence.role,
          sourceItemId: sourceItemId.right,
          sha256: sha256.right,
          start: coordinate,
          end: coordinate,
        }));
      }
    }
  }
  rows.sort((left, right) => {
    const byEntry = left.entryId.localeCompare(right.entryId);
    return byEntry === 0 ? left.sourceOrder - right.sourceOrder : byEntry;
  });
  const frozen = Object.freeze([...rows]);
  return Either.right((build) => {
    const candidate = Object.freeze(frozen.map((row) => Object.freeze({
      entryId: row.entryId,
      sourceOrder: row.sourceOrder,
      role: row.role,
      source: build.reference.to(sourcesRecordAttachment, {
        sourceItemId: row.sourceItemId,
        sha256: row.sha256,
      }),
      start: row.start,
      end: row.end,
    })));
    const decoded = Schema.validateEither(
      Schema.Array(AssertionSourceSiteSchema),
      RecordExactParseOptions,
    )(candidate);
    if (Either.isLeft(decoded)) {
      throw new Error("Assertion source capture violated its current schema");
    }
    return Object.freeze(decoded.right);
  });
}

/** The current Sources payload is the only durable source document. */
export type SourcesPayload = SourcesAttachment;
