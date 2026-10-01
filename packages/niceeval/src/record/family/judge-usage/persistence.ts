import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { judgeUsageRecordAttachment } from "./definition.ts";

export const judgeUsageRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: judgeUsageRecordAttachment,
  revision: 1,
});
