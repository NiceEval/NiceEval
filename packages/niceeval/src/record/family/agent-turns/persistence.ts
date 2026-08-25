import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { agentTurnsRecordAttachment } from "./definition.ts";
import { agentTurnsV1ToV2 } from "./migration/1-to-2.ts";
import { agentTurnsV2ToV3 } from "./migration/2-to-3.ts";

export const agentTurnsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: agentTurnsRecordAttachment,
  revision: 3,
  migrations: [agentTurnsV1ToV2, agentTurnsV2ToV3],
});
