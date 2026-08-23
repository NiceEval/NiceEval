import { defineRecordAttachment } from "../../attachment/index.ts";
import { attemptArtifactsV1, runArtifactsV1 } from "./version.ts";

export const attemptArtifactsRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.artifacts",
  current: attemptArtifactsV1,
  versions: [attemptArtifactsV1],
  migrations: [],
});

export const runArtifactsRecordAttachment = defineRecordAttachment({
  owner: "run",
  family: "niceeval.artifacts",
  current: runArtifactsV1,
  versions: [runArtifactsV1],
  migrations: [],
});
