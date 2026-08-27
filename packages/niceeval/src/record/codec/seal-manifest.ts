import { isAbsolute, normalize } from "node:path";
import { Result, Schema } from "effect";

import {
  defineRecordCore,
  type RecordJson,
  type RecordSchemaLimits,
} from "../definition/index.ts";
import type {
  RecordSchemaFailure,
  RecordSchemaWire,
} from "../definition/schema-codec.ts";
import {
  PUBLISH_RECOVERY_FORMAT,
  SEAL_MANIFEST_FORMAT,
  type RecordPublishRecoveryDocument,
  type SealManifestDocument,
  type SealManifestEntry,
} from "../model/seal-manifest.ts";
import { isRecordAttachmentName } from "../model/identifiers.ts";
import type { RecordId, Sha256Digest } from "../model/identifiers.ts";
import {
  AttemptIdSchema,
  CanonicalRunRelativePathSchema,
  RecordIdSchema,
  RunIdSchema,
  Sha256DigestSchema,
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

const NonNegativeSafeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);

const SealManifestEntrySchema = Schema.Struct({
  kind: Schema.Literals(["core", "attachment-envelope", "payload", "blob"]),
  path: CanonicalRunRelativePathSchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  owner: Schema.Union([Schema.Literals(["run"]), AttemptIdSchema]),
  family: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.makeFilter(isRecordAttachmentName)))),
});

function manifestIssue(path: readonly PropertyKey[], message: string): Schema.FilterIssue {
  return { path, issue: message };
}

function attachmentBase(owner: "run" | string, family: string): string {
  return owner === "run"
    ? `attachments/${family}`
    : `attempts/${owner}/attachments/${family}`;
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
  if (segments.length === 2 && segments[0] === "members" && segments[1]!.endsWith(".json")) {
    return entry.owner === "run"
      ? []
      : [manifestIssue([...path, "owner"], "seal-entry-core-owner-invalid")];
  }
  if (segments.length === 3 && segments[0] === "attempts" && segments[2] === "attempt.json") {
    return segments[1] !== "run" && entry.owner === segments[1]
      ? []
      : [manifestIssue([...path, "owner"], "seal-entry-core-owner-invalid")];
  }
  return [manifestIssue([...path, "path"], "seal-entry-core-path-invalid")];
}

function validateCurrentAttachmentEntry(
  entry: SealManifestEntry,
  path: readonly PropertyKey[],
): readonly Schema.FilterIssue[] {
  if (entry.family === null || entry.kind === "core") {
    return [manifestIssue(path, "seal-entry-attachment-shape-invalid")];
  }
  const base = attachmentBase(entry.owner, entry.family);
  const validPath = entry.kind === "attachment-envelope"
    ? entry.path === `${base}/attachment.json`
    : entry.kind === "payload"
    ? entry.path === `${base}/payload/sha256/${entry.sha256}`
    : entry.path === `${base}/content/sha256/${entry.sha256}`;
  return validPath ? [] : [manifestIssue([...path, "path"], "seal-entry-attachment-path-invalid")];
}

function validateLegacyAttachmentEntry(
  entry: SealManifestEntry,
  path: readonly PropertyKey[],
): readonly Schema.FilterIssue[] {
  if (entry.family === null || entry.kind === "core") {
    return [manifestIssue(path, "seal-entry-attachment-shape-invalid")];
  }
  const base = attachmentBase(entry.owner, entry.family);
  const validPath = entry.kind === "attachment-envelope"
    ? entry.path === `${base}/attachment.json`
    : entry.kind === "payload"
    ? entry.path === `${base}/payload.json`
    : entry.path.startsWith(`${base}/blobs/`) &&
      entry.path.slice(`${base}/blobs/`.length).length > 0 &&
      !entry.path.slice(`${base}/blobs/`.length).includes("/");
  return validPath ? [] : [manifestIssue([...path, "path"], "seal-entry-attachment-path-invalid")];
}

function validateEntries(
  entries: readonly SealManifestEntry[],
  attachment: (entry: SealManifestEntry, path: readonly PropertyKey[]) => readonly Schema.FilterIssue[],
): readonly Schema.FilterIssue[] {
  const issues: Schema.FilterIssue[] = [];
  const inventory = new Map<string, { envelope: number; payload: number }>();
  let previousPath: string | undefined;
  let hasRunDocument = false;
  entries.forEach((entry, index) => {
    const path: readonly PropertyKey[] = ["entries", index];
    if (previousPath !== undefined && previousPath >= entry.path) {
      issues.push(manifestIssue([...path, "path"], "seal-entry-order-invalid"));
    }
    previousPath = entry.path;
    if (entry.family === null || entry.kind === "core") {
      issues.push(...validateCoreEntry(entry, path));
      if (entry.path === "run.json") hasRunDocument = true;
      return;
    }
    issues.push(...attachment(entry, path));
    const key = `${entry.owner}\u0000${entry.family}`;
    const counts = inventory.get(key) ?? { envelope: 0, payload: 0 };
    if (entry.kind === "attachment-envelope") counts.envelope += 1;
    if (entry.kind === "payload") counts.payload += 1;
    inventory.set(key, counts);
  });
  if (!hasRunDocument) issues.push(manifestIssue(["entries"], "seal-entry-run-document-missing"));
  for (const counts of inventory.values()) {
    if (counts.envelope !== 1) issues.push(manifestIssue(["entries"], "seal-entry-envelope-count-invalid"));
    if (counts.payload !== 1) issues.push(manifestIssue(["entries"], "seal-entry-payload-count-invalid"));
  }
  return issues;
}

