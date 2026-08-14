import { Effect, Either } from "effect";
import {
  makeFixedRecordAttachmentValue,
  makeRecordBlobRef,
  type RecordAttachmentMaterializedBlob,
} from "../attachment/internal.ts";
import type {
  RecordAttachmentBlobs,
  RecordAttachmentPayloadSnapshot,
  RecordBlobRef,
} from "../attachment/types.ts";
import { decodeRecordAttachmentEnvelope } from "../codec/core.ts";
import type {
  FixedRecordFamilyDescriptor,
} from "../family/catalog.ts";
import type { NiceEvalFamily } from "../family/common.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import type { AttemptId, RunId } from "../model/identifiers.ts";
import {
  nonEmptyRecordIssues,
  recordIssue,
  type NonEmptyRecordIssues,
} from "../errors/record-errors.ts";
import {
  RecordPathTypeInvalid,
  type RecordFileSystemError,
} from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import {
  recordPortablePath,
  type RecordDirectoryEntry,
  type RecordFileSystemService,
} from "../platform/services.ts";
import { isPortableSegment } from "../model/identifiers.ts";

/** Fixed readers materialize a family only when its explicit method is called. */
export const RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_ENTRIES = 100_000;
export const RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_BYTES = 64 * 1024 * 1024;
export const RECORD_READER_MAXIMUM_ATTACHMENT_TOTAL_BYTES = 128 * 1024 * 1024;
export const RECORD_READER_MAXIMUM_ATTACHMENT_DOCUMENT_BYTES = 16 * 1024 * 1024;

/** The storage-side ref codec reserves this exact one-property JSON object. */
export const RECORD_DURABLE_BLOB_REF_KEY = "$niceeval.record.blob";

type JsonDocument =
  | { readonly state: "available"; readonly value: unknown }
  | { readonly state: "missing" }
  | { readonly state: "invalid" };

type BlobDirectory =
  | { readonly state: "available"; readonly entries: readonly RecordDirectoryEntry[] }
  | { readonly state: "missing" }
  | { readonly state: "invalid" };

interface HydratedPayload {
  readonly value: unknown;
  readonly refsByKey: ReadonlyMap<string, RecordBlobRef>;
  readonly invalid: boolean;
}

export interface FixedRecordAttachmentLocation<Owner extends RecordAttachmentOwner> {
  readonly owner: Owner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
}

/** @internal Storage result already flattened for the Host current API. */
export type FixedRecordAttachmentRead<Payload> =
  | {
      readonly state: "available";
      readonly value: RecordAttachmentPayloadSnapshot<Payload>;
      readonly blobs: RecordAttachmentBlobs;
    }
  | { readonly state: "unavailable" }
  | {
      readonly state: "migration-required";
      readonly family: string;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
      readonly command: "niceeval migrate";
    }
  | { readonly state: "unsupported"; readonly family: string; readonly schemaVersion: number }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues };

function attachmentInvalid<Payload>(
  path: readonly string[],
): FixedRecordAttachmentRead<Payload> {
  const issues = nonEmptyRecordIssues([recordIssue("record-schema-invalid", path)]);
  if (issues === undefined) throw new Error("Attachment invalid state requires one issue");
  return Object.freeze({ state: "invalid" as const, issues });
}

function attachmentPath(
  root: RecordRoot,
  location: FixedRecordAttachmentLocation<RecordAttachmentOwner>,
  family: string,
  ...segments: readonly string[]
) {
  return location.owner === "run"
    ? recordPortablePath(root, "runs", location.runId, "attachments", family, ...segments)
    : recordPortablePath(
        root,
        "runs",
        location.runId,
        "attempts",
        location.attemptId!,
        "attachments",
        family,
        ...segments,
      );
}

function parseJson(bytes: Uint8Array): JsonDocument {
  try {
    return Object.freeze({
      state: "available" as const,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    });
  } catch {
    return Object.freeze({ state: "invalid" as const });
  }
}

function readJson(
  fileSystem: RecordFileSystemService,
  file: ReturnType<typeof recordPortablePath>,
): Effect.Effect<JsonDocument, RecordFileSystemError> {
  return fileSystem.readFile({ file, maximumBytes: RECORD_READER_MAXIMUM_ATTACHMENT_DOCUMENT_BYTES }).pipe(
    Effect.map((bytes) => bytes === undefined ? Object.freeze({ state: "missing" as const }) : parseJson(bytes)),
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(Object.freeze({ state: "invalid" as const }))),
  );
}

