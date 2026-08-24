import { createHash } from "node:crypto";
import { Effect, Either, Stream, type Schema } from "effect";

import {
  enumerateRecordAttachmentClosure,
  hydrateRecordAttachmentCurrent,
  mintRecordAttachmentReference,
  recordAttachmentReferenceDefinition,
  recordAttachmentReferenceWire,
  RecordAttachmentReference,
  type RecordAttachmentDefinition,
  type RecordAttachmentPersistence,
} from "../attachment/protocol.ts";
import {
  isRecordContentHandle,
  isRecordTextContentHandle,
  mintRecordContentHandle,
  type RecordContentHandle,
  type RecordTextContentHandle,
} from "../attachment/content.ts";
import {
  decodeDurableRecordAttachmentEnvelope,
  decodeLegacyRecordAttachmentHeader,
} from "../codec/attachment.ts";
import { decodeRecordAttachmentEnvelope } from "../codec/core.ts";
import type { DurableRecordAttachmentEnvelope } from "../model/attachment.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import type { AttemptId, RunId } from "../model/identifiers.ts";
import type { SealManifestEntry } from "../model/seal-manifest.ts";
import { nonEmptyRecordIssues, recordIssue, type NonEmptyRecordIssues } from "../errors/record-errors.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import { recordPortablePath, type RecordFileSystemService } from "../platform/services.ts";
import { RecordHandleInvalid, RecordReaderClosed, type RecordReaderReadError } from "./errors.ts";
import type { RecordAttachmentContentReader } from "../host/types.ts";
import {
  RECORD_ATTACHMENT_MAXIMUM_CONTENT_BYTES,
  RECORD_ATTACHMENT_MAXIMUM_CONTENTS,
  RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES,
} from "../writer/current-attachment.ts";
import { RECORD_JSON_MAXIMUM_BYTES } from "../writer/limits.ts";

type AnyDefinition = RecordAttachmentDefinition<RecordAttachmentOwner, string, Schema.Schema.AnyNoContext>;
type AnyPersistence = RecordAttachmentPersistence<AnyDefinition, number>;

/** Legacy private codec marker kept local to the old physical reader/writer. */
export const RECORD_DURABLE_BLOB_REF_KEY = "$niceeval.record.blob";

export interface RecordAttachmentLocation<Owner extends RecordAttachmentOwner = RecordAttachmentOwner> {
  readonly owner: Owner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
}

export type RecordAttachmentEnvelopeInspection =
  | { readonly state: "current" }
  | { readonly state: "unavailable" }
  | { readonly state: "migration-required"; readonly family: string; readonly fromRevision: number; readonly toRevision: number; readonly command: "niceeval migrate" }
  | { readonly state: "unsupported"; readonly family: string; readonly revision: number }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues };

export type CurrentRecordAttachmentRead<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly content: RecordAttachmentContentReader;
      readonly references: readonly {
        readonly owner: RecordAttachmentOwner;
        readonly family: string;
        readonly definition: AnyDefinition;
      }[];
    }
  | { readonly state: "unavailable" }
  | Exclude<RecordAttachmentEnvelopeInspection, { readonly state: "current" | "unavailable" }>;

export interface VerifiedRecordAttachmentPhysical {
  readonly envelope: DurableRecordAttachmentEnvelope;
  readonly envelopeBytes: Uint8Array;
  readonly payload: unknown;
  readonly payloadBytes: Uint8Array;
  readonly contents: ReadonlyMap<string, Uint8Array>;
}

function invalid(): Extract<RecordAttachmentEnvelopeInspection, { readonly state: "invalid" }> {
  const issues = nonEmptyRecordIssues([recordIssue("record-schema-invalid", ["attachment"])]);
  if (issues === undefined) throw new Error("Attachment invalid state requires one issue");
  return Object.freeze({ state: "invalid", issues });
}

function attachmentPath(
  root: RecordRoot,
  location: RecordAttachmentLocation,
  family: string,
  ...segments: readonly string[]
) {
  return location.owner === "run"
    ? recordPortablePath(root, "runs", location.runId, "attachments", family, ...segments)
    : recordPortablePath(root, "runs", location.runId, "attempts", location.attemptId!, "attachments", family, ...segments);
}

