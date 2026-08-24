import { Effect, Either } from "effect";
import {
  makeFixedRecordAttachmentValueFromDecoded,
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
  NiceEvalFamily,
} from "../family/catalog.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import type { AttemptId, RunId } from "../model/identifiers.ts";
import type { SealManifestEntry } from "../model/seal-manifest.ts";
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

export type FixedRecordAttachmentEnvelopeRead =
  | { readonly state: "current" }
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

function attachmentEnvelopeInvalid(path: readonly string[]): FixedRecordAttachmentEnvelopeRead {
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

/** Open-session gate: inspect only directory identity and exact envelope/version. */
export function inspectFixedRecordAttachmentEnvelope<
  Family extends NiceEvalFamily,
  Owner extends RecordAttachmentOwner,
  Payload,
>(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: FixedRecordAttachmentLocation<Owner>;
  readonly descriptor: FixedRecordFamilyDescriptor<Family, Owner, Payload>;
}): Effect.Effect<FixedRecordAttachmentEnvelopeRead, RecordFileSystemError> {
  return Effect.gen(function* () {
    const directory = attachmentPath(input.root, input.location, input.descriptor.family);
    const kind = yield* input.fileSystem.pathKind(directory);
    if (kind === "missing") return Object.freeze({ state: "unavailable" as const });
    if (kind !== "directory") return attachmentEnvelopeInvalid(["attachment"]);
    const envelopeDocument = yield* readJson(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "attachment.json"),
    );
    if (envelopeDocument.state !== "available") return attachmentEnvelopeInvalid(["attachment.json"]);
    const envelope = decodeRecordAttachmentEnvelope(envelopeDocument.value);
    if (Either.isLeft(envelope)) return attachmentEnvelopeInvalid(["attachment.json"]);
    if (envelope.right.family !== input.descriptor.family) {
      return attachmentEnvelopeInvalid(["attachment.json", "family"]);
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
    return envelope.right.schemaVersion === input.descriptor.schemaVersion
      ? Object.freeze({ state: "current" as const })
      : Object.freeze({
          state: "unsupported" as const,
          family: input.descriptor.family,
          schemaVersion: envelope.right.schemaVersion,
        });
  });
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
  readonly expectedManifestEntries?: readonly SealManifestEntry[];
}): Effect.Effect<FixedRecordAttachmentRead<Payload>, RecordFileSystemError> {
  return Effect.gen(function* () {
    const envelope = yield* inspectFixedRecordAttachmentEnvelope(input);
    if (envelope.state !== "current") return envelope;

    const directory = attachmentPath(input.root, input.location, input.descriptor.family);
    const inventory = yield* input.fileSystem.listDirectory({
      directory,
      maximumEntries: 256,
    });
    const byName = new Map(inventory.map((entry) => [entry.name, entry] as const));
    if (
      byName.size !== inventory.length ||
      byName.get("attachment.json")?.kind !== "file" ||
      byName.get("payload.json")?.kind !== "file" ||
      (byName.size === 3 && byName.get("blobs")?.kind !== "directory") ||
      (byName.size !== 2 && byName.size !== 3)
    ) return attachmentInvalid<Payload>([]);

    const payloadDocument = yield* readJson(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "payload.json"),
    );
    if (payloadDocument.state !== "available") return attachmentInvalid<Payload>(["payload.json"]);
    const blobs = yield* readBlobDirectory(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "blobs"),
      input.descriptor.write.budget.maximumBlobs,
    );
    if (blobs.state === "invalid") return attachmentInvalid<Payload>(["blobs"]);

    if (input.expectedManifestEntries !== undefined) {
      const owner = input.location.owner === "run" ? "run" : input.location.attemptId;
      if (owner === undefined) return attachmentInvalid<Payload>([]);
      const prefix = input.location.owner === "run"
        ? `attachments/${input.descriptor.family}`
        : `attempts/${owner}/attachments/${input.descriptor.family}`;
      const physicalEntries = [
        { kind: "attachment-envelope" as const, path: `${prefix}/attachment.json` },
        { kind: "payload" as const, path: `${prefix}/payload.json` },
        ...(blobs.state === "available"
          ? blobs.entries.map((entry) => ({
              kind: "blob" as const,
              path: `${prefix}/blobs/${entry.name}`,
            }))
          : []),
      ].sort((left, right) => left.path.localeCompare(right.path));
      const declaredEntries = input.expectedManifestEntries
        .map((entry) => ({
          kind: entry.kind,
          path: entry.path,
          owner: entry.owner,
          family: entry.family,
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
      if (
        declaredEntries.length !== physicalEntries.length ||
        declaredEntries.some((entry, index) => {
          const physical = physicalEntries[index];
          return physical === undefined || entry.kind !== physical.kind || entry.path !== physical.path ||
            entry.owner !== owner || entry.family !== input.descriptor.family;
        }) ||
        (blobs.state === "available" && blobs.entries.length === 0)
      ) return attachmentInvalid<Payload>([]);
    }

    const hydrated = hydrateDurablePayload(payloadDocument.value);
    if (hydrated.invalid) return attachmentInvalid<Payload>(["payload.json"]);
    const entries = blobs.state === "available" ? blobs.entries : [];
    if (entries.length > input.descriptor.write.budget.maximumBlobs) {
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
        input.descriptor.write.budget.maximumBlobBytes,
      );
      if (bytes === undefined) return attachmentInvalid<Payload>(["blobs", key]);
      totalBytes += bytes.byteLength;
      if (totalBytes > input.descriptor.write.budget.maximumTotalBytes) {
        return attachmentInvalid<Payload>(["blobs", key]);
      }
      materialized.push(Object.freeze({ ref, bytes }));
    }

    const materializedValue = makeFixedRecordAttachmentValueFromDecoded(
      input.descriptor.write,
      payload.right,
      materialized,
    );
    if (Either.isLeft(materializedValue)) return attachmentInvalid<Payload>(["payload.json"]);
    return Object.freeze({ state: "available" as const, ...materializedValue.right });
  });
}

