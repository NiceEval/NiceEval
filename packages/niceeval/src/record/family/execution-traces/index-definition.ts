import { Schema } from "effect";
import { defineAttemptRecordCollection } from "../../authoring.ts";

const ordinal = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const ExecutionTraceIndexEntrySchema = Schema.Struct({
  searchKey: Schema.String,
  recordOrdinal: ordinal,
  value: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("trace"),
      sourceTraceId: Schema.String,
      traceId: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("event"),
      sourceTraceId: Schema.String,
      traceId: Schema.String,
      key: Schema.String,
      eventId: Schema.String,
      ordinal,
    }),
    Schema.Struct({
      kind: Schema.Literal("evidence"),
      sourceTraceId: Schema.String,
      traceId: Schema.String,
      eventKey: Schema.String,
      eventId: Schema.String,
      key: Schema.String,
      evidenceId: Schema.String,
      ordinal,
      evidenceOrdinal: ordinal,
    }),
    Schema.Struct({ kind: Schema.Literal("scope"), ordinal }),
  ]),
});

export const EXECUTION_TRACE_INDEX_PAGE_ENTRIES = 64;
export const EXECUTION_TRACE_INDEX_PAGE_BYTES = 48 * 1024;

export const ExecutionTraceIndexRecordSchema = Schema.Struct({
  entries: Schema.NonEmptyArray(ExecutionTraceIndexEntrySchema),
});

export type ExecutionTraceIndexEntry = Schema.Schema.Type<typeof ExecutionTraceIndexEntrySchema>;
export type ExecutionTraceIndexRecord = Schema.Schema.Type<typeof ExecutionTraceIndexRecordSchema>;

export const executionTraceIndexRecordCollection = defineAttemptRecordCollection({
  family: "niceeval.execution-trace-index",
  item: ExecutionTraceIndexRecordSchema,
});

const utf8 = new TextEncoder();

function part(text: string): string {
  let encoded = "";
  for (const byte of utf8.encode(text)) encoded += byte.toString(16).padStart(2, "0");
  return encoded + "/";
}

function position(ordinal: number): string {
  return ordinal.toString(16).padStart(14, "0") + "/";
}

/** These ASCII keys sort identically in SQLite BINARY and a reader's string comparison. */
export const executionTraceIndexKeys = Object.freeze({
  trace: (sourceTraceId: string) => "0/" + part(sourceTraceId),
  traceId: (traceId: string) => "1/" + part(traceId),
  eventKey: (sourceTraceId: string, key: string) => "2/" + part(sourceTraceId) + part(key),
  eventId: (eventId: string) => "3/" + part(eventId),
  evidenceId: (evidenceId: string) => "4/" + part(evidenceId),
  ordered: (sourceTraceId: string, ordinal?: number) =>
    "5/" + part(sourceTraceId) + (ordinal === undefined ? "" : position(ordinal)),
  scope: (sourceTraceId: string, ordinal?: number) =>
    "6/" + part(sourceTraceId) + (ordinal === undefined ? "" : position(ordinal)),
  evidencePosition: position,
});
