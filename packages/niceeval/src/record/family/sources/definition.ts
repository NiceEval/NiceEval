import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  SourcesAttachmentSchema,
  validateSourcesAttachment,
} from "./schema.ts";

/** Current Sources fact only; durable history is composed in persistence.ts. */
export const sourcesRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "niceeval.sources",
  schema: SourcesAttachmentSchema,
  validate: validateSourcesAttachment,
});
