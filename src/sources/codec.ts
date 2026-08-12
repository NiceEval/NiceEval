import { Either, Schema } from "effect";
import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import type { RecordBlobRef } from "../record/attachment/index.ts";
import {
  CANONICAL_SOURCE_PATH_V1_BRAND,
  SHA256_DIGEST_BRAND,
  SOURCE_FILE_ITEM_ID_BRAND,
  SOURCE_PACKAGE_ITEM_ID_BRAND,
  type AssertionSourceFileFrameV1,
  type AssertionSourceFrameV1,
  type AssertionSourceOccurrenceV1,
  type AssertionSourcePackageFrameV1,
  type AssertionSourceSendOccurrenceV1,
  type AssertionSourceSendSiteV1,
  type AssertionSourceSiteV1,
  type AssertionSourceSitesDocumentV1,
  type AssertionSourceSitesEntryV1,
  type AssertionSourceTraceV1,
  type CanonicalSourcePathV1,
  type Sha256Digest,
  type SourceCoordinateV1,
  type SourceFileItemId,
  type SourceFileItemRefV1,
  type SourceFileV1,
  type SourcePackageItemId,
  type SourcePackageItemRefV1,
  type SourcePackageV1,
  type SourcesDocumentV1,
} from "./model.ts";

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

function isCanonicalSourcesDocument<BlobRef>(document: SourcesDocumentV1<BlobRef>): boolean {
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

export const CanonicalSourcePathV1Schema: Schema.Schema<CanonicalSourcePathV1, string> =
  Schema.String.pipe(
    Schema.filter(isCanonicalSourcePath, {
      identifier: "CanonicalSourcePathV1",
      description: "a non-empty package-relative path with canonical slash segments",
    }),
    Schema.brand(CANONICAL_SOURCE_PATH_V1_BRAND),
  );

const SourceDisplayLabelV1Schema = Schema.String.pipe(
  Schema.filter(isSourceDisplayLabel, {
    identifier: "SourceDisplayLabelV1",
    description: "display text without control characters and at most 256 Unicode scalar values",
  }),
);

const PositiveSafeIntegerV1Schema = Schema.JsonNumber.pipe(
  Schema.filter(isPositiveSafeInteger, {
    identifier: "PositiveSafeInteger",
    description: "a positive JSON-safe integer",
  }),
);

const NonNegativeFiniteV1Schema = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeFinite, {
    identifier: "NonNegativeFinite",
    description: "a finite non-negative JSON number",
  }),
);

export const SourcePackageItemRefV1Schema = Schema.Struct({
  kind: Schema.Literal("package"),
  packageItemId: SourcePackageItemIdSchema,
});

export const SourceFileItemRefV1Schema = Schema.Struct({
  kind: Schema.Literal("file"),
  packageItemId: SourcePackageItemIdSchema,
  fileItemId: SourceFileItemIdSchema,
  sha256: Sha256DigestSchema,
});

export const SourceCoordinateV1Schema: Schema.Schema<SourceCoordinateV1> = Schema.Struct({
  line: PositiveSafeIntegerV1Schema,
  column: PositiveSafeIntegerV1Schema,
});

export const AssertionSourcePackageFrameV1Schema = Schema.Struct({
  target: SourcePackageItemRefV1Schema,
});

export const AssertionSourceFileFrameV1Schema = Schema.Struct({
  target: SourceFileItemRefV1Schema,
  coordinate: SourceCoordinateV1Schema,
});

export const AssertionSourceFrameV1Schema = Schema.Union(
  AssertionSourcePackageFrameV1Schema,
  AssertionSourceFileFrameV1Schema,
);

export const AssertionSourceTraceV1Schema = Schema.Struct({
  frames: Schema.Union(
    Schema.Tuple(AssertionSourceFileFrameV1Schema),
    Schema.Tuple(
      [AssertionSourceFileFrameV1Schema],
      AssertionSourceFrameV1Schema,
      AssertionSourceFileFrameV1Schema,
    ),
  ),
});

export const AssertionSourceOccurrenceV1Schema: Schema.Schema<AssertionSourceOccurrenceV1> =
  Schema.Union(
    Schema.Struct({
      sourceOrder: PositiveSafeIntegerV1Schema,
      role: Schema.Literal("declaration", "threshold", "score", "gate", "optional"),
    }),
    Schema.Struct({
      sourceOrder: PositiveSafeIntegerV1Schema,
      role: Schema.Literal("stop"),
      outcome: Schema.Literal("continued", "stopped", "interrupted"),
    }),
  );

