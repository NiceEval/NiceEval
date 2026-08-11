import { Deferred, Effect, Either, Exit, Schema } from "effect";
import {
  encodeJsonRecordAttachmentPayload,
} from "../attachment/index.ts";
import {
  recordAttachmentWriteContents,
} from "../attachment/internal.ts";
import {
  recordAttachmentClosureInvalid,
  recordAttachmentIssue,
  type RecordAttachmentPayloadInvalid,
} from "../attachment/errors.ts";
import type {
  RecordAttachmentJson,
  RecordAttachmentWrite,
  RecordBlobRef,
} from "../attachment/types.ts";
import {
  encodeAttemptDocumentV1,
  encodeMemberDocumentV1,
  encodeRecordAttachmentEnvelopeV1,
  encodeRunDocumentV1,
  RecordExactParseOptions,
  AttemptIdSchema,
  RunIdSchema,
} from "../codec/index.ts";
import {
  RecordCoreInvalid,
  RecordReferenceInvalid,
  nonEmptyRecordIssues,
  recordIssue,
  type RecordCodecError,
} from "../errors/record-errors.ts";
import type {
  AttemptDocumentV1,
  MemberDocumentV1,
  RecordAttemptRef,
  RecordAttachmentEnvelopeV1,
  RecordAttachmentOwner,
  RunDocumentV1,
} from "../model/core.ts";
import {
  isPortableSegment,
  type AttemptId,
  type RunId,
  type SlotId,
  type UtcMillis,
} from "../model/identifiers.ts";
import { validateExpectedSlots } from "../model/validation.ts";
import {
  RecordPathAlreadyExists,
  type RecordFileSystemError,
} from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import {
  RecordEntropy,
  RecordFileSystem,
  RecordMaintenanceLock,
  RecordWriterLock,
  recordPortablePath,
  type RecordEntropyService,
  type RecordFileSystemService,
  type RecordPortablePath,
} from "../platform/services.ts";
import {
  RecordHandleInvalid,
  RecordReaderClosed,
  type RecordReaderReadError,
} from "../reader/errors.ts";
import { openRecordReader } from "../reader/runtime.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordView,
} from "../reader/types.ts";
import {
  attachmentPayloadStrings,
  encodeAttachmentPayloadForStorage,
  encodeRecordAttachmentJsonBytes,
} from "./attachment-payload.ts";
import {
  recordAttachmentEncodeError,
  recordDraftHandleInvalid,
  recordDraftStateError,
  recordWriteSessionInvalid,
  recordWriterClosed,
  type RecordDraftLifecycleState,
  type RecordDraftOperation,
} from "./errors.ts";
import {
  recordAttemptDraftBrand,
  recordRunDraftBrand,
  recordWriteSessionBrand,
  type RecordAttemptDraft,
  type RecordPublishReceipt,
  type RecordRunDraft,
  type OpenRecordWriteSession,
  type RecordWriteError,
  type RecordWriteSession,
} from "./types.ts";

const JSON_MAXIMUM_BYTES = 4 * 1024 * 1024;
const BLOB_MAXIMUM_BYTES = 64 * 1024 * 1024;
const ENTROPY_RETRY_LIMIT = 16;

interface SessionRuntime {
  readonly root: RecordRoot;
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly fileSystem: RecordFileSystemService;
  readonly entropy: RecordEntropyService;
  readonly drafts: Set<DraftRuntime>;
  closed: boolean;
}

interface AttemptRuntime {
  readonly draft: DraftRuntime;
  readonly attemptId: AttemptId;
  readonly slotId: SlotId;
  readonly attachmentNames: Set<string>;
  handle: RecordAttemptDraft | undefined;
}

interface MemberRuntime {
  readonly document: MemberDocumentV1;
  readonly reference: FrozenRecordAttempt | undefined;
}

