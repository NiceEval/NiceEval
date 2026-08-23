import { defineRecordAttachment } from "../../attachment/index.ts";
import { fileChangesV1 } from "./version.ts";

export const fileChangesRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.file-changes",
  current: fileChangesV1,
  versions: [fileChangesV1],
  migrations: [],
});
