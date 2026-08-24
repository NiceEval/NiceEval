import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { agentTurnsRecordAttachment } from "./definition.ts";
import { agentTurnsV1ToV2 } from "./migration/1-to-2.ts";

export const agentTurnsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: agentTurnsRecordAttachment,
  revision: 2,
  migrations: [agentTurnsV1ToV2],
});
