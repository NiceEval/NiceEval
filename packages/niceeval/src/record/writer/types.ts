import type { Effect } from "effect";
import type { RecordAttachmentWrite } from "../attachment/types.ts";
import type { RecordAttemptRef, RecordSlotIdentity } from "../model/core.ts";
import type { RunContext } from "../model/run-context.ts";
import type {
  AttemptId,
  ExperimentId,
  RunId,
  SlotId,
  UtcMillis,
} from "../model/identifiers.ts";
import type { RecordCoreInvalid, RecordReferenceInvalid } from "../errors/record-errors.ts";
import type { RecordAttachmentClosureInvalid } from "../attachment/errors.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import type {
  FrozenRecordAttempt,
} from "../reader/types.ts";
import type {
  RecordAttachmentEncodeError,
  RecordDraftHandleInvalid,
  RecordDraftStateError,
  RecordWriteSessionInvalid,
  RecordWriterClosed,
  RecordRunAlreadyCreated,
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
  | RecordRunAlreadyCreated
  | RecordWriteSessionInvalid
  | RecordDraftStateError
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

  readonly createRun: (input: {
    readonly experimentId: ExperimentId;
    readonly context: RunContext;
    readonly startedAt: UtcMillis;
    readonly expectedSlots: readonly RecordSlotIdentity[];
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
    readonly action: "carried" | "accepted";
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
