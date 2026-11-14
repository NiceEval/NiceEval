import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { attemptNotesRecordAttachment } from "./definition.ts";

export const attemptNotesRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: attemptNotesRecordAttachment,
});
