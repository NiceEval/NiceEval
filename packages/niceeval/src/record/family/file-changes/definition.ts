import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  FileChangesAttachmentSchema,
  validateFileChangesAttachment,
} from "./schema.ts";

/** Current File Changes fact only; durable history is separate. */
export const fileChangesRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.file-changes",
  schema: FileChangesAttachmentSchema,
  validate: validateFileChangesAttachment,
});