const SealManifestCurrentSchema = Schema.Struct({
  format: Schema.Literals([SEAL_MANIFEST_FORMAT]),
  runId: RunIdSchema,
  entries: Schema.Array(SealManifestEntrySchema),
}).pipe(Schema.check(Schema.makeFilter((value) => {
  const issues = validateEntries(value.entries, validateCurrentAttachmentEntry);
  return issues.length === 0 ? undefined : issues;
})));

const JsonSchema: Schema.Codec<RecordJson> = Schema.suspend(() => Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Number,
  Schema.String,
  Schema.Array(JsonSchema),
  Schema.Record(Schema.String, JsonSchema),
]));

export interface LegacySealManifestDocument {
  readonly format: typeof SEAL_MANIFEST_FORMAT;
  readonly runId: SealManifestDocument["runId"];
  readonly entries: readonly SealManifestEntry[];
  readonly sources: readonly RecordJson[];
}

const LegacySealManifestSchema = Schema.Struct({
  format: Schema.Literals([SEAL_MANIFEST_FORMAT]),
  runId: RunIdSchema,
  entries: Schema.Array(SealManifestEntrySchema),
  sources: Schema.Array(JsonSchema),
}).pipe(Schema.check(Schema.makeFilter((value) => {
  const issues = validateEntries(value.entries, validateLegacyAttachmentEntry);
  return issues.length === 0 ? undefined : issues;
})));

function isCanonicalHostPath(value: string): boolean {
  return value.length > 0 && value.length <= 32 * 1024 &&
    !/[\u0000-\u001f\u007f]/.test(value) && isAbsolute(value) && normalize(value) === value;
}

const CanonicalHostPathSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isCanonicalHostPath)));

const PublishRecoveryCurrentSchema = Schema.Struct({
  format: Schema.Literals([PUBLISH_RECOVERY_FORMAT]),
  version: Schema.Literals([1]),
  recordId: RecordIdSchema,
  runId: RunIdSchema,
  stagingPath: CanonicalHostPathSchema,
  destinationPath: CanonicalHostPathSchema,
  sealManifestSha256: Sha256DigestSchema,
  inventory: Schema.Array(SealManifestEntrySchema),
}).pipe(Schema.check(Schema.makeFilter((value) => {
  const issues = validateEntries(value.inventory, validateCurrentAttachmentEntry).map((issue) => ({
    path: ["inventory", ...(typeof issue === "object" && "path" in issue ? issue.path.slice(1) : [])],
    issue: typeof issue === "object" && "issue" in issue ? issue.issue : issue,
  }));
  return issues.length === 0 ? undefined : issues;
})));

export const SealManifestDefinition = defineRecordCore({
  schema: SealManifestCurrentSchema,
  limits: SealManifestDocumentLimits,
});

export const SealManifestPublicationDefinition = SealManifestDefinition;

const LegacySealManifestDefinition = defineRecordCore({
  schema: LegacySealManifestSchema,
  limits: SealManifestDocumentLimits,
});

export const RecordPublishRecoveryDefinition = defineRecordCore({
  schema: PublishRecoveryCurrentSchema,
  limits: SealManifestDocumentLimits,
});

export const SealManifestSchema = SealManifestDefinition.schema;
export const SealManifestPublicationSchema = SealManifestDefinition.schema;
export const RecordPublishRecoverySchema = RecordPublishRecoveryDefinition.schema;

export type SealManifestPublicationDocument = SealManifestDocument;

export function decodeSealManifestDocument(
  input: unknown,
): Result.Result<SealManifestDocument, RecordSchemaFailure> {
  return SealManifestDefinition.decode(input);
}

export const decodeSealManifestPublicationDocument = decodeSealManifestDocument;

export function decodeLegacySealManifestDocument(
  input: unknown,
): Result.Result<LegacySealManifestDocument, RecordSchemaFailure> {
  return LegacySealManifestDefinition.decode(input);
}

export function encodeSealManifestDocument(
  value: SealManifestDocument,
): Result.Result<RecordSchemaWire, RecordSchemaFailure> {
  return SealManifestDefinition.encode(value);
}

export function decodeRecordPublishRecoveryDocument(
  input: unknown,
): Result.Result<RecordPublishRecoveryDocument, RecordSchemaFailure> {
  return RecordPublishRecoveryDefinition.decode(input);
}

export function encodeRecordPublishRecoveryDocument(
  value: RecordPublishRecoveryDocument,
): Result.Result<RecordSchemaWire, RecordSchemaFailure> {
  return RecordPublishRecoveryDefinition.encode(value);
}

function sameManifestEntry(left: SealManifestEntry, right: SealManifestEntry): boolean {
  return left.kind === right.kind && left.path === right.path &&
    left.byteLength === right.byteLength && left.sha256 === right.sha256 &&
    left.owner === right.owner && left.family === right.family;
}

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
      sameManifestEntry(entry, input.sealManifest.entries[index]!));
}