interface DraftRuntime {
  readonly session: SessionRuntime;
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
  readonly expectedSlotSet: ReadonlySet<string>;
  readonly mutex: Effect.Semaphore;
  readonly members: Map<string, MemberRuntime>;
  readonly attemptsById: Map<string, AttemptRuntime>;
  readonly runAttachmentNames: Set<string>;
  state: RecordDraftLifecycleState;
  inFlightMutations: number;
  drained: Deferred.Deferred<void> | undefined;
  handle: RecordRunDraft | undefined;
}

const sessionStates = new WeakMap<object, SessionRuntime>();
const draftStates = new WeakMap<object, DraftRuntime>();
const attemptStates = new WeakMap<object, AttemptRuntime>();
const consumedWrites = new WeakMap<object, DraftRuntime>();

function coreInvalidFromIssues(
  issues: readonly ReturnType<typeof recordIssue>[],
): RecordCoreInvalid {
  const nonEmpty = nonEmptyRecordIssues(issues);
  if (nonEmpty === undefined) {
    throw new Error("RecordCoreInvalid requires at least one issue");
  }
  return new RecordCoreInvalid({ code: "record-core-invalid", issues: nonEmpty });
}

function coreInvalidFromCodec(error: RecordCodecError): RecordCoreInvalid {
  return new RecordCoreInvalid({
    code: "record-core-invalid",
    issues: error.issues,
  });
}

function jsonBytes(value: unknown): Uint8Array {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Record durable JSON encoder received a non-JSON value");
  }
  return new TextEncoder().encode(encoded);
}

function bytesFromCodec<Value>(
  encoded: Either.Either<Value, RecordCodecError>,
): Effect.Effect<Uint8Array, RecordCoreInvalid> {
  return Either.isLeft(encoded)
    ? Effect.fail(coreInvalidFromCodec(encoded.left))
    : Effect.succeed(jsonBytes(encoded.right));
}

function assertSessionLive(
  session: SessionRuntime,
): Effect.Effect<void, ReturnType<typeof recordWriterClosed>> {
  return Effect.suspend(() =>
    session.closed ? Effect.fail(recordWriterClosed()) : Effect.void,
  );
}

function assertSessionIdentity(
  session: unknown,
  runtime: SessionRuntime,
): Effect.Effect<
  void,
  ReturnType<typeof recordWriterClosed> | ReturnType<typeof recordWriteSessionInvalid>
> {
  return Effect.flatMap(assertSessionLive(runtime), () =>
    typeof session !== "object" ||
      session === null ||
      sessionStates.get(session) !== runtime
      ? Effect.fail(recordWriteSessionInvalid())
      : Effect.void,
  );
}

function assertDraftIdentity(
  draft: DraftRuntime,
  handle: unknown,
): Effect.Effect<
  void,
  ReturnType<typeof recordWriterClosed> | ReturnType<typeof recordDraftHandleInvalid>
> {
  return Effect.flatMap(assertSessionLive(draft.session), () =>
    draft.handle === undefined ||
      typeof handle !== "object" ||
      handle === null ||
      draftStates.get(handle) !== draft
      ? Effect.fail(recordDraftHandleInvalid())
      : Effect.void,
  );
}

function assertAttemptIdentity(
  attempt: AttemptRuntime,
  handle: unknown,
): Effect.Effect<
  void,
  ReturnType<typeof recordWriterClosed> | ReturnType<typeof recordDraftHandleInvalid>
> {
  return Effect.flatMap(assertSessionLive(attempt.draft.session), () =>
    attempt.handle === undefined ||
      typeof handle !== "object" ||
      handle === null ||
      attemptStates.get(handle) !== attempt
      ? Effect.fail(recordDraftHandleInvalid())
      : Effect.void,
  );
}

function stateErrorFor(
  operation: RecordDraftOperation,
  state: RecordDraftLifecycleState,
) {
  return recordDraftStateError({
    code: state === "failed" ? "record-draft-write-failed" : "record-draft-state-invalid",
    operation,
    state,
  });
}

