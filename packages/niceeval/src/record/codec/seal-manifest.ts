import { isAbsolute, normalize } from "node:path";
import { Either, Schema } from "effect";
import {
  defineRecordCore,
  type RecordJson,
  type RecordSchemaLimits,
} from "../definition/index.ts";
import type {
  RecordSchemaFailure,
  RecordSchemaWire,
} from "../definition/schema-codec.ts";
import { NiceEvalRecordFamilyDescriptorsByOwner } from "../family/catalog.ts";
import {
  PUBLISH_RECOVERY_FORMAT,
  SEAL_MANIFEST_FORMAT,
  type FixedRecordFamily,
  type ObservabilitySourceFamily,
  type RecordPublishRecoveryDocument,
  type SealManifestDocument,
  type SealManifestEntry,
  type SourceReceiptManifestEntry,
} from "../model/seal-manifest.ts";
import type { RecordId, Sha256Digest } from "../model/identifiers.ts";
import {
  AttemptIdSchema,
  CanonicalRunRelativePathSchema,
  RecordBlobKeySchema,
  RecordIdSchema,
  RunIdSchema,
  Sha256DigestSchema,
  SourceSegmentIdSchema,
} from "./identifiers.ts";

export const SealManifestDocumentLimits: RecordSchemaLimits = Object.freeze({
  maximumJsonBytes: 32 * 1024 * 1024,
  maximumDepth: 12,
  maximumNodes: 400_000,
  maximumObjectKeys: 32,
  maximumArrayItems: 100_000,
  maximumKeyUtf8Bytes: 256,
  maximumStringUtf8Bytes: 32 * 1024,
});

const NonNegativeSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
    {
      identifier: "RecordNonNegativeSafeInteger",
      description: "a non-negative JSON-safe integer",
    },
  ),
);

const PositiveSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
    {
      identifier: "RecordPositiveSafeInteger",
      description: "a positive JSON-safe integer",
    },
  ),
);

const FixedRecordFamilySchema: Schema.Schema<FixedRecordFamily> = Schema.Literal(
  "niceeval.assertions",
  "niceeval.agent-turns",
  "niceeval.turn-contexts",
  "niceeval.sandbox-commands",
  "niceeval.runner-activities",
  "niceeval.runner-diagnostics",
  "niceeval.file-changes",
  "niceeval.sources",
  "niceeval.artifacts",
);

const ObservabilitySourceFamilySchema: Schema.Schema<ObservabilitySourceFamily> =
  Schema.Literal(
    "niceeval.agent-turns",
    "niceeval.turn-contexts",
    "niceeval.sandbox-commands",
    "niceeval.runner-activities",
    "niceeval.runner-diagnostics",
  );

const RecordByteIdentitySchema = Schema.Struct({
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
});

const SealManifestEntrySchema = Schema.Struct({
  kind: Schema.Literal("core", "attachment-envelope", "payload", "blob"),
  path: CanonicalRunRelativePathSchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  owner: Schema.Union(Schema.Literal("run"), AttemptIdSchema),
  family: Schema.NullOr(FixedRecordFamilySchema),
});

const SourceReceiptManifestOwnerSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("run") }),
  Schema.Struct({ kind: Schema.Literal("attempt"), attemptId: AttemptIdSchema }),
);

const SourceReceiptSegmentIdentitySchema = Schema.Struct({
  sequence: PositiveSafeIntegerSchema,
  segmentId: SourceSegmentIdSchema,
});

const SourceReceiptBlobIdentitySchema = Schema.Struct({
  key: RecordBlobKeySchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
});

const SourceReceiptManifestEntrySchema = Schema.Struct({
  owner: SourceReceiptManifestOwnerSchema,
  family: ObservabilitySourceFamilySchema,
  schemaVersion: PositiveSafeIntegerSchema,
  payload: RecordByteIdentitySchema,
  segments: Schema.Array(SourceReceiptSegmentIdentitySchema),
  blobs: Schema.Array(SourceReceiptBlobIdentitySchema),
});

