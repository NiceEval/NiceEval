import { createHash } from "node:crypto";
import { Either, Schema, Stream } from "effect";
import {
  defineRecordAttachmentFamily,
  makeRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentFamily,
  type RecordAttachmentWrite,
  type RecordBlobRef,
} from "../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../record/attachment/internal.ts";
import {
  AssertionSourceSitesDocumentV1Schema,
  CanonicalSourcePathV1Schema,
  Sha256DigestSchema,
  SourceFileItemIdSchema,
  SourcePackageItemIdSchema,
  SourcesDocumentV1Schema,
  SourcesExactParseOptions,
  canonicalizeSourceTextV1,
  isStrictUnicodeTextV1,
  utf8BytesOfSourceTextV1,
} from "./codec.ts";
import type {
  AssertionSourceOccurrenceV1,
  AssertionSourceSendOccurrenceV1,
  AssertionSourceSendSiteV1,
  AssertionSourceSiteV1,
  AssertionSourceSitesDocumentV1,
  AssertionSourceSitesEntryV1,
  CanonicalSourcePathV1,
  Sha256Digest,
  SourceFileItemId,
  SourcePackageItemId,
  SourcesDocumentV1,
} from "./model.ts";

export const SOURCES_ATTACHMENT_NAME_V1 = "niceeval.sources" as const;
export const ASSERTION_SOURCE_SITES_ATTACHMENT_NAME_V1 =
  "niceeval.assertion-source-sites" as const;

function requireDefinition<Result, Failure>(
  result: Either.Either<Result, Failure>,
  message: string,
): Result {
  if (Either.isLeft(result)) throw new Error(message);
  return result.right;
}

/** Complete payload-order projection for the Sources owner-local blob closure. */
export function sourceBlobRefsV1(
  document: SourcesDocumentV1<RecordBlobRef>,
): readonly RecordBlobRef[] {
  const refs: RecordBlobRef[] = [];
  for (const sourcePackage of document.packages) {
    for (const file of sourcePackage.files) refs.push(file.blob);
  }
  return Object.freeze(refs);
}

export const sourcesAttachmentDefinitionV1 = requireDefinition(
  defineBuiltinJsonRecordAttachment({
    owner: "run",
    name: SOURCES_ATTACHMENT_NAME_V1,
    schemaId: "niceeval.sources/v1",
    schema: SourcesDocumentV1Schema,
    blobRefs: sourceBlobRefsV1,
  }),
  "Sources v1 RecordAttachment definition must be valid",
);

export const sourcesAttachmentFamilyV1 = requireDefinition(
  defineRecordAttachmentFamily({
    current: sourcesAttachmentDefinitionV1,
    migrations: [],
  }),
  "Sources v1 RecordAttachment family must be valid",
);

export const assertionSourceSitesAttachmentDefinitionV1 = requireDefinition(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: ASSERTION_SOURCE_SITES_ATTACHMENT_NAME_V1,
    schemaId: "niceeval.assertion-source-sites/v1",
    schema: AssertionSourceSitesDocumentV1Schema,
    blobRefs: () => Object.freeze([]),
  }),
  "Assertion source-sites v1 RecordAttachment definition must be valid",
);

export const assertionSourceSitesAttachmentFamilyV1 = requireDefinition(
  defineRecordAttachmentFamily({
    current: assertionSourceSitesAttachmentDefinitionV1,
    migrations: [],
  }),
  "Assertion source-sites v1 RecordAttachment family must be valid",
);

export interface SourceFileAttachmentInputV1 {
  readonly fileItemId: string;
  readonly path: string;
  readonly text: string;
}

export interface SourcePackageAttachmentInputV1 {
  readonly packageItemId: string;
  readonly label: string;
  readonly files: readonly SourceFileAttachmentInputV1[];
}

/** Text is a capture input only; persisted source bytes are minted in the Sources closure. */
export interface SourcesAttachmentInputV1 {
  readonly packages: readonly SourcePackageAttachmentInputV1[];
}

export type SourcesAttachmentWriteErrorV1 = {
  readonly code: "sources-attachment-input-invalid";
};

