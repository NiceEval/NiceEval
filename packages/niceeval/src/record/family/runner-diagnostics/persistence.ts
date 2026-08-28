import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
} from "./definition.ts";

export const attemptRunnerDiagnosticsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: attemptRunnerDiagnosticsRecordAttachment,
    revision: 2,
  });

export const runRunnerDiagnosticsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: runRunnerDiagnosticsRecordAttachment,
    revision: 2,
  });
