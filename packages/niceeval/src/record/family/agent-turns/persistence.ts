import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { agentTurnsRecordAttachment } from "./definition.ts";

export const agentTurnsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: agentTurnsRecordAttachment,
  revision: 4,
});
