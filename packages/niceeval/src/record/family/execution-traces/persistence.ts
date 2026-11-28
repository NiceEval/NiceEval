import type { RecordAttachmentPersistence } from "../../attachment/protocol.ts";
import { attemptRecordCollectionRuntime } from "../../authoring.ts";
import { executionTracesRecordCollection } from "./definition.ts";
import { executionTraceIndexRecordCollection } from "./index-definition.ts";

const runtime = attemptRecordCollectionRuntime(executionTracesRecordCollection);
if (runtime === undefined) throw new Error("Execution trace collection definition is unavailable");

export const executionTracesRecordAttachmentPersistence = runtime.persistence as RecordAttachmentPersistence<
  typeof runtime.attachment,
  undefined
>;

const index = attemptRecordCollectionRuntime(executionTraceIndexRecordCollection);
if (index === undefined) throw new Error("Execution trace index collection definition is unavailable");
export const executionTraceIndexRecordAttachmentPersistence = index.persistence as RecordAttachmentPersistence<
  typeof index.attachment,
  undefined
>;