function beginMutation(
  draft: DraftRuntime,
  operation: Exclude<RecordDraftOperation, "publish">,
): Effect.Effect<void, RecordWriteError> {
  return draft.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertSessionLive(draft.session);
      yield* assertDraftIdentity(draft, draft.handle);
      if (draft.state !== "open") {
        return yield* Effect.fail(stateErrorFor(operation, draft.state));
      }
      if (draft.inFlightMutations === 0) {
        draft.drained = yield* Deferred.make<void>();
      }
      draft.inFlightMutations += 1;
    }),
  );
}

function finishMutation(
  draft: DraftRuntime,
  exit: Exit.Exit<unknown, unknown>,
): Effect.Effect<void> {
  return draft.mutex.withPermits(1)(
    Effect.sync(() => {
      if (!Exit.isSuccess(exit) && draft.state !== "published") {
        draft.state = "failed";
      }
      if (draft.inFlightMutations <= 0) {
        throw new Error("Record draft mutation accounting underflow");
      }
      draft.inFlightMutations -= 1;
      if (draft.inFlightMutations !== 0) {
        return undefined;
      }
      const drained = draft.drained;
      draft.drained = undefined;
      return drained;
    }),
  ).pipe(
    Effect.flatMap((drained) =>
      drained === undefined
        ? Effect.void
        : Deferred.succeed(drained, undefined).pipe(Effect.asVoid),
    ),
  );
}

function mutate<A, E, R>(
  draft: DraftRuntime,
  operation: Exclude<RecordDraftOperation, "publish">,
  work: Effect.Effect<A, RecordWriteError | E, R>,
): Effect.Effect<A, RecordWriteError | E, R> {
  return Effect.flatMap(beginMutation(draft, operation), () =>
    work.pipe(Effect.onExit((exit) => finishMutation(draft, exit))),
  );
}

function mintRunId(
  session: SessionRuntime,
): Effect.Effect<RunId, RecordCoreInvalid> {
  return Effect.flatMap(session.entropy.uuid, (raw) => {
    const decoded = Schema.decodeUnknownEither(
      RunIdSchema,
      RecordExactParseOptions,
    )(raw);
    return Either.isLeft(decoded)
      ? Effect.fail(coreInvalidFromIssues([recordIssue("record-schema-invalid", ["runId"])]))
      : Effect.succeed(decoded.right);
  });
}

function mintAttemptId(
  draft: DraftRuntime,
): Effect.Effect<AttemptId, RecordCoreInvalid> {
  return Effect.flatMap(draft.session.entropy.uuid, (raw) => {
    const decoded = Schema.decodeUnknownEither(
      AttemptIdSchema,
      RecordExactParseOptions,
    )(raw);
    return Either.isLeft(decoded)
      ? Effect.fail(
          coreInvalidFromIssues([
            recordIssue("record-schema-invalid", ["attemptId"]),
          ]),
        )
      : Effect.succeed(decoded.right);
  });
}

function createFreshRunDirectory(
  session: SessionRuntime,
  remaining = ENTROPY_RETRY_LIMIT,
): Effect.Effect<RunId, RecordWriteError> {
  return Effect.flatMap(mintRunId(session), (runId) =>
    session.fileSystem.createRunDirectory({ root: session.root, runId }).pipe(
      Effect.as(runId),
      Effect.catchAll((error) =>
        error instanceof RecordPathAlreadyExists && remaining > 0
          ? createFreshRunDirectory(session, remaining - 1)
          : Effect.fail(error),
      ),
    ),
  );
}

function makeRunPath(draft: DraftRuntime, ...segments: readonly string[]): RecordPortablePath {
  return recordPortablePath(draft.session.root, "runs", draft.runId, ...segments);
}

function makeAttemptPath(
  attempt: AttemptRuntime,
  ...segments: readonly string[]
): RecordPortablePath {
  return makeRunPath(
    attempt.draft,
    "attempts",
    attempt.attemptId,
    ...segments,
  );
}

