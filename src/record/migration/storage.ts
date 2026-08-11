/**
 * Current Record v1 layout adapter.
 *
 * This module deliberately reads the same portable layout, bounded documents,
 * and codecs as the current reader. It does not route migration through the
 * legacy Graph/Store implementation and it does not make ordinary reads
 * compatible with historic data.
 */

import { Effect, Either, Schema } from "effect";
import {
  decodeAttemptDocumentV1,
  decodeMemberDocumentV1,
  decodeRecordAttachmentEnvelopeV1,
  decodeRecordCoreV1,
  encodeRecordDocumentV1,
  decodeRunDocumentV1,
} from "../codec/core.ts";
import {
  AttemptIdSchema,
  RecordAttachmentNameSchema,
  RunIdSchema,
  SlotIdSchema,
} from "../codec/identifiers.ts";
import {
  recordCodecError,
  recordIssue,
  type RecordCodecDocument,
  type RecordCodecError,
} from "../errors/record-errors.ts";
import type {
  AttemptDocumentV1,
  MemberDocumentV1,
  RecordAttachmentOwner,
  RecordCoreV1,
  RunCoreV1,
  RunDocumentV1,
} from "../model/core.ts";
import {
  compareCanonicalIdentity,
  type AttemptId,
  type RecordAttachmentName,
  type RunId,
  type SlotId,
} from "../model/identifiers.ts";
import type { RecordRoot } from "../platform/root.ts";
import {
  RecordFileSystem,
  recordPortablePath,
  type RecordDirectoryEntry,
  type RecordFileSystemService,
  type RecordPortablePath,
} from "../platform/services.ts";
import { readCurrentRecordFormat } from "../reader/format.ts";
import {
  RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_BYTES,
  RECORD_READER_MAXIMUM_CORE_DIRECTORY_ENTRIES,
  RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
  RECORD_READER_MAXIMUM_RUN_ENTRIES,
} from "../reader/runtime.ts";
import type {
  RecordAttachmentFamily,
  RecordAttachmentMigrationEdge,
  RecordAttachmentRegistry,
  RecordAttachmentValue,
  RecordAttachmentWrite,
} from "../attachment/types.ts";
import type {
  RecordMigrationAttachmentSource,
  RecordMigrationSource,
  RecordMigrationStorage,
  RecordMigrationStorageError,
} from "./internal.ts";

const SNAPSHOT_DIRECTORY_MAXIMUM_ENTRIES = 100_000;

/** A deterministic identity for the portable source bytes. */
class SourceFingerprint {
  #hash = 0xcbf29ce484222325n;
  #bytes = 0;

  addText(value: string): void {
    this.addBytes(new TextEncoder().encode(value));
  }

  addBytes(value: Uint8Array): void {
    for (const byte of value) {
      this.#hash = ((this.#hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    this.#bytes += value.byteLength;
  }

  finish(): string {
    return `${this.#bytes}:${this.#hash.toString(16).padStart(16, "0")}`;
  }
}

function sourceInvalid(
  document: RecordCodecDocument,
  path: readonly string[],
): RecordCodecError {
  return recordCodecError({
    code: "record-schema-invalid",
    document,
    issues: [recordIssue("record-schema-invalid", path)],
  });
}

function parseJson(
  bytes: Uint8Array,
  document: RecordCodecDocument,
  path: readonly string[],
): Either.Either<unknown, RecordCodecError> {
  try {
    return Either.right(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return Either.left(sourceInvalid(document, path));
  }
}

function sortedEntries(
  entries: readonly RecordDirectoryEntry[],
): readonly RecordDirectoryEntry[] {
  return Object.freeze(
    [...entries]
      .map((entry) => Object.freeze({ name: entry.name, kind: entry.kind }))
      .sort((left, right) => compareCanonicalIdentity(left.name, right.name)),
  );
}

function validDirectoryEntry(value: unknown): value is RecordDirectoryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as { readonly name?: unknown; readonly kind?: unknown };
  return (
    typeof entry.name === "string" &&
    (entry.kind === "file" || entry.kind === "directory" || entry.kind === "other")
  );
}

function optionalDirectory(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly directory: RecordPortablePath;
  readonly maximumEntries: number;
  readonly document: RecordCodecDocument;
  readonly path: readonly string[];
}): Effect.Effect<readonly RecordDirectoryEntry[], RecordMigrationStorageError> {
  return Effect.gen(function* () {
    const kind = yield* input.fileSystem.pathKind(input.directory);
    if (kind === "missing") {
      return Object.freeze([]) as readonly RecordDirectoryEntry[];
    }
    if (kind !== "directory") {
      return yield* Effect.fail(sourceInvalid(input.document, input.path));
    }
    const entries = yield* input.fileSystem.listDirectory({
      directory: input.directory,
      maximumEntries: input.maximumEntries,
    });
    if (!Array.isArray(entries) || !entries.every(validDirectoryEntry)) {
      return yield* Effect.fail(sourceInvalid(input.document, input.path));
    }
    return sortedEntries(entries);
  });
}

