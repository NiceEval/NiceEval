import type { RecordCoreInvalid, RecordReferenceInvalid } from "../errors/record-errors.ts";
import type { RecordCoordinationError } from "../../coordination/record-leases.ts";
import type { RecordAttachmentClosureInvalid } from "../attachment/errors.ts";
import type { FamilyDefinitionRequired } from "../reader/errors.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import type { SqliteRecordError } from "../sqlite/errors.ts";
import type {
  RecordAttachmentEncodeError,
  RecordAttachmentCallbackFailed,
  RecordDraftStateError,
  RecordWriterClosed,
  RecordOwnerDefinitionMismatch,
  RecordAlreadyWritten,
  RecordAppendCommandInvalid,
  RecordCollectionNotClosed,
  RecordCollectionDefinitionInvalid,
} from "./errors.ts";

export type RecordWriteError =
  | RecordFileSystemError
  | RecordCoordinationError
  | SqliteRecordError
  | RecordWriterClosed
  | RecordDraftStateError
  | RecordReferenceInvalid
  | RecordCoreInvalid
  | RecordAttachmentEncodeError
  | RecordAttachmentCallbackFailed
  | RecordAttachmentClosureInvalid
  | FamilyDefinitionRequired
  | RecordOwnerDefinitionMismatch
  | RecordAlreadyWritten
  | RecordCollectionDefinitionInvalid
  | RecordAppendCommandInvalid
  | RecordCollectionNotClosed;