function reserveMember(
  draft: DraftRuntime,
  slotId: SlotId,
  member: MemberRuntime,
  operation: "create-attempt" | "reference",
): Effect.Effect<void, RecordWriteError> {
  return draft.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertSessionLive(draft.session);
      if (draft.state !== "open" && draft.state !== "publishing") {
        return yield* Effect.fail(stateErrorFor(operation, draft.state));
      }
      if (!draft.expectedSlotSet.has(slotId)) {
        return yield* Effect.fail(
          coreInvalidFromIssues([
            recordIssue("record-member-slot-unexpected", ["members", slotId]),
          ]),
        );
      }
      if (draft.members.has(slotId)) {
        return yield* Effect.fail(
          coreInvalidFromIssues([
            recordIssue("record-member-slot-duplicate", ["members", slotId]),
          ]),
        );
      }
      draft.members.set(slotId, member);
    }),
  );
}

function reserveAttempt(
  draft: DraftRuntime,
  attempt: AttemptRuntime,
): Effect.Effect<void, RecordWriteError> {
  return draft.mutex.withPermits(1)(
    Effect.suspend(() => {
      if (draft.attemptsById.has(attempt.attemptId)) {
        return Effect.fail(
          coreInvalidFromIssues([
            recordIssue("record-attempt-duplicate", ["attempts", attempt.attemptId]),
          ]),
        );
      }
      draft.attemptsById.set(attempt.attemptId, attempt);
      return Effect.void;
    }),
  );
}

function reserveAttachment(
  draft: DraftRuntime,
  names: Set<string>,
  name: string,
  write: object,
): Effect.Effect<void, RecordWriteError> {
  return draft.mutex.withPermits(1)(
    Effect.suspend(() => {
      if (draft.state !== "open" && draft.state !== "publishing") {
        return Effect.fail(stateErrorFor("record", draft.state));
      }
      if (consumedWrites.has(write) || names.has(name)) {
        return Effect.fail(stateErrorFor("record", draft.state));
      }
      consumedWrites.set(write, draft);
      names.add(name);
      return Effect.void;
    }),
  );
}

function writeCoreFile(
  fileSystem: RecordFileSystemService,
  file: RecordPortablePath,
  bytes: Uint8Array,
): Effect.Effect<void, RecordFileSystemError> {
  return fileSystem.writeFile({
    file,
    bytes,
    maximumBytes: JSON_MAXIMUM_BYTES,
    mode: "exclusive",
  });
}

function nextBlobKey(
  session: SessionRuntime,
  forbidden: ReadonlySet<string>,
  remaining = ENTROPY_RETRY_LIMIT,
): Effect.Effect<string, RecordCoreInvalid> {
  return Effect.flatMap(session.entropy.uuid, (candidate) => {
    if (isPortableSegment(candidate) && !forbidden.has(candidate)) {
      return Effect.succeed(candidate);
    }
    return remaining > 0
      ? nextBlobKey(session, forbidden, remaining - 1)
      : Effect.fail(
          coreInvalidFromIssues([
            recordIssue("record-schema-invalid", ["attachments", "blobs"]),
          ]),
        );
  });
}

function allocateBlobKeys<E, R>(input: {
  readonly session: SessionRuntime;
  readonly payload: RecordAttachmentJson;
  readonly blobs: readonly { readonly ref: RecordBlobRef; readonly stream: unknown }[];
}): Effect.Effect<ReadonlyMap<object, string>, RecordCoreInvalid> {
  return Effect.gen(function* () {
    const forbidden = new Set(attachmentPayloadStrings(input.payload));
    const keys = new Map<object, string>();
    for (const blob of input.blobs) {
      const key = yield* nextBlobKey(input.session, forbidden);
      forbidden.add(key);
      keys.set(blob.ref, key);
    }
    return keys;
  });
}

function attachmentEncodeFailure(
  error: RecordAttachmentPayloadInvalid,
): ReturnType<typeof recordAttachmentEncodeError> {
  return recordAttachmentEncodeError(error);
}

