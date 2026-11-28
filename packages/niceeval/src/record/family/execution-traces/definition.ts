import { defineAttemptRecordCollection } from "../../authoring.ts";
import { ExecutionTraceStoredRecordSchema } from "./schema.ts";

export * from "./schema.ts";

/** Fixed Adapter-owned generic execution trace collection. */
export const executionTracesRecordCollection = defineAttemptRecordCollection({
  family: "niceeval.execution-traces",
  item: ExecutionTraceStoredRecordSchema,
});
