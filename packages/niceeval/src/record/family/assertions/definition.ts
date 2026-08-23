import { defineRecordAttachment } from "../../attachment/index.ts";
import { assertionsV1ToV2 } from "./migrate/1-to-2.ts";
import { assertionsV1, assertionsV2 } from "./version.ts";

export * from "./schema.ts";
export * from "./version.ts";
export { assertionsV1ToV2 } from "./migrate/1-to-2.ts";

export const assertionsRecordAttachment = defineRecordAttachment({
  owner: "attempt",
  family: "niceeval.assertions",
  current: assertionsV2,
  versions: [assertionsV1, assertionsV2],
  migrations: [assertionsV1ToV2],
});