function writeAttachment<Owner extends RecordAttachmentOwner, E, R>(input: {
  readonly draft: DraftRuntime;
  readonly names: Set<string>;
  readonly base: RecordPortablePath;
  readonly owner: Owner;
  readonly write: RecordAttachmentWrite<Owner, E, R>;
}): Effect.Effect<void, RecordWriteError | E, R> {
  return mutate(
    input.draft,
    "record",
    Effect.gen(function* () {
      const captured = recordAttachmentWriteContents(input.write);
      if (Either.isLeft(captured)) {
        return yield* Effect.fail(captured.left);
      }
      if (captured.right.definition.owner !== input.owner) {
        return yield* Effect.fail(
          recordAttachmentClosureInvalid([
            recordAttachmentIssue("record-attachment-owner-invalid", ["owner"]),
          ]),
        );
      }

      const encodedPayload = encodeJsonRecordAttachmentPayload(
        captured.right.definition,
        captured.right.payload,
      );
      if (Either.isLeft(encodedPayload)) {
        return yield* Effect.fail(attachmentEncodeFailure(encodedPayload.left));
      }

      yield* reserveAttachment(
        input.draft,
        input.names,
        captured.right.definition.name,
        input.write,
      );
      const blobKeys = yield* allocateBlobKeys({
        session: input.draft.session,
        payload: encodedPayload.right,
        blobs: captured.right.blobs,
      });
      const storedPayload = encodeAttachmentPayloadForStorage({
        payload: encodedPayload.right,
        blobKeys,
      });
      if (Either.isLeft(storedPayload)) {
        return yield* Effect.fail(attachmentEncodeFailure(storedPayload.left));
      }
      const payloadBytes = encodeRecordAttachmentJsonBytes(storedPayload.right);
      const attachment: RecordAttachmentEnvelopeV1 = {
        name: captured.right.definition.name,
        schemaId: captured.right.definition.schemaId,
      };
      const attachmentBytes = yield* bytesFromCodec(
        encodeRecordAttachmentEnvelopeV1(attachment),
      );
      const attachmentRoot = recordPortablePath(
        input.base.root,
        ...input.base.segments,
        attachment.name,
      );
      yield* input.draft.session.fileSystem.ensureDirectory(input.base);
      yield* input.draft.session.fileSystem.createDirectory(attachmentRoot);
      yield* writeCoreFile(
        input.draft.session.fileSystem,
        recordPortablePath(input.base.root, ...attachmentRoot.segments, "attachment.json"),
        attachmentBytes,
      );
      yield* writeCoreFile(
        input.draft.session.fileSystem,
        recordPortablePath(input.base.root, ...attachmentRoot.segments, "payload.json"),
        payloadBytes,
      );
      yield* Effect.forEach(
        captured.right.blobs,
        (blob) => {
          const key = blobKeys.get(blob.ref);
          if (key === undefined) {
            throw new Error("Record Attachment closure lost a writer-assigned blob key");
          }
          return input.draft.session.fileSystem.writeFileStream({
            file: recordPortablePath(
              input.base.root,
              ...attachmentRoot.segments,
              "blobs",
              key,
            ),
            stream: blob.stream,
            maximumBytes: BLOB_MAXIMUM_BYTES,
            mode: "exclusive",
          });
        },
        { discard: true },
      );
    }),
  );
}

function verifyReference(
  session: SessionRuntime,
  attempt: FrozenRecordAttempt,
): Effect.Effect<void, RecordWriteError> {
  const ref: RecordAttemptRef = {
    originRunId: attempt.originRunId,
    attemptId: attempt.attemptId,
  };
  return session.view.attempt(ref).pipe(
    Effect.flatMap((result) =>
      result.state === "available" && result.value === attempt
        ? Effect.void
        : Effect.fail(
            new RecordReferenceInvalid({ code: "record-reference-invalid" }),
          ),
    ),
    Effect.catchAll(
      (error): Effect.Effect<never, RecordWriteError> => {
      if (error instanceof RecordReaderClosed) {
        return Effect.fail(recordWriterClosed());
      }
      if (error instanceof RecordHandleInvalid) {
        return Effect.fail(
          new RecordReferenceInvalid({ code: "record-reference-invalid" }),
        );
      }
      return Effect.fail(error);
      },
    ),
    Effect.asVoid,
  );
}

