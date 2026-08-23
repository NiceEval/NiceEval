import { defineRecordAttachment } from "../../attachment/index.ts";
import { turnContextsV1 } from "./version.ts";

export * from "./schema.ts";
export { turnContextsV1 } from "./version.ts";

export const turnContextsRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.turn-contexts",
  current: turnContextsV1,
  versions: [turnContextsV1],
  migrations: [],
});
