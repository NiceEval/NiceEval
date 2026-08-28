import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { sandboxCommandsRecordAttachment } from "./definition.ts";

export const sandboxCommandsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: sandboxCommandsRecordAttachment,
  revision: 2,
});