function makeAttemptHandle(attempt: AttemptRuntime): RecordAttemptDraft {
  const handle: RecordAttemptDraft = {
    attemptId: attempt.attemptId,
    [recordAttemptDraftBrand]: () => undefined,
    record<E, R>(
      this: RecordAttemptDraft,
      write: RecordAttachmentWrite<"attempt", E, R>,
    ) {
      return Effect.flatMap(assertAttemptIdentity(attempt, this), () =>
        writeAttachment({
          draft: attempt.draft,
          names: attempt.attachmentNames,
          base: makeAttemptPath(attempt, "attachments"),
          owner: "attempt",
          write,
        }),
      );
    },
  };
  const frozen = Object.freeze(handle);
  attempt.handle = frozen;
  attemptStates.set(frozen, attempt);
  return frozen;
}

function createAttempt(
  draft: DraftRuntime,
  input: { readonly slotId: SlotId },
): Effect.Effect<RecordAttemptDraft, RecordWriteError> {
  return mutate(
    draft,
    "create-attempt",
    Effect.gen(function* () {
      let attemptId = yield* mintAttemptId(draft);
      for (
        let retries = ENTROPY_RETRY_LIMIT;
        draft.attemptsById.has(attemptId) && retries > 0;
        retries -= 1
      ) {
        attemptId = yield* mintAttemptId(draft);
      }
      if (draft.attemptsById.has(attemptId)) {
        return yield* Effect.fail(
          coreInvalidFromIssues([
            recordIssue("record-attempt-duplicate", ["attempts", attemptId]),
          ]),
        );
      }
      const attempt: AttemptRuntime = {
        draft,
        attemptId,
        slotId: input.slotId,
        attachmentNames: new Set<string>(),
        handle: undefined,
      };
      const document: AttemptDocumentV1 = {
        attemptId,
        originRunId: draft.runId,
      };
      const member: MemberDocumentV1 = {
        slotId: input.slotId,
        attempt: { originRunId: draft.runId, attemptId },
      };
      yield* reserveMember(draft, input.slotId, {
        document: member,
        reference: undefined,
      }, "create-attempt");
      yield* reserveAttempt(draft, attempt);
      const attemptBytes = yield* bytesFromCodec(encodeAttemptDocumentV1(document));
      const memberBytes = yield* bytesFromCodec(encodeMemberDocumentV1(member));
      yield* writeCoreFile(
        draft.session.fileSystem,
        makeAttemptPath(attempt, "attempt.json"),
        attemptBytes,
      );
      yield* writeCoreFile(
        draft.session.fileSystem,
        makeRunPath(draft, "members", `${input.slotId}.json`),
        memberBytes,
      );
      return makeAttemptHandle(attempt);
    }),
  );
}

function referenceAttempt(
  draft: DraftRuntime,
  input: { readonly slotId: SlotId; readonly attempt: FrozenRecordAttempt },
): Effect.Effect<void, RecordWriteError> {
  return mutate(
    draft,
    "reference",
    Effect.gen(function* () {
      yield* verifyReference(draft.session, input.attempt);
      const member: MemberDocumentV1 = {
        slotId: input.slotId,
        attempt: {
          originRunId: input.attempt.originRunId,
          attemptId: input.attempt.attemptId,
        },
      };
      yield* reserveMember(draft, input.slotId, {
        document: member,
        reference: input.attempt,
      }, "reference");
      const bytes = yield* bytesFromCodec(encodeMemberDocumentV1(member));
      yield* writeCoreFile(
        draft.session.fileSystem,
        makeRunPath(draft, "members", `${input.slotId}.json`),
        bytes,
      );
    }),
  );
}

