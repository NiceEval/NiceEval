import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
} from "./definition.ts";
import { runnerDiagnosticsV1ToV2 } from "./migration/1-to-2.ts";

export const attemptRunnerDiagnosticsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: attemptRunnerDiagnosticsRecordAttachment,
    revision: 2,
    migrations: [runnerDiagnosticsV1ToV2],
  });

export const runRunnerDiagnosticsRecordAttachmentPersistence =
  defineRecordAttachmentPersistence({
    attachment: runRunnerDiagnosticsRecordAttachment,
    revision: 2,
    migrations: [runnerDiagnosticsV1ToV2],
  });
