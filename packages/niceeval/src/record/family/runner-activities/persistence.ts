import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import {
  attemptRunnerActivitiesRecordAttachment,
  runRunnerActivitiesRecordAttachment,
} from "./definition.ts";

export const attemptRunnerActivitiesRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: attemptRunnerActivitiesRecordAttachment,
    revision: 2,
  });

export const runRunnerActivitiesRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: runRunnerActivitiesRecordAttachment,
    revision: 2,
  });