function parseJson(bytes: Uint8Array): unknown | undefined {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameReferences(
  left: readonly { readonly owner: RecordAttachmentOwner; readonly family: string }[],
  right: readonly { readonly owner: RecordAttachmentOwner; readonly family: string }[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    entry.owner === right[index]?.owner && entry.family === right[index]?.family
  );
}

function manifestMatchesPhysical(
  location: RecordAttachmentLocation,
  family: string,
  physical: VerifiedRecordAttachmentPhysical,
  entries: readonly SealManifestEntry[],
): boolean {
  const base = location.owner === "run"
    ? `attachments/${family}`
    : `attempts/${location.attemptId}/attachments/${family}`;
  const expected = new Map<string, {
    readonly kind: SealManifestEntry["kind"];
    readonly byteLength: number;
    readonly sha256: string;
  }>();
  expected.set(`${base}/attachment.json`, {
    kind: "attachment-envelope",
    byteLength: physical.envelopeBytes.byteLength,
    sha256: digest(physical.envelopeBytes),
  });
  expected.set(`${base}/payload/sha256/${physical.envelope.payload.sha256}`, {
    kind: "payload",
    byteLength: physical.payloadBytes.byteLength,
    sha256: physical.envelope.payload.sha256,
  });
  for (const pointer of physical.envelope.contents) {
    expected.set(`${base}/content/sha256/${pointer.sha256}`, {
      kind: "blob",
      byteLength: pointer.byteLength,
      sha256: pointer.sha256,
    });
  }
  if (entries.length !== expected.size) return false;
  return entries.every((entry) => {
    const pointer = expected.get(entry.path);
    return pointer !== undefined &&
      entry.family === family &&
      entry.owner === (location.owner === "run" ? "run" : location.attemptId) &&
      entry.kind === pointer.kind &&
      entry.byteLength === pointer.byteLength &&
      entry.sha256 === pointer.sha256;
  });
}

function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function hasOwnMarker(value: unknown, key: string): boolean {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key);
}

function legacyEnvelopeRevision(
  value: unknown,
  owner: RecordAttachmentOwner,
  family: string,
): number | undefined {
  const addressed = decodeRecordAttachmentEnvelope(value);
  if (Either.isRight(addressed)) {
    return addressed.right.ownerKind === owner && addressed.right.family === family
      ? addressed.right.schemaVersion
      : undefined;
  }
  const legacy = decodeLegacyRecordAttachmentHeader(value);
  return Either.isRight(legacy) && legacy.right.family === family
    ? legacy.right.schemaVersion
    : undefined;
}

export function inspectRecordAttachmentEnvelope(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: RecordAttachmentLocation;
  readonly persistence: AnyPersistence;
}): Effect.Effect<RecordAttachmentEnvelopeInspection, RecordFileSystemError> {
  return Effect.gen(function* () {
    const directory = attachmentPath(input.root, input.location, input.persistence.attachment.family);
    const kind = yield* input.fileSystem.pathKind(directory);
    if (kind === "missing") return Object.freeze({ state: "unavailable" as const });
    if (kind !== "directory") return invalid();
    const bytes = yield* input.fileSystem.readFile({
      file: attachmentPath(input.root, input.location, input.persistence.attachment.family, "attachment.json"),
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    });
    const json = bytes === undefined ? undefined : parseJson(bytes);
    const envelope = json === undefined ? undefined : decodeDurableRecordAttachmentEnvelope(json);
    if (envelope === undefined) return invalid();
    if (Either.isLeft(envelope)) {
      const revision = legacyEnvelopeRevision(
        json,
        input.location.owner,
        input.persistence.attachment.family,
      );
      if (revision === undefined) return invalid();
      return revision <= input.persistence.revision
        ? Object.freeze({
            state: "migration-required" as const,
            family: input.persistence.attachment.family,
            fromRevision: revision,
            toRevision: input.persistence.revision,
            command: "niceeval migrate" as const,
          })
        : Object.freeze({
            state: "unsupported" as const,
            family: input.persistence.attachment.family,
            revision,
          });
    }
    if (
      envelope.right.ownerKind !== input.location.owner ||
      envelope.right.family !== input.persistence.attachment.family
    ) return invalid();
    if (envelope.right.revision === input.persistence.revision) {
      return Object.freeze({ state: "current" as const });
    }
    if (envelope.right.revision < input.persistence.revision) {
      return Object.freeze({
        state: "migration-required" as const,
        family: envelope.right.family,
        fromRevision: envelope.right.revision,
        toRevision: input.persistence.revision,
        command: "niceeval migrate" as const,
      });
    }
    return Object.freeze({
      state: "unsupported" as const,
      family: envelope.right.family,
      revision: envelope.right.revision,
    });
  });
}

