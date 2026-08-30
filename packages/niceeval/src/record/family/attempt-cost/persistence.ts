import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { attemptCostRecordAttachment } from "./definition.ts";

export const attemptCostRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: attemptCostRecordAttachment,
  revision: 1,
});
