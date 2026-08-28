import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { turnContextsRecordAttachment } from "./definition.ts";

export const turnContextsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: turnContextsRecordAttachment,
  revision: 2,
});
