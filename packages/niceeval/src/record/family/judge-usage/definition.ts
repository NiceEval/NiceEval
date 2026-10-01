import { defineRecordAttachment, RecordOwner } from "../../attachment/index.ts";
import { JudgeUsageAttachmentSchema, validateJudgeUsageAttachment } from "./schema.ts";

export const judgeUsageRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.judge-usage",
  schema: JudgeUsageAttachmentSchema,
  validate: validateJudgeUsageAttachment,
});