function makeRunHandle(draft: DraftRuntime): RecordRunDraft {
  const handle: RecordRunDraft = {
    runId: draft.runId,
    [recordRunDraftBrand]: () => undefined,
    record<E, R>(
      this: RecordRunDraft,
      write: RecordAttachmentWrite<"run", E, R>,
    ) {
      return Effect.flatMap(assertDraftIdentity(draft, this), () =>
        writeAttachment({
          draft,
          names: draft.runAttachmentNames,
          base: makeRunPath(draft, "attachments"),
          owner: "run",
          write,
        }),
      );
    },
    createAttempt(this: RecordRunDraft, input) {
      return Effect.flatMap(assertDraftIdentity(draft, this), () =>
        createAttempt(draft, input),
      );
    },
    reference(this: RecordRunDraft, input) {
      return Effect.flatMap(assertDraftIdentity(draft, this), () =>
        referenceAttempt(draft, input),
      );
    },
    publish(this: RecordRunDraft, input) {
      return Effect.flatMap(assertDraftIdentity(draft, this), () =>
        publishDraft(draft, input),
      );
    },
  };
  const frozen = Object.freeze(handle);
  draft.handle = frozen;
  draftStates.set(frozen, draft);
  return frozen;
}

function startPublish(
  draft: DraftRuntime,
): Effect.Effect<Deferred.Deferred<void> | undefined, RecordWriteError> {
  return draft.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertSessionLive(draft.session);
      if (draft.state !== "open") {
        return yield* Effect.fail(stateErrorFor("publish", draft.state));
      }
      draft.state = "publishing";
      return draft.drained;
    }),
  );
}

function publishFailed(
  draft: DraftRuntime,
  exit: Exit.Exit<unknown, unknown>,
): Effect.Effect<void> {
  return Exit.isSuccess(exit)
    ? Effect.void
    : draft.mutex.withPermits(1)(
        Effect.sync(() => {
          if (draft.state === "publishing") {
            draft.state = "failed";
          }
        }),
      );
}

function ensureReadyToPublish(
  draft: DraftRuntime,
): Effect.Effect<void, RecordWriteError> {
  return draft.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertSessionLive(draft.session);
      if (draft.state !== "publishing") {
        return yield* Effect.fail(stateErrorFor("publish", draft.state));
      }
      if (draft.inFlightMutations !== 0) {
        throw new Error("Record draft published before in-flight writes drained");
      }
    }),
  );
}

function draftReceipt(draft: DraftRuntime): RecordPublishReceipt {
  const attempts: RecordPublishReceipt["attempts"][number][] = [];
  for (const slotId of draft.expectedSlots) {
    const member = draft.members.get(slotId);
    if (member === undefined) {
      continue;
    }
    attempts.push(
      Object.freeze({
        slotId,
        ref: Object.freeze({ ...member.document.attempt }),
      }),
    );
  }
  return Object.freeze({
    runId: draft.runId,
    attempts: Object.freeze(attempts),
  });
}

function validateReferencesAtPublish(
  draft: DraftRuntime,
): Effect.Effect<void, RecordWriteError> {
  return Effect.forEach(
    [...draft.members.values()],
    (member) =>
      member.reference === undefined
        ? Effect.void
        : verifyReference(draft.session, member.reference),
    { discard: true },
  );
}

function finishOrdinaryWrites(
  draft: DraftRuntime,
  completedAt: UtcMillis,
): Effect.Effect<RecordPublishReceipt, RecordWriteError> {
  return Effect.gen(function* () {
    yield* validateReferencesAtPublish(draft);
    const run: RunDocumentV1 = {
      runId: draft.runId,
      startedAt: draft.startedAt,
      completedAt,
      expectedSlots: draft.expectedSlots,
    };
    const runBytes = yield* bytesFromCodec(encodeRunDocumentV1(run));
    yield* writeCoreFile(
      draft.session.fileSystem,
      makeRunPath(draft, "run.json"),
      runBytes,
    );
    return draftReceipt(draft);
  });
}