function stableEntries(entries: readonly RecordDirectoryEntry[]): readonly RecordDirectoryEntry[] | undefined {
  if (!entries.every((entry) => entry.kind === "file" && isPortableSegment(entry.name))) return undefined;
  const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  return new Set(sorted.map((entry) => entry.name)).size === sorted.length ? Object.freeze(sorted) : undefined;
}

function readBlobDirectory(
  fileSystem: RecordFileSystemService,
  directory: ReturnType<typeof recordPortablePath>,
  maximumEntries: number,
): Effect.Effect<BlobDirectory, RecordFileSystemError> {
  return fileSystem.pathKind(directory).pipe(
    Effect.flatMap((kind): Effect.Effect<BlobDirectory, RecordFileSystemError> => {
      if (kind === "missing") return Effect.succeed<BlobDirectory>(Object.freeze({ state: "missing" as const }));
      if (kind !== "directory") return Effect.succeed<BlobDirectory>(Object.freeze({ state: "invalid" as const }));
      return fileSystem.listDirectory({
        directory,
        maximumEntries: Math.min(RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_ENTRIES, maximumEntries),
      }).pipe(
        Effect.map((entries): BlobDirectory => {
          const stable = stableEntries(entries);
          return stable === undefined
            ? Object.freeze({ state: "invalid" as const })
            : Object.freeze({ state: "available" as const, entries: stable });
        }),
      );
    }),
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed<BlobDirectory>(Object.freeze({ state: "invalid" as const }))),
  );
}

function hydrateDurablePayload(input: unknown): HydratedPayload {
  const refsByKey = new Map<string, RecordBlobRef>();
  let invalid = false;
  const hydrate = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(hydrate);
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    if (keys.length === 1 && keys[0] === RECORD_DURABLE_BLOB_REF_KEY) {
      const key = source[RECORD_DURABLE_BLOB_REF_KEY];
      if (typeof key !== "string" || !isPortableSegment(key)) {
        invalid = true;
        return source;
      }
      const prior = refsByKey.get(key);
      if (prior !== undefined) return prior;
      const ref = makeRecordBlobRef();
      refsByKey.set(key, ref);
      return ref;
    }
    const clone: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) clone[key] = hydrate(source[key]);
    return clone;
  };
  try {
    return Object.freeze({ value: hydrate(input), refsByKey, invalid });
  } catch {
    return Object.freeze({ value: input, refsByKey, invalid: true });
  }
}

function readBlob(
  fileSystem: RecordFileSystemService,
  file: ReturnType<typeof recordPortablePath>,
  maximumBytes: number,
): Effect.Effect<Uint8Array | undefined, RecordFileSystemError> {
  return fileSystem.readFile({
    file,
    maximumBytes: Math.min(RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_BYTES, maximumBytes),
  }).pipe(
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)),
    Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(undefined)),
  );
}

function hasReachableAdjacentMigration<
  Family extends NiceEvalFamily,
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  descriptor: FixedRecordFamilyDescriptor<Family, Owner, Payload>,
  fromSchemaVersion: number,
): boolean {
  if (fromSchemaVersion >= descriptor.schemaVersion) return false;
  let version = fromSchemaVersion;
  while (version < descriptor.schemaVersion) {
    const step = descriptor.adjacentMigrationLinks.find(
      (link) => link.fromSchemaVersion === version && link.toSchemaVersion === version + 1,
    );
    if (step === undefined) return false;
    version = step.toSchemaVersion;
  }
  return true;
}

/**
 * Reads precisely one known static family. Unknown sibling directories are
 * intentionally neither enumerated nor decoded, so future independent
 * families remain preserved and ignored by the normal graph.
 */
export function readFixedRecordAttachment<
  Family extends NiceEvalFamily,
  Owner extends RecordAttachmentOwner,
  Payload,
