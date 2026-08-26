import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  AgentTurnsAttachmentSchema,
  validateAgentTurnsAttachment,
} from "./schema.ts";

export * from "./schema.ts";

export const agentTurnsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.agent-turns",
  schema: AgentTurnsAttachmentSchema,
  validate: validateAgentTurnsAttachment,
});