export const AssertionSourceSiteV1Schema = Schema.Struct({
  trace: AssertionSourceTraceV1Schema,
  occurrences: Schema.NonEmptyArray(AssertionSourceOccurrenceV1Schema),
});

export const AssertionSourceSitesEntryV1Schema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  sites: Schema.NonEmptyArray(AssertionSourceSiteV1Schema),
});

export const AssertionSourceSendOccurrenceV1Schema: Schema.Schema<AssertionSourceSendOccurrenceV1> =
  Schema.Struct({
    sourceOrder: PositiveSafeIntegerV1Schema,
    label: SourceDisplayLabelV1Schema,
    status: Schema.Literal("completed", "failed", "interrupted"),
    durationMs: NonNegativeFiniteV1Schema,
  });

export const AssertionSourceSendSiteV1Schema = Schema.Struct({
  trace: AssertionSourceTraceV1Schema,
  occurrences: Schema.NonEmptyArray(AssertionSourceSendOccurrenceV1Schema),
});

/**
 * The structural decoder deliberately permits duplicate entry rows and source
 * orders. They are readable historical data whose local ambiguity belongs to
 * the pure assembler, rather than an Attachment-wide invalid state.
 */
export const AssertionSourceSitesDocumentV1Schema = Schema.Struct({
  entries: Schema.Array(AssertionSourceSitesEntryV1Schema),
  sendSites: Schema.Array(AssertionSourceSendSiteV1Schema),
});

/** Record's opaque ref position is the only non-JSON value seen before storage encodes it. */
const RecordBlobRefPositionSchema: Schema.Schema<RecordBlobRef, RecordBlobRef, never> =
  Schema.declare<RecordBlobRef>((value): value is RecordBlobRef =>
    typeof value === "object" && value !== null,
  );

export function createSourcesRecordSchemasV1<BlobRef, BlobRefEncoded>(
  blobRefSchema: Schema.Schema<BlobRef, BlobRefEncoded>,
) {
  const file = Schema.Struct({
    fileItemId: SourceFileItemIdSchema,
    path: CanonicalSourcePathV1Schema,
    sha256: Sha256DigestSchema,
    blob: blobRefSchema,
  });
  const sourcePackage = Schema.Struct({
    packageItemId: SourcePackageItemIdSchema,
    label: SourceDisplayLabelV1Schema,
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

export const sourcesRecordSchemasV1 = createSourcesRecordSchemasV1(
  RecordBlobRefPositionSchema,
);

export const SourcesDocumentV1Schema = sourcesRecordSchemasV1.document;

export type SourcesCodecErrorV1 = { readonly code: "sources-document-invalid" };
export type AssertionSourceSitesCodecErrorV1 = {
  readonly code: "assertion-source-sites-document-invalid";
};

const sourcesDocumentInvalid: SourcesCodecErrorV1 = Object.freeze({
  code: "sources-document-invalid",
});
const assertionSourceSitesDocumentInvalid: AssertionSourceSitesCodecErrorV1 = Object.freeze({
  code: "assertion-source-sites-document-invalid",
});

export function decodeSourcesDocumentV1<BlobRef, Encoded>(
  schema: Schema.Schema<SourcesDocumentV1<BlobRef>, Encoded>,
  input: unknown,
): Either.Either<SourcesDocumentV1<BlobRef>, SourcesCodecErrorV1> {
  const decoded = Schema.decodeUnknownEither(schema, SourcesExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(sourcesDocumentInvalid)
    : Either.right(decoded.right);
}

export function decodeAssertionSourceSitesDocumentV1(
  input: unknown,
): Either.Either<AssertionSourceSitesDocumentV1, AssertionSourceSitesCodecErrorV1> {
  const decoded = Schema.decodeUnknownEither(
    AssertionSourceSitesDocumentV1Schema,
    SourcesExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(assertionSourceSitesDocumentInvalid)
    : Either.right(decoded.right);
}

/** The writer canonicalizes CRLF and CR, but any persisted source text must already be LF-only. */
export function canonicalizeSourceTextV1(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** JavaScript strings with unmatched surrogate code units cannot represent strict UTF-8 source text. */
export function isStrictUnicodeTextV1(value: string): boolean {
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

export function utf8BytesOfSourceTextV1(text: string): Uint8Array {
  return UTF8.encode(text);
}
