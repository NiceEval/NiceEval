import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import { AssertionsAttachmentSchema } from "./schema.ts";
import { validateAssertionsAttachment } from "./validate.ts";

export * from "./content.ts";
export * from "./reference.ts";
export * from "./schema.ts";
export * from "./validate.ts";

/** The current logical fact only; durable revision is composed separately. */
export const assertionsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.assertions",
  schema: AssertionsAttachmentSchema,
  validate: validateAssertionsAttachment,
});
