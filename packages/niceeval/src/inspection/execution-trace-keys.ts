// @concord-file
// @concord-implements docs/feature/inspection/cli.md#按导入-key-查找
import * as Schema from "effect/Schema";
import { executionTraceIndexKeys as indexKeys } from "../record/family/execution-traces/index-definition.ts";
import type { ExecutionTraceEventRecord } from "../record/family/execution-traces/schema.ts";
import { decodeBase64UrlUtf8, encodeBase64UrlUtf8, utf8ByteLength } from "./bytes.ts";
import {
  InspectionExecutionTraceError,
  integrity,
  openExecutionTraceRecord,
  type ExecutionTraceRecordReader,
} from "./execution-trace-record.ts";
import type { ResolvedInspectionAttempt } from "./facts.ts";
import type { InspectionFactSource } from "./source.ts";
import type { InspectionOperationFor } from "./protocol.ts";
import type { ExecutionKeyRow } from "./results.ts";

export const HISTORICAL_TRACE_INDEX = { state: "not-published", reason: "historical" } as const;

const cursorOrdinal = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const CursorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("index"), key: cursorOrdinal, page: cursorOrdinal, offset: cursorOrdinal }),
  Schema.Struct({ kind: Schema.Literal("key"), key: cursorOrdinal }),
  Schema.Struct({ kind: Schema.Literal("record"), key: cursorOrdinal, ordinal: cursorOrdinal, offset: cursorOrdinal }),
]);
type Cursor = Schema.Schema.Type<typeof CursorSchema>;
type RowAt = { readonly row: ExecutionKeyRow; readonly cursor: Cursor };
type KeysRequest = InspectionOperationFor<"attempt.trace.keys">;

function* rowsForEvent(event: ExecutionTraceEventRecord, offset: number) {
  if (offset === 0) yield { kind: "event", key: event.key, eventId: event.eventId, ordinal: event.ordinal } as const;
  for (let i = Math.max(0, offset - 1); i < event.evidence.length; i += 1) {
    const evidence = event.evidence[i];
    if (evidence !== undefined) {
      yield { kind: "evidence", eventKey: event.key, key: evidence.key, evidenceId: evidence.evidenceId } as const;
    }
  }
}

function* indexedRows(
  index: NonNullable<ExecutionTraceRecordReader["index"]>,
  sourceTraceId: string,
  keys: readonly string[] | undefined,
  cursor: Cursor | undefined,
): Generator<RowAt> {
  function* ordered(prefix: string, key: number): Generator<RowAt> {
    const position = cursor?.kind === "index" && cursor.key === key ? cursor : undefined;
    for (const {
      entry: { value },
      position: at,
    } of index.prefix(prefix, position)) {
      const row =
        value.kind === "event"
          ? ({ kind: "event", key: value.key, eventId: value.eventId, ordinal: value.ordinal } as const)
          : value.kind === "evidence"
            ? ({ kind: "evidence", eventKey: value.eventKey, key: value.key, evidenceId: value.evidenceId } as const)
            : undefined;
      if (row === undefined) throw integrity("Execution trace order contains an invalid entry.");
      yield { row, cursor: { kind: "index", key, ...at } };
    }
  }
  if (keys === undefined) {
    yield* ordered(indexKeys.ordered(sourceTraceId), 0);
    return;
  }
  for (let key = cursor?.key ?? 0; key < keys.length; key += 1) {
    const value = keys[key];
    if (value === undefined) continue;
    const entry = index.find(indexKeys.eventKey(sourceTraceId, value));
    if (entry?.value.kind === "event" && entry.value.key === value) {
      yield* ordered(indexKeys.ordered(sourceTraceId, entry.value.ordinal), key);
    } else {
      yield { row: { kind: "missing", key: value }, cursor: { kind: "key", key } };
    }
  }
}

