import { defineRecordAttachmentPersistence } from "../../attachment/index.ts";
import { assertionsRecordAttachment } from "./definition.ts";
import { assertionsV1ToV2 } from "./migrate/1-to-2.ts";
import { assertionsV2ToV3 } from "./migrate/2-to-3.ts";
import { assertionsV3ToV4 } from "./migrate/3-to-4.ts";

/** Durable interpretation and private adjacent history for Assertions. */
export const assertionsRecordAttachmentPersistence = defineRecordAttachmentPersistence({
  attachment: assertionsRecordAttachment,
  revision: 4,
  migrations: [assertionsV1ToV2, assertionsV2ToV3, assertionsV3ToV4],
});