function manifestIssue(path: readonly PropertyKey[], message: string): Schema.FilterIssue {
  return { path, message };
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sourceOwnerText(owner: SourceReceiptManifestEntry["owner"]): string {
  return owner.kind === "run" ? "run" : owner.attemptId;
}

function sourceOwnerSortKey(owner: SourceReceiptManifestEntry["owner"]): string {
  return owner.kind === "run" ? "0" : `1:${owner.attemptId}`;
}

function attachmentKey(owner: "run" | string, family: string): string {
  return `${owner}\u0000${family}`;
}

function attachmentBase(owner: "run" | string, family: string): string {
  return owner === "run"
    ? `attachments/${family}`
    : `attempts/${owner}/attachments/${family}`;
}

function familyAllowsOwner(family: FixedRecordFamily, owner: "run" | string): boolean {
  switch (family) {
    case "niceeval.assertions":
    case "niceeval.agent-turns":
    case "niceeval.turn-contexts":
    case "niceeval.sandbox-commands":
    case "niceeval.file-changes":
      return owner !== "run";
    case "niceeval.sources":
      return owner === "run";
    case "niceeval.runner-activities":
    case "niceeval.runner-diagnostics":
    case "niceeval.artifacts":
      return true;
  }
}

function isSourceFamily(family: FixedRecordFamily): family is ObservabilitySourceFamily {
  return family === "niceeval.agent-turns" ||
    family === "niceeval.turn-contexts" ||
    family === "niceeval.sandbox-commands" ||
    family === "niceeval.runner-activities" ||
    family === "niceeval.runner-diagnostics";
}

interface AttachmentInventory {
  envelope: SealManifestEntry | undefined;
  payload: SealManifestEntry | undefined;
  readonly blobs: SealManifestEntry[];
}

function validateCoreEntry(
  entry: SealManifestEntry,
  path: readonly PropertyKey[],
): readonly Schema.FilterIssue[] {
  if (entry.kind !== "core" || entry.family !== null) {
    return [manifestIssue(path, "seal-entry-core-shape-invalid")];
  }
  if (entry.path === "run.json") {
    return entry.owner === "run"
      ? []
      : [manifestIssue([...path, "owner"], "seal-entry-core-owner-invalid")];
  }
  const segments = entry.path.split("/");
  if (
    segments.length === 2 &&
    segments[0] === "members" &&
    segments[1]!.endsWith(".json")
  ) {
    return entry.owner === "run"
      ? []
      : [manifestIssue([...path, "owner"], "seal-entry-core-owner-invalid")];
  }
  if (
    segments.length === 3 &&
    segments[0] === "attempts" &&
    segments[2] === "attempt.json"
  ) {
    return segments[1] !== "run" && entry.owner === segments[1]
      ? []
      : [manifestIssue([...path, "owner"], "seal-entry-core-owner-invalid")];
  }
  return [manifestIssue([...path, "path"], "seal-entry-core-path-invalid")];
}

function validateAttachmentEntry(
  entry: SealManifestEntry,
  path: readonly PropertyKey[],
): readonly Schema.FilterIssue[] {
  if (entry.family === null || entry.kind === "core") {
    return [manifestIssue(path, "seal-entry-attachment-shape-invalid")];
  }
  if (!familyAllowsOwner(entry.family, entry.owner)) {
    return [manifestIssue([...path, "owner"], "seal-entry-family-owner-invalid")];
  }
  const base = attachmentBase(entry.owner, entry.family);
  const validPath = entry.kind === "attachment-envelope"
    ? `${base}/attachment.json`
    : entry.kind === "payload"
    ? `${base}/payload.json`
    : entry.path.startsWith(`${base}/blobs/`) &&
      entry.path.slice(`${base}/blobs/`.length).length > 0 &&
      !entry.path.slice(`${base}/blobs/`.length).includes("/");
  return validPath
    ? []
    : [manifestIssue([...path, "path"], "seal-entry-attachment-path-invalid")];
}

function validateEntries(
  entries: readonly SealManifestEntry[],
): readonly Schema.FilterIssue[] {
  const issues: Schema.FilterIssue[] = [];
  const attachments = new Map<string, AttachmentInventory>();
  let previousPath: string | undefined;
  let hasRunDocument = false;

  entries.forEach((entry, index) => {
    const path: readonly PropertyKey[] = ["entries", index];
    if (previousPath !== undefined && compareText(previousPath, entry.path) >= 0) {
      issues.push(manifestIssue([...path, "path"], "seal-entry-order-invalid"));
    }
    previousPath = entry.path;
    if (entry.family === null || entry.kind === "core") {
      issues.push(...validateCoreEntry(entry, path));
      if (entry.path === "run.json") hasRunDocument = true;
      return;
    }

    issues.push(...validateAttachmentEntry(entry, path));
    const key = attachmentKey(entry.owner, entry.family);
    const inventory = attachments.get(key) ?? {
      envelope: undefined,
      payload: undefined,
      blobs: [],
    };
    if (entry.kind === "attachment-envelope") {
      if (inventory.envelope !== undefined) {
        issues.push(manifestIssue(path, "seal-entry-envelope-duplicate"));
      }
      inventory.envelope = entry;
    } else if (entry.kind === "payload") {
      if (inventory.payload !== undefined) {
        issues.push(manifestIssue(path, "seal-entry-payload-duplicate"));
      }
      inventory.payload = entry;
    } else if (entry.kind === "blob") {
      inventory.blobs.push(entry);
    }
    attachments.set(key, inventory);
  });

  if (!hasRunDocument) {
    issues.push(manifestIssue(["entries"], "seal-entry-run-document-missing"));
  }
  for (const inventory of attachments.values()) {
    if (inventory.envelope === undefined) {
      issues.push(manifestIssue(["entries"], "seal-entry-envelope-missing"));
    }
    if (inventory.payload === undefined) {
      issues.push(manifestIssue(["entries"], "seal-entry-payload-missing"));
    }
  }
  return issues;
}

function sourceKey(source: SourceReceiptManifestEntry): string {
  return attachmentKey(sourceOwnerText(source.owner), source.family);
}

function fixedSourceSchemaVersions(
  source: SourceReceiptManifestEntry,
): ReadonlySet<number> {
  const descriptors = source.owner.kind === "run"
    ? NiceEvalRecordFamilyDescriptorsByOwner.run
    : NiceEvalRecordFamilyDescriptorsByOwner.attempt;
  const descriptor = descriptors.find((candidate) => candidate.family === source.family);
  return new Set(descriptor === undefined
    ? []
    : [
        descriptor.schemaVersion,
        ...descriptor.adjacentMigrationLinks.map((link) => link.fromSchemaVersion),
      ]);
}

function validateSources(
  entries: readonly SealManifestEntry[],
  sources: readonly SourceReceiptManifestEntry[],
): readonly Schema.FilterIssue[] {
  const issues: Schema.FilterIssue[] = [];
  const sourceByKey = new Map<string, SourceReceiptManifestEntry>();
  let previousSourceKey: string | undefined;

  sources.forEach((source, sourceIndex) => {
    const path: readonly PropertyKey[] = ["sources", sourceIndex];
    const owner = sourceOwnerText(source.owner);
    const orderedKey = `${sourceOwnerSortKey(source.owner)}\u0000${source.family}`;
    if (previousSourceKey !== undefined && compareText(previousSourceKey, orderedKey) >= 0) {
      issues.push(manifestIssue(path, "seal-source-order-invalid"));
    }
    previousSourceKey = orderedKey;
    if (!familyAllowsOwner(source.family, owner)) {
      issues.push(manifestIssue([...path, "owner"], "seal-source-owner-invalid"));
    }
    if (source.owner.kind === "attempt" && source.owner.attemptId === "run") {
      issues.push(manifestIssue([...path, "owner"], "seal-source-owner-ambiguous"));
    }
    if (!fixedSourceSchemaVersions(source).has(source.schemaVersion)) {
      issues.push(manifestIssue([...path, "schemaVersion"], "seal-source-version-invalid"));
    }

    const key = sourceKey(source);
    if (sourceByKey.has(key)) {
      issues.push(manifestIssue(path, "seal-source-duplicate"));
    }
    sourceByKey.set(key, source);

    const segmentIds = new Set<string>();
    source.segments.forEach((segment, segmentIndex) => {
      const segmentPath = [...path, "segments", segmentIndex];
      if (segment.sequence !== segmentIndex + 1) {
        issues.push(manifestIssue(segmentPath, "seal-source-segment-order-invalid"));
      }
      if (segmentIds.has(segment.segmentId)) {
        issues.push(manifestIssue(segmentPath, "seal-source-segment-duplicate"));
      }
      segmentIds.add(segment.segmentId);
    });

    let previousBlobKey: string | undefined;
    const blobKeys = new Set<string>();
    source.blobs.forEach((blob, blobIndex) => {
      const blobPath = [...path, "blobs", blobIndex];
      if (previousBlobKey !== undefined && compareText(previousBlobKey, blob.key) >= 0) {
        issues.push(manifestIssue(blobPath, "seal-source-blob-order-invalid"));
      }
      previousBlobKey = blob.key;
      if (blobKeys.has(blob.key)) {
        issues.push(manifestIssue(blobPath, "seal-source-blob-duplicate"));
      }
      blobKeys.add(blob.key);
    });
    if (
      source.family !== "niceeval.sandbox-commands" &&
      source.blobs.length > 0
    ) {
      issues.push(manifestIssue([...path, "blobs"], "seal-source-blob-owner-invalid"));
    }
  });

  const manifestEntries = new Map<string, SealManifestEntry>(
    entries.map((entry) => [entry.path, entry]),
  );
  const sourceAttachmentKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.family !== null && isSourceFamily(entry.family)) {
      sourceAttachmentKeys.add(attachmentKey(entry.owner, entry.family));
    }
  }

  for (const [key, source] of sourceByKey) {
    const owner = sourceOwnerText(source.owner);
    const base = attachmentBase(owner, source.family);
    const envelope = manifestEntries.get(`${base}/attachment.json`);
    const payload = manifestEntries.get(`${base}/payload.json`);
    if (envelope?.kind !== "attachment-envelope") {
      issues.push(manifestIssue(["sources"], "seal-source-envelope-missing"));
    }
    if (
      payload?.kind !== "payload" ||
      payload.byteLength !== source.payload.byteLength ||
      payload.sha256 !== source.payload.sha256
    ) {
      issues.push(manifestIssue(["sources"], "seal-source-payload-identity-mismatch"));
    }

    const declaredBlobPaths = new Set<string>();
    for (const blob of source.blobs) {
      const blobPath = `${base}/blobs/${blob.key}`;
      declaredBlobPaths.add(blobPath);
      const entry = manifestEntries.get(blobPath);
      if (
        entry?.kind !== "blob" ||
        entry.byteLength !== blob.byteLength ||
        entry.sha256 !== blob.sha256
      ) {
        issues.push(manifestIssue(["sources"], "seal-source-blob-identity-mismatch"));
      }
    }
    for (const entry of entries) {
      if (
        entry.owner === owner &&
        entry.family === source.family &&
        entry.kind === "blob" &&
        !declaredBlobPaths.has(entry.path)
      ) {
        issues.push(manifestIssue(["sources"], "seal-source-blob-inventory-mismatch"));
      }
    }
    sourceAttachmentKeys.delete(key);
  }

  if (sourceAttachmentKeys.size > 0) {
    issues.push(manifestIssue(["sources"], "seal-source-inventory-missing"));
  }
  return issues;
}

