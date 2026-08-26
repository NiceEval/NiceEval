import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { sourcesRecordAttachment } from "./definition.ts";
import { sourcesV1ToV2 } from "./migrate/1-to-2.ts";

export const sourcesRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: sourcesRecordAttachment,
  revision: 2,
  migrations: [sourcesV1ToV2],
});