export type AssertionSourceSitesAttachmentWriteErrorV1 = {
  readonly code: "assertion-source-sites-attachment-input-invalid";
};

interface NormalizedSourceFileInputV1 {
  readonly fileItemId: SourceFileItemId;
  readonly path: CanonicalSourcePathV1;
  readonly text: string;
}

interface NormalizedSourcePackageInputV1 {
  readonly packageItemId: SourcePackageItemId;
  readonly label: string;
  readonly files: readonly NormalizedSourceFileInputV1[];
}

interface NormalizedSourcesAttachmentInputV1 {
  readonly packages: readonly NormalizedSourcePackageInputV1[];
}

const StrictSourceTextV1Schema = Schema.String.pipe(
  Schema.filter(isStrictUnicodeTextV1, {
    identifier: "StrictSourceTextV1",
    description: "a JavaScript string that round-trips through strict UTF-8",
  }),
);

const SourceFileAttachmentInputV1Schema = Schema.Struct({
  fileItemId: SourceFileItemIdSchema,
  path: CanonicalSourcePathV1Schema,
  text: StrictSourceTextV1Schema,
});

const SourcePackageAttachmentInputV1Schema = Schema.Struct({
  packageItemId: SourcePackageItemIdSchema,
  label: Schema.String.pipe(
    Schema.filter((value) =>
      !/[\p{Cc}]/u.test(value) &&
      Array.from(value).length <= 256,
    {
      identifier: "SourceDisplayLabelV1",
      description: "display text without control characters and at most 256 Unicode scalar values",
    }),
  ),
  files: Schema.Array(SourceFileAttachmentInputV1Schema),
});

const SourcesAttachmentInputV1Schema = Schema.Struct({
  packages: Schema.Array(SourcePackageAttachmentInputV1Schema),
});

