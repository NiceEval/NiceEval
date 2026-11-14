import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { attemptRunnerActivitiesRecordAttachment, runRunnerActivitiesRecordAttachment } from "./definition.ts";

export const attemptRunnerActivitiesRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: attemptRunnerActivitiesRecordAttachment,
});

export const runRunnerActivitiesRecordAttachmentPersistence = defineOfficialRecordAttachmentPersistence({
  attachment: runRunnerActivitiesRecordAttachment,
});
