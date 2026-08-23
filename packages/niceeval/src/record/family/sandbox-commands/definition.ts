import { defineRecordAttachment } from "../../attachment/index.ts";
import { sandboxCommandsV1 } from "./version.ts";

export * from "./schema.ts";
export { sandboxCommandsV1 } from "./version.ts";

export const sandboxCommandsRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.sandbox-commands",
  current: sandboxCommandsV1,
  versions: [sandboxCommandsV1],
  migrations: [],
});
