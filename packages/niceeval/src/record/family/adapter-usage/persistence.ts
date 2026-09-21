import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { adapterUsageRecordAttachment } from "./definition.ts";

export const adapterUsageRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: adapterUsageRecordAttachment,
  revision: 1,
});
