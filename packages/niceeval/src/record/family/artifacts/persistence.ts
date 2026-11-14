import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "./definition.ts";

export const attemptArtifactsRecordAttachmentPersistence =
  defineOfficialRecordAttachmentPersistence({
    attachment: attemptArtifactsRecordAttachment,
  });

export const runArtifactsRecordAttachmentPersistence =
  defineOfficialRecordAttachmentPersistence({
    attachment: runArtifactsRecordAttachment,
  });
