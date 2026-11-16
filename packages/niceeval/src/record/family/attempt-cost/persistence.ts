import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { attemptCostRecordAttachment } from "./definition.ts";

export const attemptCostRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: attemptCostRecordAttachment,
});
