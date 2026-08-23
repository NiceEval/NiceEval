import { defineRecordAttachment } from "../../attachment/index.ts";
import { sourcesV1 } from "./version.ts";

export const sourcesRecordAttachment = defineRecordAttachment({
  owner: "run",
  family: "niceeval.sources",
  current: sourcesV1,
  versions: [sourcesV1],
  migrations: [],
});
