import { Either, Schema } from "effect";
import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import type { RecordBlobRef } from "../record/attachment/index.ts";
import {
  CANONICAL_SOURCE_PATH__BRAND,
  type AssertionSourceFileFrame,
  type AssertionSourceFrame,
  type AssertionSourceOccurrence,
  type AssertionSourcePackageFrame,
  type AssertionSourceSendOccurrence,
  type AssertionSourceSendSite,
  type AssertionSourceSite,
  type AssertionSourceSitesDocument,
  type AssertionSourceSitesEntry,
  type AssertionSourceTrace,
  type CanonicalSourcePath,
  type SourceCoordinate,
  type SourceFileItemRef,
  type SourceFile,
  type SourcePackageItemRef,
  type SourcePackage,
  type SourcesDocument,
} from "./model.ts";
import {
  SHA256_DIGEST_BRAND,
  SOURCE_FILE_ITEM_ID_BRAND,
  SOURCE_PACKAGE_ITEM_ID_BRAND,
  type Sha256Digest,
  type SourceFileItemId,
  type SourcePackageItemId,
} from "./identity.ts";

/** Every durable Sources object rejects excess fields and aggregates parse failures. */
export const SourcesExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

const UTF8 = new TextEncoder();
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const PACKAGE_ITEM_ID = /^sp_[a-z0-9]{20}$/;
const FILE_ITEM_ID = /^sf_[a-z0-9]{20}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isSourceDisplayLabel(value: string): boolean {
  return !CONTROL_CHARACTER.test(value) && codePointLength(value) <= 256;
}

function isCanonicalSourcePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\") || value.includes("\u0000")) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isCanonicalSourcesDocument<BlobRef>(document: SourcesDocument<BlobRef>): boolean {
  let previousPackage: string | undefined;
  const packageIds = new Set<string>();
  for (const sourcePackage of document.packages) {
    if (previousPackage !== undefined && previousPackage >= sourcePackage.packageItemId) return false;
    previousPackage = sourcePackage.packageItemId;
    if (packageIds.has(sourcePackage.packageItemId)) return false;
    packageIds.add(sourcePackage.packageItemId);

    let previousFile: string | undefined;
    const fileIds = new Set<string>();
    const paths = new Set<string>();
    for (const file of sourcePackage.files) {
      if (previousFile !== undefined && previousFile >= file.fileItemId) return false;
      previousFile = file.fileItemId;
      if (fileIds.has(file.fileItemId) || paths.has(file.path)) return false;
      fileIds.add(file.fileItemId);
      paths.add(file.path);
    }
  }
  return true;
}

export const SourcePackageItemIdSchema: Schema.Schema<SourcePackageItemId, string> =
  Schema.String.pipe(
    Schema.filter((value) => PACKAGE_ITEM_ID.test(value), {
      identifier: "SourcePackageItemId",
      description: "an opaque sp_ source package item identity",
    }),
    Schema.brand(SOURCE_PACKAGE_ITEM_ID_BRAND),
  );

export const SourceFileItemIdSchema: Schema.Schema<SourceFileItemId, string> =
  Schema.String.pipe(
    Schema.filter((value) => FILE_ITEM_ID.test(value), {
      identifier: "SourceFileItemId",
      description: "an opaque sf_ source file item identity",
    }),
    Schema.brand(SOURCE_FILE_ITEM_ID_BRAND),
  );

export const Sha256DigestSchema: Schema.Schema<Sha256Digest, string> = Schema.String.pipe(
  Schema.filter((value) => SHA256.test(value), {
    identifier: "Sha256Digest",
    description: "a lower-case 64-character SHA-256 hex digest",
  }),
  Schema.brand(SHA256_DIGEST_BRAND),
);

export const CanonicalSourcePathSchema: Schema.Schema<CanonicalSourcePath, string> =
  Schema.String.pipe(
    Schema.filter(isCanonicalSourcePath, {
      identifier: "CanonicalSourcePath",
      description: "a non-empty package-relative path with canonical slash segments",
    }),
    Schema.brand(CANONICAL_SOURCE_PATH__BRAND),
  );

const SourceDisplayLabelSchema = Schema.String.pipe(
  Schema.filter(isSourceDisplayLabel, {
    identifier: "SourceDisplayLabel",
    description: "display text without control characters and at most 256 Unicode scalar values",
  }),
);

const PositiveSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter(isPositiveSafeInteger, {
    identifier: "PositiveSafeInteger",
    description: "a positive JSON-safe integer",
  }),
);

const NonNegativeFiniteSchema = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeFinite, {
    identifier: "NonNegativeFinite",
    description: "a finite non-negative JSON number",
  }),
);

export const SourcePackageItemRefSchema = Schema.Struct({
  kind: Schema.Literal("package"),
  packageItemId: SourcePackageItemIdSchema,
});

export const SourceFileItemRefSchema = Schema.Struct({
  kind: Schema.Literal("file"),
  packageItemId: SourcePackageItemIdSchema,
  fileItemId: SourceFileItemIdSchema,
  sha256: Sha256DigestSchema,
});

export const SourceCoordinateSchema: Schema.Schema<SourceCoordinate> = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

export const AssertionSourcePackageFrameSchema = Schema.Struct({
  target: SourcePackageItemRefSchema,
});

export const AssertionSourceFileFrameSchema = Schema.Struct({
  target: SourceFileItemRefSchema,
  coordinate: SourceCoordinateSchema,
});

