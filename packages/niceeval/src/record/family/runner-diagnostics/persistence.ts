import { defineOfficialRecordAttachmentPersistence } from "../../attachment/protocol.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
} from "./definition.ts";

export const attemptRunnerDiagnosticsRecordAttachmentPersistence =
  defineOfficialRecordAttachmentPersistence({
    attachment: attemptRunnerDiagnosticsRecordAttachment,
  });

export const runRunnerDiagnosticsRecordAttachmentPersistence =
  defineOfficialRecordAttachmentPersistence({
    attachment: runRunnerDiagnosticsRecordAttachment,
  });
