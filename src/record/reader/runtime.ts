import { Effect, Either, Schema, Stream } from "effect";
import { decodeJsonRecordAttachmentPayload } from "../attachment/index.ts";
import {
  makeRecordAttachmentValue,
  makeRecordBlobRef,
  recordAttachmentFamilyCurrentDefinition,
  recordAttachmentFamilyOwner,
  resolveRecordAttachmentMigration,
  type RecordAttachmentMaterializedBlob,
} from "../attachment/internal.ts";
import type {
  JsonRecordAttachmentDefinition,
  RecordAttachmentFamily,
  RecordAttachmentValue,
  RecordBlobRef,
} from "../attachment/types.ts";
import {
  decodeRecordAttachmentEnvelopeV1,
  decodeAttemptDocumentV1,
  decodeMemberDocumentV1,
  decodeRunDocumentV1,
} from "../codec/core.ts";
import {
  AttemptIdSchema,
  RunIdSchema,
  SlotIdSchema,
} from "../codec/identifiers.ts";
import {
  nonEmptyRecordIssues,
  recordIssue,
  type NonEmptyRecordIssues,
  type RecordIssue,
} from "../errors/record-errors.ts";
import type {
  AttemptDocumentV1,
  MemberDocumentV1,
  RecordAttachmentOwner,
  RecordAttemptRef,
  RunDocumentV1,
} from "../model/core.ts";
import {
  compareCanonicalIdentity,
  isPortableSegment,
  type AttemptId,
  type RunId,
  type SlotId,
} from "../model/identifiers.ts";
import type {
  RecordAttachmentRead,
  RecordCoreRead,
  RecordWarning,
} from "../model/read-state.ts";
import {
  RecordPathTypeInvalid,
  RecordResourceLimitExceeded,
  type RecordFileSystemError,
} from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import {
  RecordFileSystem,
  RecordMaintenanceLock,
  recordPortablePath,
  type RecordDirectoryEntry,
  type RecordFileSystemService,
} from "../platform/services.ts";
import {
  RecordHandleInvalid,
  RecordMigrationInterruptedState,
  RecordReaderClosed,
  type RecordReaderOpenError,
  type RecordReaderReadError,
} from "./errors.ts";
import {
  makeExactHandleRegistry,
  makeReaderLifecycle,
  type ExactHandleRegistry,
} from "./identity.ts";
import { readCurrentRecordFormat } from "./format.ts";
import {
  registerFrozenRecordReaderPort,
  type FrozenRecordReaderPort,
} from "./internal.ts";
import {
  frozenRecordAttemptBrand,
  frozenRecordRunBrand,
  frozenRecordViewBrand,
  type FrozenRecordAttempt,
  type FrozenRecordRun,
  type RecordReader,
} from "./types.ts";

/** A root entry is deliberately small, while Core and Attachment documents get their own caps. */
export const RECORD_READER_MAXIMUM_RUN_ENTRIES = 100_000;
export const RECORD_READER_MAXIMUM_CORE_DIRECTORY_ENTRIES = 100_000;
export const RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES = 1024 * 1024;
export const RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_ENTRIES = 100_000;
export const RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_BYTES = 64 * 1024 * 1024;
export const RECORD_READER_MAXIMUM_ATTACHMENT_TOTAL_BYTES = 128 * 1024 * 1024;

/** The storage-side ref codec reserves this exact one-property JSON object. */
export const RECORD_DURABLE_BLOB_REF_KEY = "$niceeval.record.blob";

type JsonDocument =
  | { readonly state: "available"; readonly value: unknown }
  | { readonly state: "missing" }
  | { readonly state: "invalid" };

type DirectoryContents =
  | { readonly state: "available"; readonly entries: readonly RecordDirectoryEntry[] }
  | { readonly state: "missing" }
  | { readonly state: "invalid" };

interface LoadedRunCore {
  readonly run: RunDocumentV1;
  readonly members: ReadonlyMap<SlotId, MemberDocumentV1>;
  readonly attempts: ReadonlyMap<AttemptId, AttemptDocumentV1>;
}

type LoadedRunCoreRead =
  | { readonly state: "available"; readonly value: LoadedRunCore }
  | { readonly state: "missing" }
  | { readonly state: "core-invalid"; readonly issues: NonEmptyRecordIssues };

interface MemberAtPath {
  readonly document: MemberDocumentV1;
}

interface AttemptAtPath {
  readonly attemptId: AttemptId;
  readonly document: AttemptDocumentV1;
}

interface FrozenRunContents {
  readonly runId: RunId;
}

interface FrozenAttemptContents {
  readonly ref: RecordAttemptRef;
}

const missingDocument: JsonDocument = Object.freeze({ state: "missing" });
const invalidDocument: JsonDocument = Object.freeze({ state: "invalid" });
const missingDirectory: DirectoryContents = Object.freeze({ state: "missing" });
const invalidDirectory: DirectoryContents = Object.freeze({ state: "invalid" });
const missingCore: LoadedRunCoreRead = Object.freeze({ state: "missing" });

function missingRead<Value>(): RecordCoreRead<Value> {
  return Object.freeze({ state: "missing" as const });
}

