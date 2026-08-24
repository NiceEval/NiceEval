import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import {
  attemptRunnerActivitiesRecordAttachment,
  runRunnerActivitiesRecordAttachment,
} from "./definition.ts";
import { runnerActivitiesV1ToV2 } from "./migration/1-to-2.ts";

export const attemptRunnerActivitiesRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: attemptRunnerActivitiesRecordAttachment,
    revision: 2,
    migrations: [runnerActivitiesV1ToV2],
  });

export const runRunnerActivitiesRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: runRunnerActivitiesRecordAttachment,
    revision: 2,
    migrations: [runnerActivitiesV1ToV2],
  });
