import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { agentTurnsRecordAttachment } from "./definition.ts";
import { agentTurnsV1ToV2 } from "./migration/1-to-2.ts";
import { agentTurnsV2ToV3 } from "./migration/2-to-3.ts";
import { agentTurnsV3ToV4 } from "./migration/3-to-4.ts";

export const agentTurnsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: agentTurnsRecordAttachment,
  revision: 4,
  migrations: [agentTurnsV1ToV2, agentTurnsV2ToV3, agentTurnsV3ToV4],
});