/** Reads and hashes every byte named by the sole physical commit record. */
export function readVerifiedRecordAttachmentPhysical(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: RecordAttachmentLocation;
  readonly family: string;
}): Effect.Effect<VerifiedRecordAttachmentPhysical | undefined, RecordFileSystemError> {
  return Effect.gen(function* () {
    const envelopeBytes = yield* input.fileSystem.readFile({
      file: attachmentPath(input.root, input.location, input.family, "attachment.json"),
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    }).pipe(Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)));
    const envelopeJson = envelopeBytes === undefined ? undefined : parseJson(envelopeBytes);
    const decoded = envelopeJson === undefined ? undefined : decodeDurableRecordAttachmentEnvelope(envelopeJson);
    if (envelopeBytes === undefined || decoded === undefined || Either.isLeft(decoded)) return undefined;
    const envelope = decoded.right;
    if (envelope.ownerKind !== input.location.owner || envelope.family !== input.family) return undefined;
    if (envelope.contents.length > RECORD_ATTACHMENT_MAXIMUM_CONTENTS) return undefined;
    const payloadBytes = yield* input.fileSystem.readFile({
      file: attachmentPath(input.root, input.location, input.family, "payload", "sha256", envelope.payload.sha256),
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    }).pipe(Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)));
    if (
      payloadBytes === undefined ||
      payloadBytes.byteLength !== envelope.payload.byteLength ||
      digest(payloadBytes) !== envelope.payload.sha256
    ) return undefined;
    const payload = parseJson(payloadBytes);
    if (payload === undefined) return undefined;
    const contents = new Map<string, Uint8Array>();
    let total = 0;
    for (const pointer of envelope.contents) {
      if (pointer.byteLength > RECORD_ATTACHMENT_MAXIMUM_CONTENT_BYTES) return undefined;
      const bytes = yield* input.fileSystem.readFile({
        file: attachmentPath(input.root, input.location, input.family, "content", "sha256", pointer.sha256),
        maximumBytes: RECORD_ATTACHMENT_MAXIMUM_CONTENT_BYTES,
      }).pipe(
        Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)),
        Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(undefined)),
      );
      if (bytes === undefined || bytes.byteLength !== pointer.byteLength || digest(bytes) !== pointer.sha256) return undefined;
      total += bytes.byteLength;
      if (total > RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES) return undefined;
      contents.set(pointer.key, bytes);
    }
    if (contents.size !== envelope.contents.length) return undefined;
    return Object.freeze({ envelope, envelopeBytes, payload, payloadBytes, contents });
  });
}

function scopedContentReader(
  lifecycle: { readonly closed: boolean },
  bytesByHandle: ReadonlyMap<object, Uint8Array>,
): RecordAttachmentContentReader {
  const bytes = (handle: RecordContentHandle): Effect.Effect<Uint8Array, RecordReaderReadError> =>
    Effect.suspend((): Effect.Effect<Uint8Array, RecordReaderReadError> => {
      if (lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
      const content = isRecordContentHandle(handle) ? bytesByHandle.get(handle) : undefined;
      return content === undefined
        ? Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }))
        : Effect.succeed(new Uint8Array(content));
    });
  return Object.freeze({
    bytes,
    text: (handle: RecordTextContentHandle) => Effect.flatMap(bytes(handle), (content) => {
      if (!isRecordTextContentHandle(handle)) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
      try {
        return Effect.succeed(new TextDecoder("utf-8", { fatal: true }).decode(content));
      } catch {
        return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
      }
    }),
    stream: (handle: RecordContentHandle) => Stream.fromEffect(bytes(handle)),
  });
}

