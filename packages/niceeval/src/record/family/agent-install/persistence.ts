import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { agentInstallRecordAttachment } from "./definition.ts";

export const agentInstallRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: agentInstallRecordAttachment,
});
