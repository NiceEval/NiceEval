import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "./definition.ts";

export const attemptArtifactsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: attemptArtifactsRecordAttachment,
    revision: 2,
  });

export const runArtifactsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: runArtifactsRecordAttachment,
    revision: 2,
  });
