import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { sourcesRecordAttachment } from "./definition.ts";

export const sourcesRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: sourcesRecordAttachment,
});
