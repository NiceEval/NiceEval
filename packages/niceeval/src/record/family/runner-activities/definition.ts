import { defineRecordAttachment } from "../../attachment/index.ts";
import {
  attemptRunnerActivitiesV1,
  runRunnerActivitiesV1,
} from "./version.ts";

export * from "./schema.ts";
export * from "./version.ts";

export const attemptRunnerActivitiesRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.runner-activities",
  current: attemptRunnerActivitiesV1,
  versions: [attemptRunnerActivitiesV1],
  migrations: [],
});

export const runRunnerActivitiesRecordAttachment = defineRecordAttachment({
  owner: "run",
  family: "niceeval.runner-activities",
  current: runRunnerActivitiesV1,
  versions: [runRunnerActivitiesV1],
  migrations: [],
});
