import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { assertionsRecordAttachment } from "./definition.ts";

/** Current durable interpretation for Assertions. */
export const assertionsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: assertionsRecordAttachment,
  revision: 4,
});
