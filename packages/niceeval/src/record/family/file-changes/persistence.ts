import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { fileChangesRecordAttachment } from "./definition.ts";

export const fileChangesRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: fileChangesRecordAttachment,
  revision: 2,
});
