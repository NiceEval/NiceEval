import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "./definition.ts";
import { artifactsV1ToV2 } from "./migrate/1-to-2.ts";

export const attemptArtifactsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: attemptArtifactsRecordAttachment,
    revision: 2,
    migrations: [artifactsV1ToV2],
  });

export const runArtifactsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: runArtifactsRecordAttachment,
    revision: 2,
    migrations: [artifactsV1ToV2],
  });
