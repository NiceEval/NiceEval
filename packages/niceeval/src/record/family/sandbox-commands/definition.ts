import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  SandboxCommandsAttachmentSchema,
  validateSandboxCommandsAttachment,
} from "./schema.ts";

export * from "./schema.ts";

/** Current Sandbox Commands fact only; durable history is separate. */
export const sandboxCommandsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.sandbox-commands",
  schema: SandboxCommandsAttachmentSchema,
  validate: validateSandboxCommandsAttachment,
});