/**
 * Ordinary publication validation keeps source rows opaque. Their schema,
 * canonical identities, and cross-table closure are validated only when that
 * exact owner/family is requested, so one damaged source cannot hide Core or
 * an unrelated source.
 */
export interface SealManifestPublicationDocument {
  readonly format: typeof SEAL_MANIFEST_FORMAT;
  readonly runId: SealManifestDocument["runId"];
  readonly entries: readonly SealManifestEntry[];
  readonly sources: readonly unknown[];
}

const SealManifestPublicationSourceJsonSchema: Schema.Schema<RecordJson> = Schema.suspend(
  () => Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.JsonNumber,
    Schema.String,
    Schema.Array(SealManifestPublicationSourceJsonSchema),
    Schema.Record({ key: Schema.String, value: SealManifestPublicationSourceJsonSchema }),
  ),
);

const SealManifestPublicationCurrentSchema = Schema.Struct({
  format: Schema.Literal(SEAL_MANIFEST_FORMAT),
  runId: RunIdSchema,
  entries: Schema.Array(SealManifestEntrySchema),
  sources: Schema.Array(SealManifestPublicationSourceJsonSchema),
}).pipe(
  Schema.filter(
    (value) => {
      const issues = validateEntries(value.entries);
      return issues.length === 0 ? undefined : issues;
    },
    {
      identifier: "SealManifestPublicationInvariant",
      description: "a canonical Run publication and Core/Attachment byte inventory",
    },
  ),
);

