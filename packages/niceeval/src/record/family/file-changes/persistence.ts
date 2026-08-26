import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { fileChangesRecordAttachment } from "./definition.ts";
import { fileChangesV1ToV2 } from "./migrate/1-to-2.ts";

export const fileChangesRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: fileChangesRecordAttachment,
  revision: 2,
  migrations: [fileChangesV1ToV2],
});
