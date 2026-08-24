import type {
  NonEmptyRecordAttachmentIssues,
  RecordAttachmentPayloadInvalid,
} from "../attachment/errors.ts";

/** A scoped write session or a draft escaped after its owning Scope closed. */
export interface RecordWriterClosed {
  readonly code: "record-writer-closed";
}

/** A copied or otherwise non-issued write-session capability was invoked. */
export interface RecordWriteSessionInvalid {
  readonly code: "record-write-session-invalid";
}

/** One scoped Run session can reserve exactly one new Run directory. */
export interface RecordRunAlreadyCreated {
  readonly code: "record-run-already-created";
}

/** A copied or otherwise non-issued draft capability was supplied internally. */
export interface RecordDraftHandleInvalid {
  readonly code: "record-draft-handle-invalid";
}

export type RecordDraftOperation =
  | "record"
  | "create-attempt"
  | "reference"
  | "publish";

export type RecordDraftLifecycleState =
  | "open"
  | "publishing"
  | "published"
  | "failed";

/** A draft was consumed, is publishing, or a concurrent write already failed. */
export interface RecordDraftStateError {
  readonly code: "record-draft-state-invalid" | "record-draft-write-failed";
  readonly operation: RecordDraftOperation;
  readonly state: RecordDraftLifecycleState;
}

/** Schema encoding failed before an Attachment could become durable bytes. */
export interface RecordAttachmentEncodeError {
  readonly code: "record-attachment-encode-error";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

/** A synchronous session builder callback threw before any physical write. */
export interface RecordAttachmentCallbackFailed {
  readonly code: "record-attachment-callback-failed";
  readonly cause: unknown;
}

/** A writer was paired with a definition for the other owner kind. */
export interface RecordOwnerDefinitionMismatch {
  readonly code: "record-owner-definition-mismatch";
  readonly expected: "run" | "attempt";
  readonly actual: "run" | "attempt";
}

/** A create-once owner/family already has a reserved write. */
export interface RecordAlreadyWritten {
  readonly code: "record-already-written";
  readonly owner: "run" | "attempt";
  readonly family: string;
}

const writerClosed: RecordWriterClosed = Object.freeze({
  code: "record-writer-closed",
});

const writeSessionInvalid: RecordWriteSessionInvalid = Object.freeze({
  code: "record-write-session-invalid",
});

const draftHandleInvalid: RecordDraftHandleInvalid = Object.freeze({
  code: "record-draft-handle-invalid",
});

const runAlreadyCreated: RecordRunAlreadyCreated = Object.freeze({
  code: "record-run-already-created",
});

export function recordWriterClosed(): RecordWriterClosed {
  return writerClosed;
}

export function recordWriteSessionInvalid(): RecordWriteSessionInvalid {
  return writeSessionInvalid;
}

export function recordDraftHandleInvalid(): RecordDraftHandleInvalid {
  return draftHandleInvalid;
}

export function recordRunAlreadyCreated(): RecordRunAlreadyCreated {
  return runAlreadyCreated;
}

export function recordDraftStateError(input: {
  readonly code: RecordDraftStateError["code"];
  readonly operation: RecordDraftOperation;
  readonly state: RecordDraftLifecycleState;
}): RecordDraftStateError {
  return Object.freeze({ ...input });
}

export function recordAttachmentEncodeError(
  source: RecordAttachmentPayloadInvalid,
): RecordAttachmentEncodeError {
  return Object.freeze({
    code: "record-attachment-encode-error",
    issues: source.issues,
  });
}

export function recordOwnerDefinitionMismatch(input: {
  readonly expected: "run" | "attempt";
  readonly actual: "run" | "attempt";
}): RecordOwnerDefinitionMismatch {
  return Object.freeze({ code: "record-owner-definition-mismatch", ...input });
}

export function recordAlreadyWritten(input: {
  readonly owner: "run" | "attempt";
  readonly family: string;
}): RecordAlreadyWritten {
  return Object.freeze({ code: "record-already-written", ...input });
}