function readerClosed(): RecordReaderClosed {
  return new RecordReaderClosed({ code: "record-reader-closed" });
}

function handleInvalid(): RecordHandleInvalid {
  return new RecordHandleInvalid({ code: "record-handle-invalid" });
}

function migrationInterrupted(): RecordMigrationInterruptedState {
  return new RecordMigrationInterruptedState({
    code: "record-migration-interrupted",
  });
}

function loadedCoreInvalid(issues: readonly RecordIssue[]): LoadedRunCoreRead {
  const nonEmpty = nonEmptyRecordIssues(issues);
  if (nonEmpty === undefined) {
    throw new Error("Loaded Record core invalid state requires at least one issue");
  }
  return Object.freeze({ state: "core-invalid" as const, issues: nonEmpty });
}

function schemaIssue(path: readonly string[]): RecordIssue {
  return recordIssue("record-schema-invalid", path);
}

function codecIssues(
  issues: readonly RecordIssue[],
  prefix: readonly string[],
): readonly RecordIssue[] {
  return issues.map((issue) => recordIssue(issue.code, [...prefix, ...issue.path]));
}

function parseJson(bytes: Uint8Array): JsonDocument {
  try {
    return Object.freeze({
      state: "available" as const,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    });
  } catch {
    return invalidDocument;
  }
}

/**
 * Durable malformed files become data-state input. I/O, permission, forged
 * portable paths, and invalid resource requests deliberately remain typed E.
 */
function readJsonDocument(
  fileSystem: RecordFileSystemService,
  path: ReturnType<typeof recordPortablePath>,
  maximumBytes: number,
): Effect.Effect<JsonDocument, RecordFileSystemError> {
  return fileSystem.readFile({ file: path, maximumBytes }).pipe(
    Effect.map((bytes) => {
      if (bytes === undefined) {
        return missingDocument;
      }
      return bytes.byteLength > maximumBytes ? invalidDocument : parseJson(bytes);
    }),
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(invalidDocument)),
    Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(invalidDocument)),
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

function sortedEntries(entries: readonly RecordDirectoryEntry[]): readonly RecordDirectoryEntry[] {
  return Object.freeze(
    [...entries]
      .map((entry) => Object.freeze({ name: entry.name, kind: entry.kind }))
      .sort((left, right) => compareCanonicalIdentity(left.name, right.name)),
  );
}

/** A missing optional Core directory is empty; a non-directory is corrupt. */
function readDirectory(
  fileSystem: RecordFileSystemService,
  directory: ReturnType<typeof recordPortablePath>,
  maximumEntries: number,
): Effect.Effect<DirectoryContents, RecordFileSystemError> {
  return fileSystem.pathKind(directory).pipe(
    Effect.flatMap((kind) => {
      if (kind === "missing") {
        return Effect.succeed(missingDirectory);
      }
      if (kind !== "directory") {
        return Effect.succeed(invalidDirectory);
      }
      return fileSystem.listDirectory({ directory, maximumEntries }).pipe(
        Effect.map((entries): DirectoryContents => {
          if (!Array.isArray(entries) || !entries.every(validDirectoryEntry)) {
            return invalidDirectory;
          }
          return Object.freeze({
            state: "available" as const,
            entries: sortedEntries(entries),
          });
        }),
      );
    }),
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(invalidDirectory)),
  );
}

