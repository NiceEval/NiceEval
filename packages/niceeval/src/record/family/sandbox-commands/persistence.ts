import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { sandboxCommandsRecordAttachment } from "./definition.ts";
import { sandboxCommandsV1ToV2 } from "./migrate/1-to-2.ts";

export const sandboxCommandsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: sandboxCommandsRecordAttachment,
  revision: 2,
  migrations: [sandboxCommandsV1ToV2],
});
