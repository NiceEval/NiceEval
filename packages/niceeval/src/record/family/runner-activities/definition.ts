import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  AttemptRunnerActivitiesAttachmentSchema,
  RunRunnerActivitiesAttachmentSchema,
  validateAttemptRunnerActivitiesAttachment,
  validateRunRunnerActivitiesAttachment,
} from "./schema.ts";

export * from "./schema.ts";

export const attemptRunnerActivitiesRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.runner-activities",
  schema: AttemptRunnerActivitiesAttachmentSchema,
  validate: validateAttemptRunnerActivitiesAttachment,
});

export const runRunnerActivitiesRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "niceeval.runner-activities",
  schema: RunRunnerActivitiesAttachmentSchema,
  validate: validateRunRunnerActivitiesAttachment,
});
