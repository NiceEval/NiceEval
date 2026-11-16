import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { turnContextsRecordAttachment } from "./definition.ts";

export const turnContextsRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: turnContextsRecordAttachment,
});