function publishDraft(
  draft: DraftRuntime,
  input: { readonly completedAt: UtcMillis },
): Effect.Effect<RecordPublishReceipt, RecordWriteError> {
  return Effect.flatMap(startPublish(draft), (drained) =>
    Effect.gen(function* () {
      if (drained !== undefined) {
        yield* Deferred.await(drained);
      }
      yield* ensureReadyToPublish(draft);
      const receipt = yield* finishOrdinaryWrites(draft, input.completedAt);
      yield* Effect.uninterruptibleMask(() =>
        Effect.gen(function* () {
          yield* draft.session.fileSystem.syncDirectory(makeRunPath(draft));
          yield* draft.session.fileSystem.createCompleteMarker({
            root: draft.session.root,
            runId: draft.runId,
          });
          yield* Effect.sync(() => {
            draft.state = "published";
          });
        }),
      );
      return receipt;
    }).pipe(Effect.onExit((exit) => publishFailed(draft, exit))),
  );
}

function createRun(
  session: SessionRuntime,
  input: { readonly startedAt: UtcMillis; readonly expectedSlots: readonly SlotId[] },
): Effect.Effect<RecordRunDraft, RecordWriteError> {
  const issues = validateExpectedSlots(input.expectedSlots);
  if (issues.length > 0) {
    return Effect.fail(coreInvalidFromIssues(issues));
  }
  return Effect.gen(function* () {
    yield* assertSessionLive(session);
    const runId = yield* createFreshRunDirectory(session);
    const mutex = yield* Effect.makeSemaphore(1);
    const draft: DraftRuntime = {
      session,
      runId,
      startedAt: input.startedAt,
      expectedSlots: Object.freeze([...input.expectedSlots]),
      expectedSlotSet: new Set(input.expectedSlots),
      mutex,
      members: new Map(),
      attemptsById: new Map(),
      runAttachmentNames: new Set(),
      state: "open",
      inFlightMutations: 0,
      drained: undefined,
      handle: undefined,
    };
    session.drafts.add(draft);
    return makeRunHandle(draft);
  });
}

/**
 * @internal Shared by the public opener once reader construction has frozen a
 * view. The session is exact-identity branded and its Scope finalizer only
 * invalidates capabilities; it never deletes an incomplete Run directory.
 */
function makeRecordWriteSession(input: {
  readonly root: RecordRoot;
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly fileSystem: RecordFileSystemService;
  readonly entropy: RecordEntropyService;
}): Effect.Effect<RecordWriteSession, never, import("effect").Scope.Scope> {
  return Effect.gen(function* () {
    const runtime: SessionRuntime = {
      root: input.root,
      view: input.view,
      fileSystem: input.fileSystem,
      entropy: input.entropy,
      drafts: new Set(),
      closed: false,
    };
    const session: RecordWriteSession = {
      [recordWriteSessionBrand]: () => undefined,
      view: input.view,
      createRun(this: RecordWriteSession, runInput) {
        return Effect.flatMap(assertSessionIdentity(this, runtime), () =>
          createRun(runtime, runInput),
        );
      },
    };
    const frozen = Object.freeze(session);
    sessionStates.set(frozen, runtime);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        runtime.closed = true;
        for (const draft of runtime.drafts) {
          if (draft.state === "open" || draft.state === "publishing") {
            draft.state = "failed";
          }
        }
      }),
    );
    return frozen;
  });
}

/**
 * Open a scoped writer before any producer work. The outer shared lock fixes
 * maintenance-before-writer ordering; `openRecordReader` retains its own
 * scoped shared lock while constructing the authoritative frozen view.
 */
export const openRecordWriteSession: OpenRecordWriteSession = (input) =>
  Effect.gen(function* () {
    const maintenance = yield* RecordMaintenanceLock;
    yield* maintenance.acquireShared(input.root);
    const writerLock = yield* RecordWriterLock;
    yield* writerLock.acquire(input.root);
    const view = yield* openRecordReader({ root: input.root });
    const fileSystem = yield* RecordFileSystem;
    const entropy = yield* RecordEntropy;
    return yield* makeRecordWriteSession({
      root: input.root,
      view,
      fileSystem,
      entropy,
    });
  });
