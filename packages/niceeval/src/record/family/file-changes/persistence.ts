import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { fileChangesRecordAttachment } from "./definition.ts";

export const fileChangesRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: fileChangesRecordAttachment,
});