const SealManifestCurrentSchema = Schema.Struct({
  format: Schema.Literal(SEAL_MANIFEST_FORMAT),
  runId: RunIdSchema,
  entries: Schema.Array(SealManifestEntrySchema),
  sources: Schema.Array(SourceReceiptManifestEntrySchema),
}).pipe(
  Schema.filter(
    (value) => {
      const issues = [
        ...validateEntries(value.entries),
        ...validateSources(value.entries, value.sources),
      ];
      return issues.length === 0 ? undefined : issues;
    },
    {
      identifier: "SealManifestInvariant",
      description: "a canonical closed source-first Run publication inventory",
    },
  ),
);

function isCanonicalHostPath(value: string): boolean {
  return value.length > 0 &&
    value.length <= 32 * 1024 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    isAbsolute(value) &&
    normalize(value) === value;
}

const CanonicalHostPathSchema = Schema.String.pipe(
  Schema.filter(isCanonicalHostPath, {
    identifier: "RecordCanonicalHostPath",
    description: "a normalized absolute host path in local recovery state",
  }),
);

const PublishRecoveryCurrentSchema = Schema.Struct({
  format: Schema.Literal(PUBLISH_RECOVERY_FORMAT),
  version: Schema.Literal(1),
  recordId: RecordIdSchema,
  runId: RunIdSchema,
  stagingPath: CanonicalHostPathSchema,
  destinationPath: CanonicalHostPathSchema,
  sealManifestSha256: Sha256DigestSchema,
  inventory: Schema.Array(SealManifestEntrySchema),
}).pipe(
  Schema.filter(
    (value) => {
      const issues = validateEntries(value.inventory).map((issue) => ({
        ...issue,
        path: ["inventory", ...(issue.path ?? []).slice(1)],
      }));
      return issues.length === 0 ? undefined : issues;
    },
    {
      identifier: "RecordPublishRecoveryInvariant",
      description: "a canonical local publish recovery binding and full inventory",
    },
  ),
);

