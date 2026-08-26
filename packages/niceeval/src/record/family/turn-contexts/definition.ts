import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  TurnContextsAttachmentSchema,
  validateTurnContextsAttachment,
} from "./schema.ts";

export * from "./schema.ts";

export const turnContextsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.turn-contexts",
  schema: TurnContextsAttachmentSchema,
  validate: validateTurnContextsAttachment,
});
