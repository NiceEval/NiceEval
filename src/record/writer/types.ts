import type { Effect, Scope } from "effect";
import type { RecordAttachmentWrite } from "../attachment/types.ts";
import type { RecordAttemptRef } from "../model/core.ts";
import type { AttemptId, RunId, SlotId, UtcMillis } from "../model/identifiers.ts";
import type { RecordCoreInvalid, RecordReferenceInvalid } from "../errors/record-errors.ts";
import type { RecordAttachmentClosureInvalid } from "../attachment/errors.ts";
import type { RecordFileSystemError, RecordWriterLockError } from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import type {
  RecordEntropy,
  RecordFileSystem,
  RecordMaintenanceLock,
  RecordWriterLock,
} from "../platform/services.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordView,
} from "../reader/types.ts";
import type {
  RecordReaderOpenError,
  RecordReaderReadError,
} from "../reader/errors.ts";
import type {
  RecordAttachmentEncodeError,
  RecordDraftAttemptDiscardInvalid,
  RecordDraftHandleInvalid,
  RecordDraftStateError,
  RecordWriteSessionInvalid,
  RecordWriterClosed,
} from "./errors.ts";

export const recordWriteSessionBrand: unique symbol = Symbol(
  "@niceeval/record/RecordWriteSession",
);
export const recordRunDraftBrand: unique symbol = Symbol(
  "@niceeval/record/RecordRunDraft",
);
export const recordAttemptDraftBrand: unique symbol = Symbol(
  "@niceeval/record/RecordAttemptDraft",
);

export type RecordWriteError =
  | RecordFileSystemError
  | RecordWriterClosed
  | RecordWriteSessionInvalid
  | RecordDraftStateError
  | RecordDraftAttemptDiscardInvalid
  | RecordDraftHandleInvalid
  | RecordReferenceInvalid
  | RecordCoreInvalid
  | RecordAttachmentEncodeError
  | RecordAttachmentClosureInvalid;

export interface RecordPublishReceipt {
  readonly runId: RunId;
  readonly attempts: readonly {
    readonly slotId: SlotId;
    readonly ref: RecordAttemptRef;
  }[];
}

export interface RecordWriteSession {
  readonly [recordWriteSessionBrand]: () => void;
  readonly view: FrozenRecordView<RecordReaderReadError>;

  readonly createRun: (input: {
    readonly startedAt: UtcMillis;
    readonly expectedSlots: readonly SlotId[];
  }) => Effect.Effect<RecordRunDraft, RecordWriteError>;
}

export interface RecordRunDraft {
  readonly runId: RunId;
  readonly [recordRunDraftBrand]: () => void;

  readonly record: <E, R>(
    write: RecordAttachmentWrite<"run", E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;

  readonly createAttempt: (input: {
    readonly slotId: SlotId;
  }) => Effect.Effect<RecordAttemptDraft, RecordWriteError>;

  readonly reference: (input: {
    readonly slotId: SlotId;
    readonly attempt: FrozenRecordAttempt;
  }) => Effect.Effect<void, RecordWriteError>;

  readonly publish: (input: {
    readonly completedAt: UtcMillis;
  }) => Effect.Effect<RecordPublishReceipt, RecordWriteError>;
}

export interface RecordAttemptDraft {
  readonly attemptId: AttemptId;
  readonly [recordAttemptDraftBrand]: () => void;

  readonly record: <E, R>(
    write: RecordAttachmentWrite<"attempt", E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
}

export type OpenRecordWriteSessionRequirements =
  | Scope.Scope
  | RecordFileSystem
  | RecordMaintenanceLock
  | RecordWriterLock
  | RecordEntropy;

export type OpenRecordWriteSessionError =
  | RecordReaderOpenError
  | RecordWriterLockError
  | RecordWriteError;

export type OpenRecordWriteSession = (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  RecordWriteSession,
  OpenRecordWriteSessionError,
  OpenRecordWriteSessionRequirements
>;
