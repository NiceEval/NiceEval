import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { adapterUsageRecordAttachment } from "./definition.ts";

export const adapterUsageRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: adapterUsageRecordAttachment,
});