function compareIdentity(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sourcesInputInvalid(): SourcesAttachmentWriteErrorV1 {
  return Object.freeze({ code: "sources-attachment-input-invalid" });
}

function sourceSitesInputInvalid(): AssertionSourceSitesAttachmentWriteErrorV1 {
  return Object.freeze({ code: "assertion-source-sites-attachment-input-invalid" });
}

function normalizeSourcesAttachmentInputV1(
  input: SourcesAttachmentInputV1,
): Either.Either<NormalizedSourcesAttachmentInputV1, SourcesAttachmentWriteErrorV1> {
  const raw = Schema.decodeUnknownEither(
    SourcesAttachmentInputV1Schema,
    SourcesExactParseOptions,
  )(input);
  if (Either.isLeft(raw)) return Either.left(sourcesInputInvalid());
  const canonicalInput = {
    packages: raw.right.packages.map((sourcePackage) => ({
      packageItemId: sourcePackage.packageItemId,
      label: sourcePackage.label,
      files: sourcePackage.files.map((file) => ({
        fileItemId: file.fileItemId,
        path: file.path,
        text: canonicalizeSourceTextV1(file.text),
      })),
    })),
  };
  const decoded = Schema.decodeUnknownEither(
    SourcesAttachmentInputV1Schema,
    SourcesExactParseOptions,
  )(canonicalInput);
  if (Either.isLeft(decoded)) return Either.left(sourcesInputInvalid());

  const packageIds = new Set<string>();
  const packages: NormalizedSourcePackageInputV1[] = [];
  for (const sourcePackage of decoded.right.packages) {
    if (packageIds.has(sourcePackage.packageItemId)) return Either.left(sourcesInputInvalid());
    packageIds.add(sourcePackage.packageItemId);

    const fileIds = new Set<string>();
    const paths = new Set<string>();
    const files: NormalizedSourceFileInputV1[] = [];
    for (const file of sourcePackage.files) {
      if (fileIds.has(file.fileItemId) || paths.has(file.path)) {
        return Either.left(sourcesInputInvalid());
      }
      fileIds.add(file.fileItemId);
      paths.add(file.path);
      files.push(Object.freeze({
        fileItemId: file.fileItemId,
        path: file.path,
        text: file.text,
      }));
    }
    files.sort((left, right) => compareIdentity(left.fileItemId, right.fileItemId));
    packages.push(Object.freeze({
      packageItemId: sourcePackage.packageItemId,
      label: sourcePackage.label,
      files: Object.freeze(files),
    }));
  }
  packages.sort((left, right) => compareIdentity(left.packageItemId, right.packageItemId));
  return Either.right(Object.freeze({ packages: Object.freeze(packages) }));
}

function sha256DigestOfCanonicalTextV1(text: string): Sha256Digest {
  const decoded = Schema.decodeUnknownEither(
    Sha256DigestSchema,
    SourcesExactParseOptions,
  )(createHash("sha256").update(text, "utf8").digest("hex"));
  if (Either.isLeft(decoded)) {
    throw new Error("SHA-256 implementation returned an invalid digest");
  }
  return decoded.right;
}

function requireSourcesDocumentV1(
  candidate: SourcesDocumentV1<RecordBlobRef>,
): SourcesDocumentV1<RecordBlobRef> {
  const decoded = Schema.decodeUnknownEither(
    SourcesDocumentV1Schema,
    SourcesExactParseOptions,
  )(candidate);
  if (Either.isLeft(decoded)) {
    throw new Error("Sources writer generated an invalid v1 document");
  }
  return decoded.right;
}

/**
 * Mints exactly one Run-owner-local blob per canonical source file. Inputs may
 * use CRLF or CR; the sealed fact and its SHA-256 always use LF-only UTF-8.
 */
export function createSourcesAttachmentWriteV1(
  input: SourcesAttachmentInputV1,
): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  SourcesAttachmentWriteErrorV1
> {
  const normalized = normalizeSourcesAttachmentInputV1(input);
  if (Either.isLeft(normalized)) return Either.left(normalized.left);

  const write = makeRecordAttachmentWrite(sourcesAttachmentFamilyV1, (blobs) => {
    const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
    const packages = normalized.right.packages.map((sourcePackage) => Object.freeze({
      packageItemId: sourcePackage.packageItemId,
      label: sourcePackage.label,
      files: Object.freeze(sourcePackage.files.map((file) => {
        const bytes = utf8BytesOfSourceTextV1(file.text);
        const draft = blobs.add(makeRecordBlobSource(Stream.succeed(bytes)));
        drafts.push(draft);
        return Object.freeze({
          fileItemId: file.fileItemId,
          path: file.path,
          sha256: sha256DigestOfCanonicalTextV1(file.text),
          blob: draft.ref,
        });
      })),
    }));
    const payload = requireSourcesDocumentV1(
      Object.freeze({ packages: Object.freeze(packages) }),
    );
    return Object.freeze({ payload, blobs: Object.freeze(drafts) });
  });
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("Sources writer generated an invalid RecordAttachment closure");
  }
  return Either.right(write);
}

function traceIdentity(trace: AssertionSourceSiteV1["trace"]): string {
  return JSON.stringify(trace);
}

function sortAssertionOccurrences(
  occurrences: readonly AssertionSourceOccurrenceV1[],
): readonly [AssertionSourceOccurrenceV1, ...AssertionSourceOccurrenceV1[]] {
  const sorted = [...occurrences].sort((left, right) => left.sourceOrder - right.sourceOrder);
  const [first, ...rest] = sorted;
  if (first === undefined) throw new Error("Source site must contain an occurrence");
  return Object.freeze([first, ...rest]);
}

function sortSendOccurrences(
  occurrences: readonly AssertionSourceSendOccurrenceV1[],
): readonly [AssertionSourceSendOccurrenceV1, ...AssertionSourceSendOccurrenceV1[]] {
  const sorted = [...occurrences].sort((left, right) => left.sourceOrder - right.sourceOrder);
  const [first, ...rest] = sorted;
  if (first === undefined) throw new Error("Send site must contain an occurrence");
  return Object.freeze([first, ...rest]);
}

function nonEmptySites(
  sites: readonly AssertionSourceSiteV1[],
): readonly [AssertionSourceSiteV1, ...AssertionSourceSiteV1[]] {
  const [first, ...rest] = sites;
  if (first === undefined) throw new Error("Assertion source-sites entry must contain a site");
  return Object.freeze([first, ...rest]);
}

