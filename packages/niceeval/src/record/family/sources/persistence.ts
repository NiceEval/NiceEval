import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { sourcesRecordAttachment } from "./definition.ts";

export const sourcesRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: sourcesRecordAttachment,
  revision: 2,
});
