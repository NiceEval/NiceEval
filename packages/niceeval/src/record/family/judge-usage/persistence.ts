import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { judgeUsageRecordAttachment } from "./definition.ts";

export const judgeUsageRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: judgeUsageRecordAttachment,
});
