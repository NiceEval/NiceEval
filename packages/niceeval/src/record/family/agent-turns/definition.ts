import { defineRecordAttachment } from "../../attachment/index.ts";
import { agentTurnsV1 } from "./version.ts";

export * from "./schema.ts";
export { agentTurnsV1 } from "./version.ts";

export const agentTurnsRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.agent-turns",
  current: agentTurnsV1,
  versions: [agentTurnsV1],
  migrations: [],
});
