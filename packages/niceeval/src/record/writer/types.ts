import type { RecordCoreInvalid, RecordReferenceInvalid } from "../errors/record-errors.ts";
import type { RecordAttachmentClosureInvalid } from "../attachment/errors.ts";
import type { FamilyDefinitionRequired } from "../reader/errors.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import type {
  RecordAttachmentEncodeError,
  RecordAttachmentCallbackFailed,
  RecordDraftStateError,
  RecordWriterClosed,
  RecordOwnerDefinitionMismatch,
} from "./errors.ts";

export type RecordWriteError =
  | RecordFileSystemError
  | RecordWriterClosed
  | RecordDraftStateError
  | RecordReferenceInvalid
  | RecordCoreInvalid
  | RecordAttachmentEncodeError
  | RecordAttachmentCallbackFailed
  | RecordAttachmentClosureInvalid
  | FamilyDefinitionRequired
  | RecordOwnerDefinitionMismatch;