function decodeRunId(value: unknown): RunId | undefined {
  const decoded = Schema.decodeUnknownEither(RunIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function decodeSlotId(value: unknown): SlotId | undefined {
  const decoded = Schema.decodeUnknownEither(SlotIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function decodeAttemptId(value: unknown): AttemptId | undefined {
  const decoded = Schema.decodeUnknownEither(AttemptIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function slotIdFromMemberFileName(name: string): SlotId | undefined {
  if (!name.endsWith(".json")) {
    return undefined;
  }
  const slotText = name.slice(0, -".json".length);
  return decodeSlotId(slotText);
}

function runPath(root: RecordRoot, runId: RunId, ...segments: readonly string[]) {
  return recordPortablePath(root, "runs", runId, ...segments);
}

function readMember(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
  entry: RecordDirectoryEntry,
): Effect.Effect<MemberAtPath | undefined, RecordFileSystemError> {
  const slotId = entry.kind === "file" ? slotIdFromMemberFileName(entry.name) : undefined;
  if (slotId === undefined) {
    return Effect.succeed(undefined);
  }
  return Effect.map(
    readJsonDocument(
      fileSystem,
      runPath(root, runId, "members", entry.name),
      RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
    ),
    (document): MemberAtPath | undefined => {
      if (document.state !== "available") {
        return undefined;
      }
      const decoded = decodeMemberDocumentV1(document.value);
      return Either.isRight(decoded) && decoded.right.slotId === slotId
        ? Object.freeze({ document: decoded.right })
        : undefined;
    },
  );
}

function readAttempt(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
  entry: RecordDirectoryEntry,
): Effect.Effect<AttemptAtPath | undefined, RecordFileSystemError> {
  const attemptId = entry.kind === "directory" ? decodeAttemptId(entry.name) : undefined;
  if (attemptId === undefined) {
    return Effect.succeed(undefined);
  }
  return Effect.map(
    readJsonDocument(
      fileSystem,
      runPath(root, runId, "attempts", attemptId, "attempt.json"),
      RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
    ),
    (document): AttemptAtPath | undefined => {
      if (document.state !== "available") {
        return undefined;
      }
      const decoded = decodeAttemptDocumentV1(document.value);
      return Either.isRight(decoded) &&
          decoded.right.attemptId === attemptId &&
          decoded.right.originRunId === runId
        ? Object.freeze({ attemptId, document: decoded.right })
        : undefined;
    },
  );
}

function readExactReferencedAttempt(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  candidates: ReadonlySet<RunId>,
  ref: RecordAttemptRef,
): Effect.Effect<boolean, RecordFileSystemError> {
  if (!candidates.has(ref.originRunId)) {
    return Effect.succeed(false);
  }
  return Effect.map(
    readJsonDocument(
      fileSystem,
      runPath(root, ref.originRunId, "attempts", ref.attemptId, "attempt.json"),
      RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
    ),
    (document) => {
      if (document.state !== "available") {
        return false;
      }
      const decoded = decodeAttemptDocumentV1(document.value);
      return Either.isRight(decoded) &&
        decoded.right.attemptId === ref.attemptId &&
        decoded.right.originRunId === ref.originRunId;
    },
  );
}

function localCoreIssues(
  runId: RunId,
  run: RunDocumentV1,
  members: readonly MemberAtPath[],
  attempts: readonly AttemptAtPath[],
): { readonly issues: readonly RecordIssue[]; readonly foreignRefs: readonly RecordAttemptRef[] } {
  const issues: RecordIssue[] = [];
  const expected = new Set<SlotId>(run.expectedSlots);
  const seenSlots = new Set<SlotId>();
  const attemptsById = new Map<AttemptId, AttemptDocumentV1>();
  const originMemberCounts = new Map<AttemptId, number>();
  const foreignRefs = new Map<string, RecordAttemptRef>();

  for (const [index, attempt] of attempts.entries()) {
    if (attemptsById.has(attempt.attemptId)) {
      issues.push(recordIssue("record-attempt-duplicate", ["attempts", String(index)]));
      continue;
    }
    attemptsById.set(attempt.attemptId, attempt.document);
    if (attempt.document.originRunId !== runId) {
      issues.push(recordIssue("record-attempt-owner-invalid", ["attempts", String(index), "originRunId"]));
    }
  }

  for (const [index, member] of members.entries()) {
    const path = ["members", String(index)];
    if (!expected.has(member.document.slotId)) {
      issues.push(recordIssue("record-member-slot-unexpected", [...path, "slotId"]));
    }
    if (seenSlots.has(member.document.slotId)) {
      issues.push(recordIssue("record-member-slot-duplicate", [...path, "slotId"]));
    }
    seenSlots.add(member.document.slotId);

    if (member.document.attempt.originRunId === runId) {
      const attempted = attemptsById.get(member.document.attempt.attemptId);
      if (attempted === undefined) {
        issues.push(recordIssue("record-attempt-reference-missing", [...path, "attempt"]));
        continue;
      }
      originMemberCounts.set(
        member.document.attempt.attemptId,
        (originMemberCounts.get(member.document.attempt.attemptId) ?? 0) + 1,
      );
      continue;
    }

    const key = `${member.document.attempt.originRunId}\u0000${member.document.attempt.attemptId}`;
    foreignRefs.set(key, member.document.attempt);
  }

  for (const [attemptId] of attemptsById) {
    const count = originMemberCounts.get(attemptId) ?? 0;
    if (count === 0) {
      issues.push(recordIssue("record-origin-member-missing", ["attempts", attemptId]));
    } else if (count > 1) {
      issues.push(recordIssue("record-origin-member-duplicate", ["attempts", attemptId]));
    }
  }

  return Object.freeze({
    issues: Object.freeze(issues),
    foreignRefs: Object.freeze([...foreignRefs.values()]),
  });
}

function readRunCore(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  candidates: ReadonlySet<RunId>,
  runId: RunId,
): Effect.Effect<LoadedRunCoreRead, RecordFileSystemError> {
  return Effect.gen(function* () {
    const runDocument = yield* readJsonDocument(
      fileSystem,
      runPath(root, runId, "run.json"),
      RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
    );
    if (runDocument.state !== "available") {
      return loadedCoreInvalid([schemaIssue(["run.json"])]);
    }
    const decodedRun = decodeRunDocumentV1(runDocument.value);
    if (Either.isLeft(decodedRun) || decodedRun.right.runId !== runId) {
      return loadedCoreInvalid(
        Either.isLeft(decodedRun)
          ? codecIssues(decodedRun.left.issues, ["run.json"])
          : [schemaIssue(["run.json", "runId"])],
      );
    }

    const membersDirectory = yield* readDirectory(
      fileSystem,
      runPath(root, runId, "members"),
      RECORD_READER_MAXIMUM_CORE_DIRECTORY_ENTRIES,
    );
    const attemptsDirectory = yield* readDirectory(
      fileSystem,
      runPath(root, runId, "attempts"),
      RECORD_READER_MAXIMUM_CORE_DIRECTORY_ENTRIES,
    );
    if (membersDirectory.state === "invalid" || attemptsDirectory.state === "invalid") {
      return loadedCoreInvalid([schemaIssue(["runs", runId])]);
    }

    const members = membersDirectory.state === "available"
      ? yield* Effect.forEach(
          membersDirectory.entries,
          (entry) => readMember(fileSystem, root, runId, entry),
        )
      : [];
    if (members.some((member) => member === undefined)) {
      return loadedCoreInvalid([schemaIssue(["members"])]);
    }

    const attempts = attemptsDirectory.state === "available"
      ? yield* Effect.forEach(
          attemptsDirectory.entries,
          (entry) => readAttempt(fileSystem, root, runId, entry),
        )
      : [];
    if (attempts.some((attempt) => attempt === undefined)) {
      return loadedCoreInvalid([schemaIssue(["attempts"])]);
    }

    const validMembers = members as readonly MemberAtPath[];
    const validAttempts = attempts as readonly AttemptAtPath[];
    const local = localCoreIssues(runId, decodedRun.right, validMembers, validAttempts);
    const foreignExistence = yield* Effect.forEach(local.foreignRefs, (ref) =>
      readExactReferencedAttempt(fileSystem, root, candidates, ref),
    );
    const issues = [...local.issues];
    for (const [index, exists] of foreignExistence.entries()) {
      if (!exists) {
        issues.push(recordIssue("record-attempt-reference-missing", ["members", String(index), "attempt"]));
      }
    }
    if (issues.length > 0) {
      return loadedCoreInvalid(issues);
    }

    const byAttemptId = new Map<AttemptId, AttemptDocumentV1>();
    for (const attempt of validAttempts) {
      byAttemptId.set(attempt.attemptId, attempt.document);
    }
    const bySlotId = new Map<SlotId, MemberDocumentV1>();
    for (const member of validMembers) {
      bySlotId.set(member.document.slotId, member.document);
    }
    return Object.freeze({
      state: "available" as const,
      value: Object.freeze({
        run: decodedRun.right,
        members: bySlotId,
        attempts: byAttemptId,
      }),
    });
  });
}

type BlobDirectoryContents =
  | { readonly state: "available"; readonly entries: readonly RecordDirectoryEntry[] }
  | { readonly state: "missing" }
  | { readonly state: "invalid" };

interface HydratedPayload {
  readonly value: unknown;
  readonly refsByKey: ReadonlyMap<string, RecordBlobRef>;
  readonly invalid: boolean;
}

interface AttachmentLocation {
  readonly owner: RecordAttachmentOwner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
}

function attachmentInvalid<Payload>(
  path: readonly string[],
): RecordAttachmentRead<RecordAttachmentValue<Payload>> {
  return Object.freeze({
    state: "invalid" as const,
    issues: nonEmptyRecordIssues([schemaIssue(path)])!,
  });
}

function attachmentDirectoryPath(
  root: RecordRoot,
  location: AttachmentLocation,
  name: string,
  ...segments: readonly string[]
) {
  return location.owner === "run"
    ? recordPortablePath(root, "runs", location.runId, "attachments", name, ...segments)
    : recordPortablePath(
        root,
        "runs",
        location.runId,
        "attempts",
        location.attemptId!,
        "attachments",
        name,
        ...segments,
      );
}

function readBlobDirectory(
  fileSystem: RecordFileSystemService,
  directory: ReturnType<typeof recordPortablePath>,
): Effect.Effect<BlobDirectoryContents, RecordFileSystemError> {
  return fileSystem.pathKind(directory).pipe(
    Effect.flatMap((kind) => {
      if (kind === "missing") {
        return Effect.succeed(Object.freeze({ state: "missing" as const }));
      }
      if (kind !== "directory") {
        return Effect.succeed(Object.freeze({ state: "invalid" as const }));
      }
      return fileSystem.listDirectory({
        directory,
        maximumEntries: RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_ENTRIES,
      }).pipe(
        Effect.map((entries): BlobDirectoryContents => {
          if (
            !Array.isArray(entries) ||
            !entries.every(
              (entry) =>
                validDirectoryEntry(entry) &&
                entry.kind === "file" &&
                isPortableSegment(entry.name),
            )
          ) {
            return Object.freeze({ state: "invalid" as const });
          }
          const sorted = sortedEntries(entries);
          const names = new Set<string>();
          for (const entry of sorted) {
            if (names.has(entry.name)) {
              return Object.freeze({ state: "invalid" as const });
            }
            names.add(entry.name);
          }
          return Object.freeze({ state: "available" as const, entries: sorted });
        }),
      );
    }),
    Effect.catchTag("RecordPathTypeInvalid", () =>
      Effect.succeed(Object.freeze({ state: "invalid" as const })),
    ),
  );
}

function hydrateDurablePayload(input: unknown): HydratedPayload {
  const refsByKey = new Map<string, RecordBlobRef>();
  let invalid = false;

  const hydrate = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(hydrate);
    }
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    if (keys.length === 1 && keys[0] === RECORD_DURABLE_BLOB_REF_KEY) {
      if (typeof source[RECORD_DURABLE_BLOB_REF_KEY] !== "string") {
        invalid = true;
        return source;
      }
      const key = source[RECORD_DURABLE_BLOB_REF_KEY];
      if (!isPortableSegment(key)) {
        invalid = true;
        return source;
      }
      const existing = refsByKey.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const ref = makeRecordBlobRef();
      refsByKey.set(key, ref);
      return ref;
    }
    const clone: Record<string, unknown> = {};
    for (const key of keys) {
      Object.defineProperty(clone, key, {
        value: hydrate(source[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  };

  try {
    return Object.freeze({ value: hydrate(input), refsByKey, invalid });
  } catch {
    return Object.freeze({ value: input, refsByKey, invalid: true });
  }
}

function readAttachmentBlob(
  fileSystem: RecordFileSystemService,
  file: ReturnType<typeof recordPortablePath>,
): Effect.Effect<Uint8Array | undefined, RecordFileSystemError> {
  return fileSystem.readFile({
    file,
    maximumBytes: RECORD_READER_MAXIMUM_ATTACHMENT_BLOB_BYTES,
  }).pipe(
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)),
  );
}

function attachmentBytesExceeded(path: string, observedAtLeast: number): RecordResourceLimitExceeded {
  return new RecordResourceLimitExceeded({
    code: "record-resource-limit-exceeded",
    resource: "file-bytes",
    maximum: RECORD_READER_MAXIMUM_ATTACHMENT_TOTAL_BYTES,
    observedAtLeast,
    path,
  });
}

function readAttachment<Owner extends RecordAttachmentOwner, Payload>(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: AttachmentLocation & { readonly owner: Owner };
  readonly family: RecordAttachmentFamily<Owner, Payload>;
  readonly definition: JsonRecordAttachmentDefinition<Owner, Payload>;
}): Effect.Effect<
  RecordAttachmentRead<RecordAttachmentValue<Payload>>,
  RecordFileSystemError
> {
  return Effect.gen(function* () {
    const directory = attachmentDirectoryPath(
      input.root,
      input.location,
      input.definition.name,
    );
    const directoryKind = yield* input.fileSystem.pathKind(directory);
    if (directoryKind === "missing") {
      return Object.freeze({ state: "unavailable" as const });
    }
    if (directoryKind !== "directory") {
      return attachmentInvalid<Payload>(["attachment"]);
    }

    const envelopeDocument = yield* readJsonDocument(
      input.fileSystem,
      attachmentDirectoryPath(input.root, input.location, input.definition.name, "attachment.json"),
      RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
    );
    if (envelopeDocument.state !== "available") {
      return attachmentInvalid<Payload>(["attachment.json"]);
    }
    const envelope = decodeRecordAttachmentEnvelopeV1(envelopeDocument.value);
    if (Either.isLeft(envelope) || envelope.right.name !== input.definition.name) {
      return attachmentInvalid<Payload>(["attachment.json"]);
    }

    const payloadDocument = yield* readJsonDocument(
      input.fileSystem,
      attachmentDirectoryPath(input.root, input.location, input.definition.name, "payload.json"),
      RECORD_READER_MAXIMUM_CORE_DOCUMENT_BYTES,
    );
    if (payloadDocument.state !== "available") {
      return attachmentInvalid<Payload>(["payload.json"]);
    }
    const blobDirectory = yield* readBlobDirectory(
      input.fileSystem,
      attachmentDirectoryPath(input.root, input.location, input.definition.name, "blobs"),
    );
    if (blobDirectory.state === "invalid") {
      return attachmentInvalid<Payload>(["blobs"]);
    }

    // The owner-local ref codec is independent of the typed family version, so
    // a broken closure is still invalid before an old-version migration state.
    const hydrated = hydrateDurablePayload(payloadDocument.value);
    if (hydrated.invalid) {
      return attachmentInvalid<Payload>(["payload.json"]);
    }
    const entries = blobDirectory.state === "available" ? blobDirectory.entries : [];
    const entriesByKey = new Map(entries.map((entry) => [entry.name, entry] as const));
    if (
      entriesByKey.size !== hydrated.refsByKey.size ||
      [...hydrated.refsByKey.keys()].some((key) => !entriesByKey.has(key))
    ) {
      return attachmentInvalid<Payload>(["blobs"]);
    }

    const migration = resolveRecordAttachmentMigration(input.family, envelope.right.schemaId);
    if (migration === undefined) {
      return attachmentInvalid<Payload>(["attachment.json", "schemaId"]);
    }
    if (migration.state === "unsupported") {
      return Object.freeze({ state: "unsupported" as const, schemaId: envelope.right.schemaId });
    }
    if (migration.state === "migration-required") {
      return Object.freeze({
        state: "migration-required" as const,
        from: migration.from,
        to: migration.to,
        command: "niceeval migrate" as const,
      });
    }
    if (migration.state === "migration-unavailable") {
      return Object.freeze({
        state: "migration-unavailable" as const,
        from: migration.from,
        to: migration.to,
        reason: migration.reason,
      });
    }

    const payload = decodeJsonRecordAttachmentPayload(input.definition, hydrated.value);
    if (Either.isLeft(payload)) {
      return attachmentInvalid<Payload>(["payload.json"]);
    }

    let totalBytes = 0;
    const materialized: RecordAttachmentMaterializedBlob[] = [];
    for (const [key, ref] of hydrated.refsByKey) {
      const bytes = yield* readAttachmentBlob(
        input.fileSystem,
        attachmentDirectoryPath(input.root, input.location, input.definition.name, "blobs", key),
      );
      if (bytes === undefined) {
        return attachmentInvalid<Payload>(["blobs", key]);
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > RECORD_READER_MAXIMUM_ATTACHMENT_TOTAL_BYTES) {
        return yield* Effect.fail(attachmentBytesExceeded(`blobs/${key}`, totalBytes));
      }
      materialized.push(Object.freeze({ ref, bytes }));
    }

    const value = makeRecordAttachmentValue(input.definition, payload.right, materialized);
    return Either.isLeft(value)
      ? attachmentInvalid<Payload>(["payload.json"])
      : Object.freeze({ state: "available" as const, value: value.right });
  });
}

interface DiscoveredRuns {
  readonly candidates: readonly RunId[];
  readonly warnings: readonly RecordWarning[];
}

function discoverRuns(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
): Effect.Effect<DiscoveredRuns, RecordFileSystemError> {
  return Effect.gen(function* () {
    const directory = yield* readDirectory(
      fileSystem,
      recordPortablePath(root, "runs"),
      RECORD_READER_MAXIMUM_RUN_ENTRIES,
    );
    if (directory.state === "missing") {
      return Object.freeze({ candidates: Object.freeze([]), warnings: Object.freeze([]) });
    }
    if (directory.state === "invalid") {
      return yield* Effect.fail(
        new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path: "runs",
          expected: "directory",
          actual: "other",
        }),
      );
    }

    const candidateIds = new Set<RunId>();
    const incompleteIds = new Set<RunId>();
    for (const entry of directory.entries) {
      const runId = entry.kind === "directory" ? decodeRunId(entry.name) : undefined;
      if (runId === undefined) {
        continue;
      }
      const marker = yield* fileSystem.pathKind(runPath(root, runId, "complete"));
      if (marker === "file") {
        candidateIds.add(runId);
      } else {
        incompleteIds.add(runId);
      }
    }
    const candidates = Object.freeze([...candidateIds].sort(compareCanonicalIdentity));
    const warnings = Object.freeze(
      [...incompleteIds]
        .sort(compareCanonicalIdentity)
        .map((runId) =>
          Object.freeze({
            code: "incomplete-run" as const,
            runId,
            cleanupCommand: "niceeval clean" as const,
          }),
        ),
    );
    return Object.freeze({ candidates, warnings });
  });
}

function mapRunRead(
  state: LoadedRunCoreRead,
  create: (core: LoadedRunCore) => FrozenRecordRun,
): RecordCoreRead<FrozenRecordRun> {
  switch (state.state) {
    case "available":
      return Object.freeze({ state: "available" as const, value: create(state.value) });
    case "missing":
      return missingRead();
    case "core-invalid":
      return Object.freeze({ state: "core-invalid" as const, issues: state.issues });
  }
}

function mapAttemptRead(
  state: LoadedRunCoreRead,
  attemptId: AttemptId,
  create: (attempt: AttemptDocumentV1) => FrozenRecordAttempt,
): RecordCoreRead<FrozenRecordAttempt> {
  switch (state.state) {
    case "available": {
      const attempt = state.value.attempts.get(attemptId);
      return attempt === undefined
        ? missingRead()
        : Object.freeze({ state: "available" as const, value: create(attempt) });
    }
    case "missing":
      return missingRead();
    case "core-invalid":
      return Object.freeze({ state: "core-invalid" as const, issues: state.issues });
  }
}

function mapMemberRead(
  state: LoadedRunCoreRead,
  slotId: SlotId,
): RecordCoreRead<MemberDocumentV1> {
  switch (state.state) {
    case "available": {
      const member = state.value.members.get(slotId);
      return member === undefined
        ? missingRead()
        : Object.freeze({ state: "available" as const, value: member });
    }
    case "missing":
      return missingRead();
    case "core-invalid":
      return Object.freeze({ state: "core-invalid" as const, issues: state.issues });
  }
}

/**
 * Open the current Record major under the shared maintenance lock. Discovery
 * keeps only the bounded candidate RunId index; Core work is deferred to the
 * individual `run`, `attempt`, or `runs` operation.
 */
export function openRecordReader(input: {
  readonly root: RecordRoot;
}): Effect.Effect<
  RecordReader<RecordReaderReadError>,
  RecordReaderOpenError,
  | import("effect").Scope.Scope
  | RecordFileSystem
  | RecordMaintenanceLock
> {
  return Effect.gen(function* () {
    const fileSystem = yield* RecordFileSystem;
    const maintenance = yield* RecordMaintenanceLock;
    yield* maintenance.acquireShared(input.root);

    if (yield* fileSystem.migrationSentinelPresent(input.root)) {
      return yield* Effect.fail(migrationInterrupted());
    }
    yield* readCurrentRecordFormat(fileSystem, input.root);
    const discovered = yield* discoverRuns(fileSystem, input.root);
    const candidates = new Set<RunId>(discovered.candidates);
    const lifecycle = makeReaderLifecycle<RecordReaderReadError>({ closed: readerClosed });
    yield* Effect.addFinalizer(() => Effect.sync(lifecycle.close));

    const runHandles: ExactHandleRegistry<
      FrozenRecordRun,
      FrozenRunContents,
      RecordReaderReadError
    > = makeExactHandleRegistry(lifecycle, { invalid: handleInvalid });
    const viewHandles: ExactHandleRegistry<
      RecordReader<RecordReaderReadError>,
      undefined,
      RecordReaderReadError
    > = makeExactHandleRegistry(lifecycle, { invalid: handleInvalid });
    const attemptHandles: ExactHandleRegistry<
      FrozenRecordAttempt,
      FrozenAttemptContents,
      RecordReaderReadError
    > = makeExactHandleRegistry(lifecycle, { invalid: handleInvalid });
    const coreByRun = new Map<RunId, LoadedRunCoreRead>();
    const frozenRuns = new Map<RunId, FrozenRecordRun>();
    const frozenAttempts = new Map<string, FrozenRecordAttempt>();

    const assertLive = (): Effect.Effect<void, RecordReaderReadError> => {
      const live = lifecycle.assertLive();
      return Either.isLeft(live) ? Effect.fail(live.left) : Effect.void;
    };

    const assertView = (view: unknown): Effect.Effect<void, RecordReaderReadError> =>
      Effect.suspend<void, RecordReaderReadError, never>(() => {
        const resolved = viewHandles.resolve(view as RecordReader<RecordReaderReadError>);
        return Either.isLeft(resolved) ? Effect.fail(resolved.left) : Effect.void;
      });

    const loadRun = (runId: RunId): Effect.Effect<LoadedRunCoreRead, RecordFileSystemError> =>
      Effect.suspend(() => {
        if (!candidates.has(runId)) {
          return Effect.succeed(missingCore);
        }
        const cached = coreByRun.get(runId);
        if (cached !== undefined) {
          return Effect.succeed(cached);
        }
        return readRunCore(fileSystem, input.root, candidates, runId).pipe(
          Effect.tap((state) =>
            Effect.sync(() => {
              coreByRun.set(runId, state);
            }),
          ),
        );
      });

    const freezeRun = (core: LoadedRunCore): FrozenRecordRun => {
      const existing = frozenRuns.get(core.run.runId);
      if (existing !== undefined) {
        return existing;
      }
      const run = Object.freeze({
        runId: core.run.runId,
        startedAt: core.run.startedAt,
        completedAt: core.run.completedAt,
        expectedSlots: Object.freeze([...core.run.expectedSlots]),
        [frozenRecordRunBrand]: (): void => undefined,
      }) as FrozenRecordRun;
      frozenRuns.set(core.run.runId, run);
      return runHandles.register(run, Object.freeze({ runId: core.run.runId }));
    };

    const freezeAttempt = (attempt: AttemptDocumentV1): FrozenRecordAttempt => {
      const key = `${attempt.originRunId}\u0000${attempt.attemptId}`;
      const existing = frozenAttempts.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const frozen = Object.freeze({
        attemptId: attempt.attemptId,
        originRunId: attempt.originRunId,
        [frozenRecordAttemptBrand]: (): void => undefined,
      }) as FrozenRecordAttempt;
      frozenAttempts.set(key, frozen);
      return attemptHandles.register(
        frozen,
        Object.freeze({
          ref: Object.freeze({ originRunId: attempt.originRunId, attemptId: attempt.attemptId }),
        }),
      );
    };

    const readRun = (runId: RunId): Effect.Effect<RecordCoreRead<FrozenRecordRun>, RecordReaderReadError> =>
      Effect.suspend<RecordCoreRead<FrozenRecordRun>, RecordReaderReadError, never>(() =>
        Effect.zipRight(
          assertLive(),
          Effect.map(loadRun(runId), (state) => mapRunRead(state, freezeRun)),
        ),
      );

    const readFrozenAttempt = (
      ref: RecordAttemptRef,
    ): Effect.Effect<RecordCoreRead<FrozenRecordAttempt>, RecordReaderReadError> => {
      const operation = Effect.suspend<
        RecordCoreRead<FrozenRecordAttempt>,
        RecordReaderReadError,
        never
      >(() => {
        const originRunId = decodeRunId(ref?.originRunId);
        const attemptId = decodeAttemptId(ref?.attemptId);
        if (originRunId === undefined || attemptId === undefined) {
          return Effect.zipRight(assertLive(), Effect.succeed(missingRead<FrozenRecordAttempt>()));
        }
        return Effect.zipRight(
          assertLive(),
          Effect.map(loadRun(originRunId), (state) =>
            mapAttemptRead(state, attemptId, freezeAttempt),
          ),
        );
      });
      return operation;
    };

    const readFrozenMember = (
      owner: FrozenRecordRun,
      slotId: SlotId,
    ): Effect.Effect<RecordCoreRead<MemberDocumentV1>, RecordReaderReadError> =>
      Effect.suspend<RecordCoreRead<MemberDocumentV1>, RecordReaderReadError, never>(
        () => {
          const resolved = runHandles.resolve(owner);
          if (Either.isLeft(resolved)) {
            return Effect.fail(resolved.left);
          }
          return Effect.zipRight(
            assertLive(),
            Effect.map(loadRun(resolved.right.runId), (state) =>
              mapMemberRead(state, slotId),
            ),
          );
        },
      );

    const readRunAttachmentForOwner = <Payload>(
      owner: FrozenRecordRun,
      family: RecordAttachmentFamily<"run", Payload>,
    ): Effect.Effect<
      RecordAttachmentRead<RecordAttachmentValue<Payload>>,
      RecordReaderReadError
    > =>
      Effect.suspend<
        RecordAttachmentRead<RecordAttachmentValue<Payload>>,
        RecordReaderReadError,
        never
      >(() => {
        const resolved = runHandles.resolve(owner);
        if (Either.isLeft(resolved)) {
          return Effect.fail(resolved.left);
        }
        const definition = recordAttachmentFamilyCurrentDefinition(family);
        if (recordAttachmentFamilyOwner(family) !== "run" || definition === undefined) {
          return Effect.fail(handleInvalid());
        }
        return readAttachment({
          fileSystem,
          root: input.root,
          location: Object.freeze({ owner: "run" as const, runId: resolved.right.runId }),
          family,
          definition,
        });
      });

    const readAttemptAttachmentForOwner = <Payload>(
      owner: FrozenRecordAttempt,
      family: RecordAttachmentFamily<"attempt", Payload>,
    ): Effect.Effect<
      RecordAttachmentRead<RecordAttachmentValue<Payload>>,
      RecordReaderReadError
    > =>
      Effect.suspend<
        RecordAttachmentRead<RecordAttachmentValue<Payload>>,
        RecordReaderReadError,
        never
      >(() => {
        const resolved = attemptHandles.resolve(owner);
        if (Either.isLeft(resolved)) {
          return Effect.fail(resolved.left);
        }
        const definition = recordAttachmentFamilyCurrentDefinition(family);
        if (recordAttachmentFamilyOwner(family) !== "attempt" || definition === undefined) {
          return Effect.fail(handleInvalid());
        }
        return readAttachment({
          fileSystem,
          root: input.root,
          location: Object.freeze({
            owner: "attempt" as const,
            runId: resolved.right.ref.originRunId,
            attemptId: resolved.right.ref.attemptId,
          }),
          family,
          definition,
        });
      });

    const runs = Stream.unwrap(
      Effect.suspend(() =>
        assertLive().pipe(
          Effect.map(() =>
            Stream.fromIterable(discovered.candidates).pipe(Stream.mapEffect(readRun)),
          ),
        ),
      ),
    );

    const reader: RecordReader<RecordReaderReadError> = Object.freeze({
      warnings: discovered.warnings,
      get runs(): Stream.Stream<RecordCoreRead<FrozenRecordRun>, RecordReaderReadError> {
        return Stream.unwrap(assertView(this).pipe(Effect.map(() => runs)));
      },
      run(this: RecordReader<RecordReaderReadError>, runId: RunId) {
        return Effect.zipRight(assertView(this), readRun(runId));
      },
      attempt(this: RecordReader<RecordReaderReadError>, ref: RecordAttemptRef) {
        return Effect.zipRight(assertView(this), readFrozenAttempt(ref));
      },
      readRunAttachment<Payload>(
        this: RecordReader<RecordReaderReadError>,
        owner: FrozenRecordRun,
        family: RecordAttachmentFamily<"run", Payload>,
      ) {
        return Effect.zipRight(assertView(this), readRunAttachmentForOwner(owner, family));
      },
      readAttemptAttachment<Payload>(
        this: RecordReader<RecordReaderReadError>,
        owner: FrozenRecordAttempt,
        family: RecordAttachmentFamily<"attempt", Payload>,
      ) {
        return Effect.zipRight(assertView(this), readAttemptAttachmentForOwner(owner, family));
      },
      [frozenRecordViewBrand]: (): void => undefined,
    });

    viewHandles.register(reader, undefined);
    const frozenPort: FrozenRecordReaderPort = {
      assertOpen: (view) => assertView(view),
      candidates: (view) =>
        Stream.unwrap(assertView(view).pipe(Effect.map(() => runs))),
      run: (view, runId) => Effect.zipRight(assertView(view), readRun(runId)),
      member: (view, owner, slotId) =>
        Effect.zipRight(assertView(view), readFrozenMember(owner, slotId)),
      attempt: (view, ref) =>
        Effect.zipRight(assertView(view), readFrozenAttempt(ref)),
      readRunAttachment: (view, owner, family) =>
        Effect.zipRight(
          assertView(view),
          readRunAttachmentForOwner(owner, family),
        ),
      readAttemptAttachment: (view, owner, family) =>
        Effect.zipRight(
          assertView(view),
          readAttemptAttachmentForOwner(owner, family),
        ),
    };
    registerFrozenRecordReaderPort(reader, frozenPort);

    return reader;
  });
}
