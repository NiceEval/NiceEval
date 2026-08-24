import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  AttemptRunnerDiagnosticsAttachmentSchema,
  RunRunnerDiagnosticsAttachmentSchema,
  validateAttemptRunnerDiagnosticsAttachment,
  validateRunRunnerDiagnosticsAttachment,
} from "./schema.ts";

export * from "./schema.ts";

export const attemptRunnerDiagnosticsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.runner-diagnostics",
  schema: AttemptRunnerDiagnosticsAttachmentSchema,
  validate: validateAttemptRunnerDiagnosticsAttachment,
});

export const runRunnerDiagnosticsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "niceeval.runner-diagnostics",
  schema: RunRunnerDiagnosticsAttachmentSchema,
  validate: validateRunRunnerDiagnosticsAttachment,
});
