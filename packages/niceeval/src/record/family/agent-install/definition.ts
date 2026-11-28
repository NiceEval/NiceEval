// @concord-file
// @concord-implements docs/feature/adapters/architecture/agent-install.md#attempt-install-facts
import { defineRecordAttachment, RecordOwner } from "../../attachment/index.ts";
import { AgentInstallFactsSchema } from "./schema.ts";

export const agentInstallRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.agent-install",
  schema: AgentInstallFactsSchema,
  validate: () => [],
});
