import type { Effect, Stream } from "effect";
import type {
  RecordAttachmentFamily,
  RecordAttachmentValue,
} from "../attachment/types.ts";
import type {
  MemberDocumentV1,
  RecordAttemptRef,
} from "../model/core.ts";
import type { RunId, SlotId } from "../model/identifiers.ts";
import type {
  RecordAttachmentRead,
  RecordCoreRead,
} from "../model/read-state.ts";
import type { RecordReaderReadError } from "./errors.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordRun,
  RecordReader,
} from "./types.ts";

/**
 * Package-private bridge for domains that interpret generic Record facts.
 * The owning reader registers one frozen port; callers must still pass that
 * exact reader to every operation so runtime identity and Scope checks remain
 * inside Record.
 */
export interface FrozenRecordReaderPort {
  readonly assertOpen: (
    reader: object,
  ) => Effect.Effect<void, RecordReaderReadError>;
  readonly candidates: (
    reader: object,
  ) => Stream.Stream<RecordCoreRead<FrozenRecordRun>, RecordReaderReadError>;
  readonly run: (
    reader: object,
    runId: RunId,
  ) => Effect.Effect<RecordCoreRead<FrozenRecordRun>, RecordReaderReadError>;
  readonly member: (
    reader: object,
    run: FrozenRecordRun,
    slotId: SlotId,
  ) => Effect.Effect<RecordCoreRead<MemberDocumentV1>, RecordReaderReadError>;
  readonly attempt: (
    reader: object,
    ref: RecordAttemptRef,
  ) => Effect.Effect<RecordCoreRead<FrozenRecordAttempt>, RecordReaderReadError>;
  readonly readRunAttachment: <Payload>(
    reader: object,
    owner: FrozenRecordRun,
    family: RecordAttachmentFamily<"run", Payload>,
  ) => Effect.Effect<
    RecordAttachmentRead<RecordAttachmentValue<Payload>>,
    RecordReaderReadError
  >;
  readonly readAttemptAttachment: <Payload>(
    reader: object,
    owner: FrozenRecordAttempt,
    family: RecordAttachmentFamily<"attempt", Payload>,
  ) => Effect.Effect<
    RecordAttachmentRead<RecordAttachmentValue<Payload>>,
    RecordReaderReadError
  >;
}

const ports = new WeakMap<object, FrozenRecordReaderPort>();

/** @internal Called only while constructing an authentic scoped reader. */
export function registerFrozenRecordReaderPort(
  reader: RecordReader<RecordReaderReadError>,
  port: FrozenRecordReaderPort,
): void {
  if (ports.has(reader)) {
    throw new Error("Record reader already has a frozen capability port");
  }
  ports.set(reader, Object.freeze({ ...port }));
}

/** @internal A copied or forged reader has no entry in this exact-identity registry. */
export function resolveFrozenRecordReaderPort(
  reader: object,
): FrozenRecordReaderPort | undefined {
  return ports.get(reader);
}