function firstSourceOrder(
  site: AssertionSourceSiteV1 | AssertionSourceSendSiteV1,
): number {
  const first = site.occurrences[0];
  if (first === undefined) throw new Error("Source site must contain an occurrence");
  return first.sourceOrder;
}

function normalizeAssertionSourceSitesDocumentV1(
  input: AssertionSourceSitesDocumentV1,
): Either.Either<
  AssertionSourceSitesDocumentV1,
  AssertionSourceSitesAttachmentWriteErrorV1
> {
  const decoded = Schema.decodeUnknownEither(
    AssertionSourceSitesDocumentV1Schema,
    SourcesExactParseOptions,
  )(input);
  if (Either.isLeft(decoded)) return Either.left(sourceSitesInputInvalid());

  const sourceOrders = new Set<number>();
  const entryIds = new Set<string>();
  const entries: AssertionSourceSitesEntryV1[] = [];
  for (const entry of decoded.right.entries) {
    if (entryIds.has(entry.entryId)) return Either.left(sourceSitesInputInvalid());
    entryIds.add(entry.entryId);
    const traces = new Set<string>();
    const sites: AssertionSourceSiteV1[] = [];
    for (const site of entry.sites) {
      const trace = traceIdentity(site.trace);
      if (traces.has(trace)) return Either.left(sourceSitesInputInvalid());
      traces.add(trace);
      const occurrences = sortAssertionOccurrences(site.occurrences);
      for (const occurrence of occurrences) {
        if (sourceOrders.has(occurrence.sourceOrder)) return Either.left(sourceSitesInputInvalid());
        sourceOrders.add(occurrence.sourceOrder);
      }
      sites.push(Object.freeze({ trace: site.trace, occurrences }));
    }
    sites.sort((left, right) => firstSourceOrder(left) - firstSourceOrder(right));
    entries.push(Object.freeze({
      entryId: entry.entryId,
      sites: nonEmptySites(sites),
    }));
  }
  entries.sort((left, right) => compareIdentity(left.entryId, right.entryId));

  const sendSites: AssertionSourceSendSiteV1[] = [];
  for (const site of decoded.right.sendSites) {
    const occurrences = sortSendOccurrences(site.occurrences);
    for (const occurrence of occurrences) {
      if (sourceOrders.has(occurrence.sourceOrder)) return Either.left(sourceSitesInputInvalid());
      sourceOrders.add(occurrence.sourceOrder);
    }
    sendSites.push(Object.freeze({ trace: site.trace, occurrences }));
  }
  sendSites.sort((left, right) => firstSourceOrder(left) - firstSourceOrder(right));

  return Either.right(Object.freeze({
    entries: Object.freeze(entries),
    sendSites: Object.freeze(sendSites),
  }));
}

const noSourceSitesBlobDraftsV1: readonly [] = Object.freeze([]);

/**
 * Seals only facts which have already occurred. It canonicalizes ordering but
 * rejects duplicate durable entry/source identities rather than guessing a
 * merge for the producer.
 */
export function createAssertionSourceSitesAttachmentWriteV1(
  input: AssertionSourceSitesDocumentV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  AssertionSourceSitesAttachmentWriteErrorV1
> {
  const normalized = normalizeAssertionSourceSitesDocumentV1(input);
  if (Either.isLeft(normalized)) return Either.left(normalized.left);
  const write = makeRecordAttachmentWrite(
    assertionSourceSitesAttachmentFamilyV1,
    () => Object.freeze({ payload: normalized.right, blobs: noSourceSitesBlobDraftsV1 }),
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("Assertion source-sites writer generated an invalid RecordAttachment closure");
  }
  return Either.right(write);
}

export type SourcesAttachmentFamilyV1 = RecordAttachmentFamily<
  "run",
  SourcesDocumentV1<RecordBlobRef>
>;

export type AssertionSourceSitesAttachmentFamilyV1 = RecordAttachmentFamily<
  "attempt",
  AssertionSourceSitesDocumentV1
>;
