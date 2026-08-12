import type { Effect, Stream } from "effect";
import type {
  RecordAttachmentFamily,
  RecordAttachmentValue,
} from "../attachment/types.ts";
import type { RecordAttemptRef } from "../model/core.ts";
import type { AttemptId, RunId, SlotId, UtcMillis } from "../model/identifiers.ts";
import type {
  RecordAttachmentRead,
  RecordCoreRead,
  RecordWarning,
} from "../model/read-state.ts";

/**
 * These symbols express the nominal public type boundary. Runtime authority is
 * deliberately separate in `identity.ts`: a copied symbol-shaped object still
 * cannot resolve through the reader's private WeakMap.
 */
export const frozenRecordViewBrand: unique symbol = Symbol(
  "@niceeval/record/FrozenRecordView",
);
export const frozenRecordRunBrand: unique symbol = Symbol(
  "@niceeval/record/FrozenRecordRun",
);
export const frozenRecordAttemptBrand: unique symbol = Symbol(
  "@niceeval/record/FrozenRecordAttempt",
);

export interface FrozenRecordRun {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
  readonly [frozenRecordRunBrand]: () => void;
}

export interface FrozenRecordAttempt {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
  readonly [frozenRecordAttemptBrand]: () => void;
}

/**
 * A snapshot deliberately exposes candidate Core through a Stream. A reader
 * can retain bounded directory/index metadata instead of manufacturing a
 * million frozen owner objects merely to enumerate them.
 */
export interface FrozenRecordView<ReadError> {
  readonly [frozenRecordViewBrand]: () => void;
  readonly warnings: readonly RecordWarning[];
  readonly runs: Stream.Stream<RecordCoreRead<FrozenRecordRun>, ReadError>;

  readonly run: (
    runId: RunId,
  ) => Effect.Effect<RecordCoreRead<FrozenRecordRun>, ReadError>;

  readonly attempt: (
    ref: RecordAttemptRef,
  ) => Effect.Effect<RecordCoreRead<FrozenRecordAttempt>, ReadError>;

  readonly readRunAttachment: <Payload>(
    owner: FrozenRecordRun,
    family: RecordAttachmentFamily<"run", Payload>,
  ) => Effect.Effect<RecordAttachmentRead<RecordAttachmentValue<Payload>>, ReadError>;

  readonly readAttemptAttachment: <Payload>(
    owner: FrozenRecordAttempt,
    family: RecordAttachmentFamily<"attempt", Payload>,
  ) => Effect.Effect<RecordAttachmentRead<RecordAttachmentValue<Payload>>, ReadError>;
}

/** A reader is the scoped, root-open form of the same frozen-view capability. */
export interface RecordReader<ReadError> extends FrozenRecordView<ReadError> {}

/** Used only by the runtime when pairing a frozen owner with its durable kind. */
export type FrozenRecordOwner =
  | { readonly owner: "run"; readonly value: FrozenRecordRun }
  | { readonly owner: "attempt"; readonly value: FrozenRecordAttempt };
