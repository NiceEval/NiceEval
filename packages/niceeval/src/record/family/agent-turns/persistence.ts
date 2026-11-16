import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { agentTurnsRecordAttachment } from "./definition.ts";

export const agentTurnsRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: agentTurnsRecordAttachment,
});