export const AssertionSourceFrameSchema = Schema.Union(
  AssertionSourcePackageFrameSchema,
  AssertionSourceFileFrameSchema,
);

export const AssertionSourceTraceSchema = Schema.Struct({
  frames: Schema.Union(
    Schema.Tuple(AssertionSourceFileFrameSchema),
    Schema.Tuple(
      [AssertionSourceFileFrameSchema],
      AssertionSourceFrameSchema,
      AssertionSourceFileFrameSchema,
    ),
  ),
});

export const AssertionSourceOccurrenceSchema: Schema.Schema<AssertionSourceOccurrence> =
  Schema.Union(
    Schema.Struct({
      sourceOrder: PositiveSafeIntegerSchema,
      role: Schema.Literal("declaration", "threshold", "score", "gate", "optional"),
    }),
    Schema.Struct({
      sourceOrder: PositiveSafeIntegerSchema,
      role: Schema.Literal("stop"),
      outcome: Schema.Literal("continued", "stopped", "interrupted"),
    }),
  );

export const AssertionSourceSiteSchema = Schema.Struct({
  trace: AssertionSourceTraceSchema,
  occurrences: Schema.NonEmptyArray(AssertionSourceOccurrenceSchema),
});

export const AssertionSourceSitesEntrySchema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  sites: Schema.NonEmptyArray(AssertionSourceSiteSchema),
});

export const AssertionSourceSendOccurrenceSchema: Schema.Schema<AssertionSourceSendOccurrence> =
  Schema.Struct({
    sourceOrder: PositiveSafeIntegerSchema,
    label: SourceDisplayLabelSchema,
    status: Schema.Literal("completed", "failed", "interrupted"),
    durationMs: NonNegativeFiniteSchema,
  });

export const AssertionSourceSendSiteSchema = Schema.Struct({
  trace: AssertionSourceTraceSchema,
  occurrences: Schema.NonEmptyArray(AssertionSourceSendOccurrenceSchema),
});

/**
 * The structural decoder deliberately permits duplicate entry rows and source
 * orders. They are readable historical data whose local ambiguity belongs to
 * the pure assembler, rather than an Attachment-wide invalid state.
 */
export const AssertionSourceSitesDocumentSchema = Schema.Struct({
  entries: Schema.Array(AssertionSourceSitesEntrySchema),
  sendSites: Schema.Array(AssertionSourceSendSiteSchema),
});

/** Record's opaque ref position is the only non-JSON value seen before storage encodes it. */
const RecordBlobRefPositionSchema: Schema.Schema<RecordBlobRef, RecordBlobRef, never> =
  Schema.declare<RecordBlobRef>((value): value is RecordBlobRef =>
    typeof value === "object" && value !== null,
  );

export function createSourcesRecordSchemas<BlobRef, BlobRefEncoded>(
  blobRefSchema: Schema.Schema<BlobRef, BlobRefEncoded>,
) {
  const file = Schema.Struct({
    fileItemId: SourceFileItemIdSchema,
    path: CanonicalSourcePathSchema,
    sha256: Sha256DigestSchema,
    blob: blobRefSchema,
  });
  const sourcePackage = Schema.Struct({
    packageItemId: SourcePackageItemIdSchema,
    label: SourceDisplayLabelSchema,
    files: Schema.Array(file),
  });
  const document = Schema.Struct({
    packages: Schema.Array(sourcePackage),
  }).pipe(
    Schema.filter(isCanonicalSourcesDocument, {
      identifier: "SourcesCanonicalManifest",
      description: "a canonically sorted Sources manifest with unique package, file, and path identities",
    }),
  );

  return Object.freeze({ file, sourcePackage, document });
}

export const sourcesRecordSchemas = createSourcesRecordSchemas(
  RecordBlobRefPositionSchema,
);

export const SourcesDocumentSchema = sourcesRecordSchemas.document;

export type SourcesCodecError = { readonly code: "sources-document-invalid" };
export type AssertionSourceSitesCodecError = {
  readonly code: "assertion-source-sites-document-invalid";
};

const sourcesDocumentInvalid: SourcesCodecError = Object.freeze({
  code: "sources-document-invalid",
});
const assertionSourceSitesDocumentInvalid: AssertionSourceSitesCodecError = Object.freeze({
  code: "assertion-source-sites-document-invalid",
});

export function decodeSourcesDocument<BlobRef, Encoded>(
  schema: Schema.Schema<SourcesDocument<BlobRef>, Encoded>,
  input: unknown,
): Either.Either<SourcesDocument<BlobRef>, SourcesCodecError> {
  const decoded = Schema.decodeUnknownEither(schema, SourcesExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(sourcesDocumentInvalid)
    : Either.right(decoded.right);
}

export function decodeAssertionSourceSitesDocument(
  input: unknown,
): Either.Either<AssertionSourceSitesDocument, AssertionSourceSitesCodecError> {
  const decoded = Schema.decodeUnknownEither(
    AssertionSourceSitesDocumentSchema,
    SourcesExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(assertionSourceSitesDocumentInvalid)
    : Either.right(decoded.right);
}

/** The writer canonicalizes CRLF and CR, but any persisted source text must already be LF-only. */
export function canonicalizeSourceText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** JavaScript strings with unmatched surrogate code units cannot represent strict UTF-8 source text. */
export function isStrictUnicodeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

export function utf8BytesOfSourceText(text: string): Uint8Array {
  return UTF8.encode(text);
}