function requiredJson(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly file: RecordPortablePath;
  readonly maximumBytes: number;
  readonly document: RecordCodecDocument;
  readonly path: readonly string[];
}): Effect.Effect<unknown, RecordMigrationStorageError> {
  return Effect.flatMap(
    input.fileSystem.readFile({ file: input.file, maximumBytes: input.maximumBytes }),
    (bytes) => {
      if (bytes === undefined) {
        return Effect.fail(sourceInvalid(input.document, input.path));
      }
      const parsed = parseJson(bytes, input.document, input.path);
      return Either.isLeft(parsed) ? Effect.fail(parsed.left) : Effect.succeed(parsed.right);
    },
  );
}

function decodeRunId(value: unknown): RunId | undefined {
  const decoded = Schema.decodeUnknownEither(RunIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function decodeAttemptId(value: unknown): AttemptId | undefined {
  const decoded = Schema.decodeUnknownEither(AttemptIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function decodeSlotId(value: unknown): SlotId | undefined {
  const decoded = Schema.decodeUnknownEither(SlotIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function decodeAttachmentName(value: unknown): RecordAttachmentName | undefined {
  const decoded = Schema.decodeUnknownEither(RecordAttachmentNameSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function runPath(
  root: RecordRoot,
  runId: RunId,
  ...segments: readonly string[]
): RecordPortablePath {
  return recordPortablePath(root, "runs", runId, ...segments);
}

function attachmentDirectory(input: {
  readonly root: RecordRoot;
  readonly owner: RecordAttachmentOwner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
  readonly name: RecordAttachmentName;
}): RecordPortablePath {
  return input.owner === "run"
    ? runPath(input.root, input.runId, "attachments", input.name)
    : runPath(
        input.root,
        input.runId,
        "attempts",
        input.attemptId!,
        "attachments",
        input.name,
      );
}

function attachmentBasePath(input: {
  readonly root: RecordRoot;
  readonly owner: RecordAttachmentOwner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
}): RecordPortablePath {
  return input.owner === "run"
    ? runPath(input.root, input.runId, "attachments")
    : runPath(input.root, input.runId, "attempts", input.attemptId!, "attachments");
}

function publishedRunIds(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
): Effect.Effect<readonly RunId[], RecordMigrationStorageError> {
  return Effect.gen(function* () {
    const entries = yield* optionalDirectory({
      fileSystem,
      directory: recordPortablePath(root, "runs"),
      maximumEntries: RECORD_READER_MAXIMUM_RUN_ENTRIES,
      document: "record-core",
      path: ["runs"],
    });
    const ids: RunId[] = [];
    for (const entry of entries) {
      const runId = entry.kind === "directory" ? decodeRunId(entry.name) : undefined;
      if (runId === undefined) {
        continue;
      }
      if ((yield* fileSystem.pathKind(runPath(root, runId, "complete"))) === "file") {
        ids.push(runId);
      }
    }
    return Object.freeze(ids.sort(compareCanonicalIdentity));
  });
}

function loadRunCore(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
}): Effect.Effect<RunCoreV1, RecordMigrationStorageError> {
  return Effect.gen(function* () {
    const runJson = yield* requiredJson({
      fileSystem: input.fileSystem,
      file: runPath(input.root, input.runId, "run.json"),
      maximumBytes: RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
      document: "run",
      path: ["runs", input.runId, "run.json"],
    });
    const run = decodeRunDocumentV1(runJson);
    if (Either.isLeft(run) || run.right.runId !== input.runId) {
      return yield* Effect.fail(sourceInvalid("run", ["runs", input.runId, "run.json"]));
    }

    const memberEntries = yield* optionalDirectory({
      fileSystem: input.fileSystem,
      directory: runPath(input.root, input.runId, "members"),
      maximumEntries: RECORD_READER_MAXIMUM_CORE_DIRECTORY_ENTRIES,
      document: "member",
      path: ["runs", input.runId, "members"],
    });
    const members: MemberDocumentV1[] = [];
    for (const entry of memberEntries) {
      const slotText = entry.kind === "file" && entry.name.endsWith(".json")
        ? entry.name.slice(0, -".json".length)
        : undefined;
      const slotId = slotText === undefined ? undefined : decodeSlotId(slotText);
      if (slotId === undefined) {
        return yield* Effect.fail(sourceInvalid("member", ["runs", input.runId, "members"]));
      }
      const memberJson = yield* requiredJson({
        fileSystem: input.fileSystem,
        file: runPath(input.root, input.runId, "members", entry.name),
        maximumBytes: RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
        document: "member",
        path: ["runs", input.runId, "members", entry.name],
      });
      const member = decodeMemberDocumentV1(memberJson);
      if (Either.isLeft(member) || member.right.slotId !== slotId) {
        return yield* Effect.fail(
          sourceInvalid("member", ["runs", input.runId, "members", entry.name]),
        );
      }
      members.push(member.right);
    }

    const attemptEntries = yield* optionalDirectory({
      fileSystem: input.fileSystem,
      directory: runPath(input.root, input.runId, "attempts"),
      maximumEntries: RECORD_READER_MAXIMUM_CORE_DIRECTORY_ENTRIES,
      document: "attempt",
      path: ["runs", input.runId, "attempts"],
    });
    const attempts: AttemptDocumentV1[] = [];
    for (const entry of attemptEntries) {
      const attemptId = entry.kind === "directory" ? decodeAttemptId(entry.name) : undefined;
      if (attemptId === undefined) {
        return yield* Effect.fail(sourceInvalid("attempt", ["runs", input.runId, "attempts"]));
      }
      const attemptJson = yield* requiredJson({
        fileSystem: input.fileSystem,
        file: runPath(input.root, input.runId, "attempts", attemptId, "attempt.json"),
        maximumBytes: RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
        document: "attempt",
        path: ["runs", input.runId, "attempts", attemptId, "attempt.json"],
      });
      const attempt = decodeAttemptDocumentV1(attemptJson);
      if (
        Either.isLeft(attempt) ||
        attempt.right.attemptId !== attemptId ||
        attempt.right.originRunId !== input.runId
      ) {
        return yield* Effect.fail(
          sourceInvalid("attempt", ["runs", input.runId, "attempts", attemptId]),
        );
      }
      attempts.push(attempt.right);
    }

    return Object.freeze({
      run: run.right as RunDocumentV1,
      members: Object.freeze(members),
      attempts: Object.freeze(attempts),
    });
  });
}

function scanOwnerAttachments(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly owner: RecordAttachmentOwner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
}): Effect.Effect<
  readonly RecordMigrationAttachmentSource[],
  RecordMigrationStorageError
> {
  return Effect.gen(function* () {
    const base = attachmentBasePath(input);
    const entries = yield* optionalDirectory({
      fileSystem: input.fileSystem,
      directory: base,
      maximumEntries: RECORD_READER_MAXIMUM_CORE_DIRECTORY_ENTRIES,
      document: "attachment-envelope",
      path: [...base.segments],
    });
    const sources: RecordMigrationAttachmentSource[] = [];
    for (const entry of entries) {
      const name = entry.kind === "directory" ? decodeAttachmentName(entry.name) : undefined;
      if (name === undefined) {
        return yield* Effect.fail(sourceInvalid("attachment-envelope", [...base.segments]));
      }
      const directory = attachmentDirectory({ ...input, name });
      const envelopeJson = yield* requiredJson({
        fileSystem: input.fileSystem,
        file: recordPortablePath(input.root, ...directory.segments, "attachment.json"),
        maximumBytes: RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
        document: "attachment-envelope",
        path: [...directory.segments, "attachment.json"],
      });
      const envelope = decodeRecordAttachmentEnvelopeV1(envelopeJson);
      if (Either.isLeft(envelope) || envelope.right.name !== name) {
        return yield* Effect.fail(
          sourceInvalid("attachment-envelope", [...directory.segments, "attachment.json"]),
        );
      }
      sources.push(
        Object.freeze({
          directory,
          owner: input.owner,
          name,
          schemaId: envelope.right.schemaId,
        }),
      );
    }
    return Object.freeze(sources);
  });
}

function snapshotPortableTree(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly path: RecordPortablePath;
  readonly fingerprint: SourceFingerprint;
}): Effect.Effect<void, RecordMigrationStorageError> {
  return Effect.gen(function* () {
    const kind = yield* input.fileSystem.pathKind(input.path);
    input.fingerprint.addText(`path:${input.path.segments.join("/")}\u0000kind:${kind}\u0000`);
    if (kind === "file") {
      const bytes = yield* input.fileSystem.readFile({
        file: input.path,
        maximumBytes: RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_BYTES,
      });
      if (bytes === undefined) {
        return yield* Effect.fail(sourceInvalid("record-core", [...input.path.segments]));
      }
      input.fingerprint.addText(`bytes:${bytes.byteLength}\u0000`);
      input.fingerprint.addBytes(bytes);
      return;
    }
    if (kind !== "directory") {
      return;
    }
    const entries = yield* input.fileSystem.listDirectory({
      directory: input.path,
      maximumEntries: SNAPSHOT_DIRECTORY_MAXIMUM_ENTRIES,
    });
    if (!Array.isArray(entries) || !entries.every(validDirectoryEntry)) {
      return yield* Effect.fail(sourceInvalid("record-core", [...input.path.segments]));
    }
    for (const entry of sortedEntries(entries)) {
      input.fingerprint.addText(`entry:${entry.name}\u0000`);
      yield* snapshotPortableTree({
        fileSystem: input.fileSystem,
        path: recordPortablePath(input.path.root, ...input.path.segments, entry.name),
        fingerprint: input.fingerprint,
      });
    }
  });
}

function inspectCurrentV1Source(
  root: RecordRoot,
): Effect.Effect<RecordMigrationSource<RecordCoreV1>, RecordMigrationStorageError, RecordFileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* RecordFileSystem;
    const current = yield* readCurrentRecordFormat(fileSystem, root).pipe(
      Effect.catchTag("RecordBootstrapInvalid", () =>
        Effect.fail(sourceInvalid("record", ["record.json"])),
      ),
      Effect.catchTag("RecordMigrationRequired", () =>
        Effect.fail(sourceInvalid("record", ["record.json", "format"])),
      ),
      Effect.catchTag("RecordFormatUnsupported", () =>
        Effect.fail(sourceInvalid("record", ["record.json", "format"])),
      ),
    );
    const runIds = yield* publishedRunIds(fileSystem, root);
    const runs = yield* Effect.forEach(runIds, (runId) =>
      loadRunCore({ fileSystem, root, runId }),
    );
    const core = decodeRecordCoreV1({
      record: current.document,
      runs,
    });
    if (Either.isLeft(core)) {
      return yield* Effect.fail(core.left);
    }

    const attachments: RecordMigrationAttachmentSource[] = [];
    for (const run of core.right.runs) {
      attachments.push(
        ...(yield* scanOwnerAttachments({
          fileSystem,
          root,
          owner: "run",
          runId: run.run.runId,
        })),
      );
      for (const attempt of run.attempts) {
        attachments.push(
          ...(yield* scanOwnerAttachments({
            fileSystem,
            root,
            owner: "attempt",
            runId: run.run.runId,
            attemptId: attempt.attemptId,
          })),
        );
      }
    }

    const fingerprint = new SourceFingerprint();
    yield* snapshotPortableTree({
      fileSystem,
      path: recordPortablePath(root),
      fingerprint,
    });
    return Object.freeze({
      root,
      fingerprint: fingerprint.finish(),
      core: Object.freeze({
        format: current.document.format,
        value: core.right,
      }),
      attachments: Object.freeze(attachments),
    });
  });
}

/**
 * The only concrete adapter available today. Current v1 has no historic Core
 * format and the Attachment runtime intentionally does not expose historic
 * definitions to this layout adapter. A future adapter may opt into the
 * generic seam once it can materialize that exact source value and rewrite a
 * closure without guessing or leaving surplus blob files behind.
 */
export const CurrentRecordMigrationStorage: RecordMigrationStorage<RecordCoreV1> =
  Object.freeze({
    inspectSource: (input: {
      readonly root: RecordRoot;
      readonly attachments: RecordAttachmentRegistry;
    }) => inspectCurrentV1Source(input.root),
    isSourceCurrent: (source: RecordMigrationSource<RecordCoreV1>) =>
      Effect.map(inspectCurrentV1Source(source.root), (current) =>
        current.fingerprint === source.fingerprint,
      ),
    preflightAttachmentMigration: () =>
      Effect.succeed(
        Object.freeze({
          state: "migration-unavailable" as const,
          reason: "current-record-v1-layout-cannot-materialize-historic-attachment-schema",
        }),
      ),
    stageCore: () => Effect.void,
    readAttachment: (_input: {
      readonly source: RecordMigrationAttachmentSource;
      readonly family: RecordAttachmentFamily<RecordAttachmentOwner, unknown>;
    }) =>
      Effect.die(
        new Error("Current Record v1 storage refused an unmaterialized historic Attachment"),
      ),
    convertAttachment: (_input: {
      readonly edge: RecordAttachmentMigrationEdge<RecordAttachmentOwner>;
      readonly source: RecordAttachmentValue<unknown>;
    }) =>
      Effect.die(
        new Error("Current Record v1 storage refused an unmaterialized historic Attachment"),
      ),
    persistAttachment: (_input: {
      readonly source: RecordMigrationAttachmentSource;
      readonly targetCore: RecordCoreV1;
      readonly edge: RecordAttachmentMigrationEdge<RecordAttachmentOwner>;
      readonly write: RecordAttachmentWrite<RecordAttachmentOwner, unknown, never>;
    }) =>
      Effect.die(
        new Error("Current Record v1 storage refused an unmaterialized historic Attachment"),
      ),
    preserveAttachment: () => Effect.void,
    writeRecordDocumentLast: (input: {
      readonly source: RecordMigrationSource<RecordCoreV1>;
      readonly value: RecordCoreV1;
    }) =>
      Effect.gen(function* () {
        const fileSystem = yield* RecordFileSystem;
        const encoded = encodeRecordDocumentV1(input.value.record);
        if (Either.isLeft(encoded)) {
          return yield* Effect.fail(encoded.left);
        }
        const json = JSON.stringify(encoded.right);
        if (json === undefined) {
          throw new Error("Record v1 document codec produced a non-JSON value");
        }
        yield* fileSystem.writeFile({
          file: recordPortablePath(input.source.root, "record.json"),
          bytes: new TextEncoder().encode(json),
          maximumBytes: RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
          mode: "replace",
        });
        yield* fileSystem.syncDirectory(recordPortablePath(input.source.root));
      }),
  });
