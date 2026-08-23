import { defineRecordAttachment } from "../../attachment/index.ts";
import {
  attemptRunnerDiagnosticsV1,
  runRunnerDiagnosticsV1,
} from "./version.ts";

export * from "./schema.ts";
export * from "./version.ts";

export const attemptRunnerDiagnosticsRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.runner-diagnostics",
  current: attemptRunnerDiagnosticsV1,
  versions: [attemptRunnerDiagnosticsV1],
  migrations: [],
});

export const runRunnerDiagnosticsRecordAttachment = defineRecordAttachment({
  owner: "run",
  family: "niceeval.runner-diagnostics",
  current: runRunnerDiagnosticsV1,
  versions: [runRunnerDiagnosticsV1],
  migrations: [],
});