function* historicalRows(
  reader: ExecutionTraceRecordReader,
  traceId: string,
  keys: readonly string[] | undefined,
  cursor: Cursor | undefined,
): Generator<RowAt> {
  const offsetFor = (ordinal: number) => (cursor?.kind === "record" && cursor.ordinal === ordinal ? cursor.offset : 0);
  function* eventRows(event: ExecutionTraceEventRecord, ordinal: number, key: number): Generator<RowAt> {
    let offset = offsetFor(ordinal);
    for (const row of rowsForEvent(event, offset)) {
      yield { row, cursor: { kind: "record", key, ordinal, offset } };
      offset += 1;
    }
  }

  const byKey = new Map<string, number>();
  const requested = keys === undefined ? undefined : new Set(keys.slice(cursor?.key ?? 0));
  let selectedTrace = false;
  // Historical lookup retains at most one Record page and one ordinal per requested key.
  for (const { record, recordOrdinal } of reader.readRange()) {
    if (record.kind === "trace-header" && (record.traceId === traceId || record.sourceTraceId === traceId)) {
      selectedTrace = true;
      continue;
    }
    if (!selectedTrace) continue;
    if (record.kind === "trace-header") break;
    if (record.kind !== "event") continue;
    if (requested === undefined && recordOrdinal >= (cursor?.kind === "record" ? cursor.ordinal : 0)) {
      yield* eventRows(record, recordOrdinal, 0);
    } else if (requested?.has(record.key)) {
      byKey.set(record.key, recordOrdinal);
      if (byKey.size === requested.size) break;
    }
  }
  if (!selectedTrace) throw missingTrace();
  if (keys === undefined) return;
  for (let key = cursor?.key ?? 0; key < keys.length; key += 1) {
    const value = keys[key];
    if (value === undefined) continue;
    const ordinal = byKey.get(value);
    if (ordinal === undefined) {
      yield { row: { kind: "missing", key: value }, cursor: { kind: "key", key } };
    } else {
      const record = reader.read(ordinal);
      if (record.kind !== "event") throw integrity("Execution trace event ordinal is invalid.");
      yield* eventRows(record, ordinal, key);
    }
  }
}

function missingTrace() {
  return new InspectionExecutionTraceError("inspection-selection-missing", "Execution trace identity was not found.");
}

// @concord-code
// @concord-implements docs/feature/adapters/use-case/long-trace-stream.md#jump
export function projectExecutionTraceKeys(
  source: InspectionFactSource,
  resolved: ResolvedInspectionAttempt,
  operation: KeysRequest,
) {
  const reader = openExecutionTraceRecord(resolved);
  const binding = {
    operation: operation.kind,
    locator: operation.locator,
    traceId: operation.traceId,
    keys: operation.keys ?? null,
    cutoff: source.cutoff().identity,
    source: source.kind,
    originCutoff: resolved.origin.source.cutoff().identity,
    attempt: resolved.attempt.attemptId,
    originRun: resolved.attempt.originRunId,
    family: reader?.identity ?? null,
    companion: reader?.index?.identity ?? null,
  };
  let cursor: Cursor | undefined;
  if (operation.continuation !== undefined) {
    try {
      const raw: unknown = JSON.parse(decodeBase64UrlUtf8(operation.continuation));
      const parsed = Schema.decodeUnknownSync(Schema.Struct({ binding: Schema.Unknown, cursor: CursorSchema }))(raw);
      if (
        JSON.stringify(parsed.binding) !== JSON.stringify(binding) ||
        (operation.keys === undefined
          ? parsed.cursor.key !== 0 || parsed.cursor.kind === "key"
          : parsed.cursor.key >= operation.keys.length) ||
        (parsed.cursor.kind === "index" && reader?.index === undefined) ||
        (parsed.cursor.kind === "record" && reader?.index !== undefined)
      )
        throw new Error("Binding changed");
      cursor = parsed.cursor;
    } catch {
      throw new InspectionExecutionTraceError(
        "restart-required",
        "Execution trace key continuation binding changed; restart from the first page.",
      );
    }
  }
  if (reader === undefined) throw missingTrace();
  let positions: Iterable<RowAt>;
  if (reader.index === undefined) {
    positions = historicalRows(reader, operation.traceId, operation.keys, cursor);
  } else {
    const trace = reader.index.findTrace(operation.traceId);
    if (trace?.value.kind !== "trace") throw missingTrace();
    positions = indexedRows(reader.index, trace.value.sourceTraceId, operation.keys, cursor);
  }
  const rows: ExecutionKeyRow[] = [];
  let bytes = 2;
  let continuation: string | undefined;
  for (const item of positions) {
    const size = utf8ByteLength(JSON.stringify(item.row)) + (rows.length > 0 ? 1 : 0);
    if (rows.length === 256 || (rows.length > 0 && bytes + size > 64 * 1024)) {
      continuation = encodeBase64UrlUtf8(JSON.stringify({ binding, cursor: item.cursor }));
      break;
    }
    rows.push(item.row);
    bytes += size;
  }
  return {
    rows,
    ...(continuation === undefined ? {} : { continuation }),
    ...(reader.index === undefined ? { index: HISTORICAL_TRACE_INDEX } : {}),
  };
}