export function readCurrentRecordAttachment<Definition extends AnyDefinition>(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: RecordAttachmentLocation<Definition["owner"]>;
  readonly persistence: RecordAttachmentPersistence<Definition, number>;
  readonly lifecycle: { readonly closed: boolean };
  readonly expectedManifestEntries?: readonly SealManifestEntry[];
}): Effect.Effect<CurrentRecordAttachmentRead<Schema.Schema.Type<Definition["schema"]>>, RecordFileSystemError> {
  return Effect.gen(function* () {
    const inspected = yield* inspectRecordAttachmentEnvelope(input);
    if (inspected.state !== "current") return inspected;
    const physical = yield* readVerifiedRecordAttachmentPhysical({
      fileSystem: input.fileSystem,
      root: input.root,
      location: input.location,
      family: input.persistence.attachment.family,
    });
    if (physical === undefined || physical.envelope.revision !== input.persistence.revision) return invalid();
    if (
      input.expectedManifestEntries !== undefined &&
      !manifestMatchesPhysical(
        input.location,
        input.persistence.attachment.family,
        physical,
        input.expectedManifestEntries,
      )
    ) return invalid();

    const logical = yield* Effect.sync(() => {
      const handles = new Map<string, RecordContentHandle>();
      const bytesByHandle = new Map<object, Uint8Array>();
      const usedContent = new Set<string>();
      const hydrated = hydrateRecordAttachmentCurrent(input.persistence.attachment, physical.payload, {
        content: (token, declaration) => {
          const key = exactMarker(token, "$niceeval.record.content");
          if (key === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
            return Either.right(undefined);
          }
          const bytes = typeof key === "string" ? physical.contents.get(key) : undefined;
          if (bytes === undefined || declaration.maximumBytes !== undefined && bytes.byteLength > declaration.maximumBytes) {
            return Either.left({ code: "current-content-bind-failed" as const });
          }
          let handle = handles.get(key as string);
          if (handle === undefined) {
            handle = mintRecordContentHandle(declaration.kind);
            handles.set(key as string, handle);
            bytesByHandle.set(handle, bytes);
          }
          usedContent.add(key as string);
          return Either.right(handle);
        },
        reference: (token, declaration) => {
          const marker = exactMarker(token, "$niceeval.record.reference");
          if (marker === undefined && !hasOwnMarker(token, "$niceeval.record.reference")) {
            return Either.right(undefined);
          }
          if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
            return Either.left({ code: "current-reference-bind-failed" as const });
          }
          const value = marker as Record<string, unknown>;
          if (
            Reflect.ownKeys(value).length !== 3 ||
            value.owner !== declaration.definition.owner ||
            value.family !== declaration.definition.family ||
            !("value" in value)
          ) return Either.left({ code: "current-reference-bind-failed" as const });
          return Either.right(mintRecordAttachmentReference(
            RecordAttachmentReference.to(declaration.definition, declaration.valueSchema),
            value.value,
          ));
        },
      });
      if (Either.isLeft(hydrated) || usedContent.size !== physical.contents.size) return undefined;
      const closure = enumerateRecordAttachmentClosure(input.persistence.attachment, hydrated.right);
      if (Either.isLeft(closure)) return undefined;
      const referencesByIdentity = new Map<string, {
        readonly owner: RecordAttachmentOwner;
        readonly family: string;
        readonly definition: AnyDefinition;
      }>();
      for (const reference of closure.right.references) {
        const wire = recordAttachmentReferenceWire(reference);
        const definition = recordAttachmentReferenceDefinition(reference);
        if (wire === undefined || definition === undefined) return undefined;
        const identity = `${wire.owner}\u0000${wire.family}`;
        const existing = referencesByIdentity.get(identity);
        if (existing !== undefined && existing.definition !== definition) return undefined;
        referencesByIdentity.set(identity, Object.freeze({
          owner: wire.owner,
          family: wire.family,
          definition,
        }));
      }
      const references = [...referencesByIdentity.values()].sort((left, right) =>
        `${left.owner}\u0000${left.family}`.localeCompare(`${right.owner}\u0000${right.family}`)
      );
      return sameReferences(references, physical.envelope.references)
        ? Object.freeze({ value: hydrated.right, bytesByHandle, references: Object.freeze(references) })
        : undefined;
    }).pipe(Effect.catchAllDefect(() => Effect.succeed(undefined)));
    if (logical === undefined) return invalid();
    return Object.freeze({
      state: "available" as const,
      value: logical.value,
      content: scopedContentReader(input.lifecycle, logical.bytesByHandle),
      references: logical.references,
    });
  });
}
