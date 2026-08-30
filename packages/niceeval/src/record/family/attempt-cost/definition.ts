import { defineRecordAttachment, RecordOwner } from "../../attachment/index.ts";
import { AttemptCostAttachmentSchema, validateAttemptCostAttachment } from "./schema.ts";

export const attemptCostRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.attempt-cost",
  schema: AttemptCostAttachmentSchema,
  validate: validateAttemptCostAttachment,
});

export type { AttemptCostAttachment } from "./schema.ts";