/**
 * Maintenance-only validation of one exact historical attachment before its
 * envelope advances. The historical decoder proves the old shape, the pure
 * migration callback executes the complete adjacent chain, and the current
 * descriptor proves its exact shape and blob closure. Physical rewrite policy
 * remains host-owned metadata; `rewritePayload` is only its consistency check.
 */
export function validateFixedRecordAttachmentMigrationSource<
  Family extends NiceEvalFamily,
  Owner extends RecordAttachmentOwner,
  Payload,
>(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: FixedRecordAttachmentLocation<Owner>;
  readonly descriptor: FixedRecordFamilyDescriptor<Family, Owner, Payload>;
  readonly fromSchemaVersion: number;
  readonly decodeHistorical: (value: unknown) => unknown;
  readonly verifyHistorical?: (
    payload: unknown,
    blobs: readonly RecordAttachmentMaterializedBlob[],
  ) => boolean;
  readonly migrate: (
    value: unknown,
    blobs: readonly RecordAttachmentMaterializedBlob[],
  ) => {
    readonly payload: unknown;
    readonly rewritePayload: boolean;
  };
}): Effect.Effect<false | {
  readonly payload: Payload;
  readonly blobKeys: ReadonlyMap<object, string>;
  readonly removedBlobs: readonly { readonly key: string; readonly bytes: Uint8Array }[];
  readonly rewritePayload: boolean;
}, RecordFileSystemError> {
  return Effect.gen(function* () {
    const directory = attachmentPath(input.root, input.location, input.descriptor.family);
    if ((yield* input.fileSystem.pathKind(directory)) !== "directory") return false;

    const envelopeDocument = yield* readJson(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "attachment.json"),
    );
    if (envelopeDocument.state !== "available") return false;
    const envelope = decodeRecordAttachmentEnvelope(envelopeDocument.value);
    if (
      Either.isLeft(envelope) ||
      envelope.right.family !== input.descriptor.family ||
      envelope.right.schemaVersion !== input.fromSchemaVersion
    ) {
      return false;
    }

    const payloadDocument = yield* readJson(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "payload.json"),
    );
    if (payloadDocument.state !== "available") return false;
    const blobs = yield* readBlobDirectory(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "blobs"),
      input.descriptor.write.budget.maximumBlobs,
    );
    if (blobs.state === "invalid") return false;

    const hydrated = hydrateDurablePayload(payloadDocument.value);
    if (hydrated.invalid) return false;
    const entries = blobs.state === "available" ? blobs.entries : [];
    if (entries.length > input.descriptor.write.budget.maximumBlobs) return false;
    const entriesByKey = new Map(entries.map((entry) => [entry.name, entry] as const));
    if (
      entriesByKey.size !== hydrated.refsByKey.size ||
      [...hydrated.refsByKey.keys()].some((key) => !entriesByKey.has(key))
    ) {
      return false;
    }

    let historical: unknown;
    try {
      historical = input.decodeHistorical(hydrated.value);
    } catch {
      return false;
    }
    let totalBytes = 0;
    const materialized: RecordAttachmentMaterializedBlob[] = [];
    for (const [key, ref] of hydrated.refsByKey) {
      const bytes = yield* readBlob(
        input.fileSystem,
        attachmentPath(input.root, input.location, input.descriptor.family, "blobs", key),
        input.descriptor.write.budget.maximumBlobBytes,
      );
      if (bytes === undefined) return false;
      totalBytes += bytes.byteLength;
      if (totalBytes > input.descriptor.write.budget.maximumTotalBytes) return false;
      materialized.push(Object.freeze({ ref, bytes }));
    }
    if (input.verifyHistorical !== undefined && !input.verifyHistorical(historical, materialized)) {
      return false;
    }

    let migrated: {
      readonly payload: unknown;
      readonly rewritePayload: boolean;
    };
    try {
      migrated = input.migrate(historical, materialized);
    } catch {
      return false;
    }
    const payload = input.descriptor.write.decodePayload(migrated.payload);
    if (Either.isLeft(payload)) return false;
    const currentRefs = new Set(input.descriptor.write.refs(payload.right));
    const currentMaterialized = materialized.filter((blob) => currentRefs.has(blob.ref));
    if (Either.isLeft(makeFixedRecordAttachmentValueFromDecoded(
      input.descriptor.write,
      payload.right,
      currentMaterialized,
    ))) return false;
    const bytesByRef = new Map(materialized.map((blob) => [blob.ref, blob.bytes] as const));
    const removedBlobs = [...hydrated.refsByKey]
      .filter(([, ref]) => !currentRefs.has(ref))
      .map(([key, ref]) => Object.freeze({ key, bytes: bytesByRef.get(ref)! }));
    return Object.freeze({
      payload: payload.right,
      blobKeys: new Map([...hydrated.refsByKey]
        .filter(([, ref]) => currentRefs.has(ref))
        .map(([key, ref]) => [ref as object, key] as const)),
      removedBlobs: Object.freeze(removedBlobs),
      rewritePayload: migrated.rewritePayload,
    });
  });
}
