import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { sandboxCommandsRecordAttachment } from "./definition.ts";

export const sandboxCommandsRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: sandboxCommandsRecordAttachment,
});