>(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: FixedRecordAttachmentLocation<Owner>;
  readonly descriptor: FixedRecordFamilyDescriptor<Family, Owner, Payload>;
}): Effect.Effect<FixedRecordAttachmentRead<Payload>, RecordFileSystemError> {
  return Effect.gen(function* () {
    const directory = attachmentPath(input.root, input.location, input.descriptor.family);
    const kind = yield* input.fileSystem.pathKind(directory);
    if (kind === "missing") return Object.freeze({ state: "unavailable" as const });
    if (kind !== "directory") return attachmentInvalid<Payload>(["attachment"]);

    const envelopeDocument = yield* readJson(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "attachment.json"),
    );
    if (envelopeDocument.state !== "available") return attachmentInvalid<Payload>(["attachment.json"]);
    const envelope = decodeRecordAttachmentEnvelope(envelopeDocument.value);
    if (Either.isLeft(envelope)) return attachmentInvalid<Payload>(["attachment.json"]);
    // We reached a directory for one known fixed family. Its envelope must
    // declare that same family; treating a swapped envelope as an unknown
    // sibling would let a corrupted known directory masquerade as tolerated
    // future data.
    if (envelope.right.family !== input.descriptor.family) {
      return attachmentInvalid<Payload>(["attachment.json", "family"]);
    }
    if (
      envelope.right.schemaVersion < input.descriptor.schemaVersion &&
      hasReachableAdjacentMigration(input.descriptor, envelope.right.schemaVersion)
    ) {
      return Object.freeze({
        state: "migration-required" as const,
        family: input.descriptor.family,
        fromSchemaVersion: envelope.right.schemaVersion,
        toSchemaVersion: input.descriptor.schemaVersion,
        command: "niceeval migrate" as const,
      });
    }
    if (envelope.right.schemaVersion !== input.descriptor.schemaVersion) {
      // A well-formed envelope for a known family can still carry a version
      // this reader cannot interpret. Only a reachable older version asks for
      // migration; all other non-current versions remain local unsupported
      // data, rather than being misclassified as corrupt bytes.
      return Object.freeze({
        state: "unsupported" as const,
        family: input.descriptor.family,
        schemaVersion: envelope.right.schemaVersion,
      });
    }

    const payloadDocument = yield* readJson(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "payload.json"),
    );
    if (payloadDocument.state !== "available") return attachmentInvalid<Payload>(["payload.json"]);
    const blobs = yield* readBlobDirectory(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "blobs"),
      input.descriptor.blobBudget.maximumBlobs,
    );
    if (blobs.state === "invalid") return attachmentInvalid<Payload>(["blobs"]);

    const hydrated = hydrateDurablePayload(payloadDocument.value);
    if (hydrated.invalid) return attachmentInvalid<Payload>(["payload.json"]);
    const entries = blobs.state === "available" ? blobs.entries : [];
    if (entries.length > input.descriptor.blobBudget.maximumBlobs) {
      return attachmentInvalid<Payload>(["blobs"]);
    }
    const entriesByKey = new Map(entries.map((entry) => [entry.name, entry] as const));
    if (entriesByKey.size !== hydrated.refsByKey.size || [...hydrated.refsByKey.keys()].some((key) => !entriesByKey.has(key))) {
      return attachmentInvalid<Payload>(["blobs"]);
    }

    const payload = input.descriptor.write.decodePayload(hydrated.value);
    if (Either.isLeft(payload)) return attachmentInvalid<Payload>(["payload.json"]);

    let totalBytes = 0;
    const materialized: RecordAttachmentMaterializedBlob[] = [];
    for (const [key, ref] of hydrated.refsByKey) {
      const bytes = yield* readBlob(
        input.fileSystem,
        attachmentPath(input.root, input.location, input.descriptor.family, "blobs", key),
        input.descriptor.blobBudget.maximumBlobBytes,
      );
      if (bytes === undefined) return attachmentInvalid<Payload>(["blobs", key]);
      totalBytes += bytes.byteLength;
      if (totalBytes > input.descriptor.blobBudget.maximumTotalBytes) {
        return attachmentInvalid<Payload>(["blobs", key]);
      }
      materialized.push(Object.freeze({ ref, bytes }));
    }

    const materializedValue = makeFixedRecordAttachmentValue(input.descriptor.write, payload.right, materialized);
    if (Either.isLeft(materializedValue)) return attachmentInvalid<Payload>(["payload.json"]);
    return Object.freeze({ state: "available" as const, ...materializedValue.right });
  });
}
