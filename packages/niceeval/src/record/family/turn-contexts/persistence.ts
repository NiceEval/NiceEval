import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { turnContextsRecordAttachment } from "./definition.ts";
import { turnContextsV1ToV2 } from "./migration/1-to-2.ts";

export const turnContextsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: turnContextsRecordAttachment,
  revision: 2,
  migrations: [turnContextsV1ToV2],
});
