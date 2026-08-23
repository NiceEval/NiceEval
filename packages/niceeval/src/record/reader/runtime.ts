import { createHash } from "node:crypto";
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
import type { FixedRecordFamilyDescriptor } from "../family/catalog.ts";
import { decodeFixedRecordAttachmentEnvelope } from "../family/catalog.ts";
import type {
  RecordAttachmentEnvelope,
  RecordAttachmentOwner,
} from "../model/core.ts";
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

function hydrateDurablePayload(
  input: unknown,
  suppliedRefs?: ReadonlyMap<string, RecordBlobRef>,
): HydratedPayload {
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
      const prior = refsByKey.get(key) ?? suppliedRefs?.get(key);
      if (prior !== undefined) {
        refsByKey.set(key, prior);
        return prior;
      }
      if (suppliedRefs !== undefined) {
        invalid = true;
        return source;
      }
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

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readPointer(
  fileSystem: RecordFileSystemService,
  file: ReturnType<typeof recordPortablePath>,
  pointer: { readonly sha256: string; readonly byteLength: number },
  maximumBytes: number,
): Effect.Effect<Uint8Array | undefined, RecordFileSystemError> {
  if (pointer.byteLength > maximumBytes) return Effect.succeed(undefined);
  return fileSystem.readFile({ file, maximumBytes }).pipe(
    Effect.map((bytes) => bytes !== undefined && bytes.byteLength === pointer.byteLength &&
        digest(bytes) === pointer.sha256
      ? bytes
      : undefined),
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)),
    Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(undefined)),
  );
}

function hasReachableAdjacentMigration<
  Family extends string,
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
  Family extends string,
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
    if (Either.isLeft(envelope)) {
      const legacy = decodeFixedRecordAttachmentEnvelope(envelopeDocument.value);
      if (Either.isLeft(legacy) || legacy.right.family !== input.descriptor.family) {
        return attachmentEnvelopeInvalid(["attachment.json"]);
      }
      if (legacy.right.schemaVersion <= input.descriptor.schemaVersion) {
        return Object.freeze({
          state: "migration-required" as const,
          family: input.descriptor.family,
          fromSchemaVersion: legacy.right.schemaVersion,
          toSchemaVersion: input.descriptor.schemaVersion,
          command: "niceeval migrate" as const,
        });
      }
      return Object.freeze({
        state: "unsupported" as const,
        family: input.descriptor.family,
        schemaVersion: legacy.right.schemaVersion,
      });
    }
    if (
      envelope.right.ownerKind !== input.location.owner ||
      envelope.right.family !== input.descriptor.family
    ) {
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
  Family extends string,
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
    const inspected = yield* inspectFixedRecordAttachmentEnvelope(input);
    if (inspected.state !== "current") return inspected;
    const envelopeDocument = yield* readJson(
      input.fileSystem,
      attachmentPath(input.root, input.location, input.descriptor.family, "attachment.json"),
    );
    if (envelopeDocument.state !== "available") return attachmentInvalid<Payload>(["attachment.json"]);
    const decodedEnvelope = decodeRecordAttachmentEnvelope(envelopeDocument.value);
    if (Either.isLeft(decodedEnvelope)) return attachmentInvalid<Payload>(["attachment.json"]);
    const committed: RecordAttachmentEnvelope = decodedEnvelope.right;

    const payloadBytes = yield* readPointer(
      input.fileSystem,
      attachmentPath(
        input.root,
        input.location,
        input.descriptor.family,
        "payload",
        "sha256",
        committed.payload.sha256,
      ),
      committed.payload,
      RECORD_READER_MAXIMUM_ATTACHMENT_DOCUMENT_BYTES,
    );
    if (payloadBytes === undefined) return attachmentInvalid<Payload>(["payload"]);
    const payloadDocument = parseJson(payloadBytes);
    if (payloadDocument.state !== "available") return attachmentInvalid<Payload>(["payload"]);

    if (committed.contents.length > input.descriptor.write.budget.maximumBlobs) {
      return attachmentInvalid<Payload>(["content"]);
    }
    const refsByKey = new Map<string, RecordBlobRef>();
    for (const content of committed.contents) refsByKey.set(content.key, makeRecordBlobRef());

    if (input.expectedManifestEntries !== undefined) {
      const owner = input.location.owner === "run" ? "run" : input.location.attemptId;
      if (owner === undefined) return attachmentInvalid<Payload>([]);
      const prefix = input.location.owner === "run"
        ? `attachments/${input.descriptor.family}`
        : `attempts/${owner}/attachments/${input.descriptor.family}`;
      const physicalEntries = [
        { kind: "attachment-envelope" as const, path: `${prefix}/attachment.json` },
        {
          kind: "payload" as const,
          path: `${prefix}/payload/sha256/${committed.payload.sha256}`,
        },
        ...[...new Set(committed.contents.map((content) => content.sha256))].map((sha256) => ({
          kind: "blob" as const,
          path: `${prefix}/content/sha256/${sha256}`,
        })),
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
        })
      ) return attachmentInvalid<Payload>([]);
    }

    const hydrated = hydrateDurablePayload(payloadDocument.value, refsByKey);
    if (hydrated.invalid || hydrated.refsByKey.size !== committed.contents.length) {
      return attachmentInvalid<Payload>(["payload"]);
    }

    const payload = input.descriptor.write.decodePayload(hydrated.value);
    if (Either.isLeft(payload)) return attachmentInvalid<Payload>(["payload"]);

    let totalBytes = 0;
    const materialized: RecordAttachmentMaterializedBlob[] = [];
    for (const content of committed.contents) {
      const ref = refsByKey.get(content.key);
      if (ref === undefined) return attachmentInvalid<Payload>(["content", content.key]);
      const bytes = yield* readPointer(
        input.fileSystem,
        attachmentPath(
          input.root,
          input.location,
          input.descriptor.family,
          "content",
          "sha256",
          content.sha256,
        ),
        content,
        input.descriptor.write.budget.maximumBlobBytes,
      );
      if (bytes === undefined) return attachmentInvalid<Payload>(["content", content.key]);
      totalBytes += bytes.byteLength;
      if (totalBytes > input.descriptor.write.budget.maximumTotalBytes) {
        return attachmentInvalid<Payload>(["content", content.key]);
      }
      materialized.push(Object.freeze({ ref, bytes }));
    }

    const materializedValue = makeFixedRecordAttachmentValueFromDecoded(
      input.descriptor.write,
      payload.right,
      materialized,
    );
    if (Either.isLeft(materializedValue)) return attachmentInvalid<Payload>(["payload"]);
    let references: readonly { readonly owner: RecordAttachmentOwner; readonly family: string }[];
    try {
      references = input.descriptor.write.references?.(materializedValue.right.value as Payload) ?? [];
    } catch {
      return attachmentInvalid<Payload>(["references"]);
    }
    if (JSON.stringify(references) !== JSON.stringify(committed.references)) {
      return attachmentInvalid<Payload>(["references"]);
    }
    return Object.freeze({ state: "available" as const, ...materializedValue.right });
  });
}
