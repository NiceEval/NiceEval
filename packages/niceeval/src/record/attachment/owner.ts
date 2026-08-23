import type { RecordAttachmentOwner } from "../model/core.ts";

export const RecordOwner = Object.freeze({
  run: "run" as const,
  attempt: "attempt" as const,
}) satisfies Readonly<Record<RecordAttachmentOwner, RecordAttachmentOwner>>;

export type { RecordAttachmentOwner } from "../model/core.ts";