export const SealManifestDefinition = defineRecordCore({
  schema: SealManifestCurrentSchema,
  limits: SealManifestDocumentLimits,
});

export const SealManifestPublicationDefinition = defineRecordCore({
  schema: SealManifestPublicationCurrentSchema,
  limits: SealManifestDocumentLimits,
});

const SourceReceiptManifestEntryDefinition = defineRecordCore({
  schema: SourceReceiptManifestEntrySchema,
  limits: SealManifestDocumentLimits,
});

export const RecordPublishRecoveryDefinition = defineRecordCore({
  schema: PublishRecoveryCurrentSchema,
  limits: SealManifestDocumentLimits,
});

export const SealManifestSchema = SealManifestDefinition.schema;
export const SealManifestPublicationSchema = SealManifestPublicationDefinition.schema;
export const RecordPublishRecoverySchema = RecordPublishRecoveryDefinition.schema;

export function decodeSealManifestDocument(
  input: unknown,
): Either.Either<SealManifestDocument, RecordSchemaFailure> {
  return SealManifestDefinition.decode(input);
}

export function decodeSealManifestPublicationDocument(
  input: unknown,
): Either.Either<SealManifestPublicationDocument, RecordSchemaFailure> {
  return SealManifestPublicationDefinition.decode(input);
}

export function decodeSourceReceiptManifestEntry(
  input: unknown,
): Either.Either<SourceReceiptManifestEntry, RecordSchemaFailure> {
  return SourceReceiptManifestEntryDefinition.decode(input);
}

export function encodeSealManifestDocument(
  value: SealManifestDocument,
): Either.Either<RecordSchemaWire, RecordSchemaFailure> {
  return SealManifestDefinition.encode(value);
}

export function decodeRecordPublishRecoveryDocument(
  input: unknown,
): Either.Either<RecordPublishRecoveryDocument, RecordSchemaFailure> {
  return RecordPublishRecoveryDefinition.decode(input);
}

export function encodeRecordPublishRecoveryDocument(
  value: RecordPublishRecoveryDocument,
): Either.Either<RecordSchemaWire, RecordSchemaFailure> {
  return RecordPublishRecoveryDefinition.encode(value);
}

function sameManifestEntry(left: SealManifestEntry, right: SealManifestEntry): boolean {
  return left.kind === right.kind &&
    left.path === right.path &&
    left.byteLength === right.byteLength &&
    left.sha256 === right.sha256 &&
    left.owner === right.owner &&
    left.family === right.family;
}

/** Rechecks every local binding before recovery retries or accepts a publish. */
export function recordPublishRecoveryMatches(input: {
  readonly recovery: RecordPublishRecoveryDocument;
  readonly recordId: RecordId;
  readonly sealManifest: SealManifestDocument;
  readonly sealManifestSha256: Sha256Digest;
  readonly stagingPath: string;
  readonly destinationPath: string;
}): boolean {
  return input.recovery.recordId === input.recordId &&
    input.recovery.runId === input.sealManifest.runId &&
    input.recovery.sealManifestSha256 === input.sealManifestSha256 &&
    input.recovery.stagingPath === input.stagingPath &&
    input.recovery.destinationPath === input.destinationPath &&
    input.recovery.inventory.length === input.sealManifest.entries.length &&
    input.recovery.inventory.every((entry, index) =>
      sameManifestEntry(entry, input.sealManifest.entries[index]!)
    );
}
