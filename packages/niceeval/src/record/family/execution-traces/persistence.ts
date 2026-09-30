import type { RecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { attemptRecordCollectionRuntime } from "../../authoring.ts";
import { executionTracesRecordCollection } from "./definition.ts";

const runtime = attemptRecordCollectionRuntime(executionTracesRecordCollection);
if (runtime === undefined) throw new Error("Execution trace collection definition is unavailable");

export const executionTracesRecordAttachmentPersistence = runtime.persistence as RecordAttachmentPersistence<
  typeof runtime.attachment,
  1
>;
