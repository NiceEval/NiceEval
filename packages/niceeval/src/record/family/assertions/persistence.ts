import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { assertionsRecordAttachment } from "./definition.ts";

/** Current durable interpretation for Assertions. */
export const assertionsRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: assertionsRecordAttachment,
});
