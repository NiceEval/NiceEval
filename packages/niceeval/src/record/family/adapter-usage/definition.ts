import { defineRecordAttachment, RecordOwner } from "../../attachment/index.ts";
import { AdapterUsageAttachmentSchema, validateAdapterUsageAttachment } from "./schema.ts";

export const adapterUsageRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.adapter-usage",
  schema: AdapterUsageAttachmentSchema,
  validate: validateAdapterUsageAttachment,
});
