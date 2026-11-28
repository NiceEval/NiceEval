import { DatabaseSync } from "node:sqlite";
import {
  EXECUTION_TRACE_INDEX_PAGE_BYTES,
  EXECUTION_TRACE_INDEX_PAGE_ENTRIES,
  executionTraceIndexKeys as keys,
  type ExecutionTraceIndexEntry,
  type ExecutionTraceIndexRecord,
} from "./index-definition.ts";
import type { ExecutionTraceHeaderRecord, ExecutionTraceStoredRecord } from "./schema.ts";

/** Uses an automatically removed, disk-backed SQLite database for the sort and uniqueness checks. */
export class ExecutionTraceIndexProjection {
  private readonly db = new DatabaseSync("");
  private readonly insert;
  private readonly insertScope;
  private header: ExecutionTraceHeaderRecord | undefined;
  private scopeOrdinal = 0;
  private eventOrdinal = 0;
  private evidenceCount = 0;
  private indexState: "historical" | "published" | undefined;

  constructor() {
    try {
      this.db.exec(
        "PRAGMA cache_size=-2048; " +
          "CREATE TABLE mapping (key TEXT PRIMARY KEY, item TEXT NOT NULL) WITHOUT ROWID; " +
          "CREATE TABLE scope (trace TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(trace,id)) WITHOUT ROWID",
      );
      this.insert = this.db.prepare("INSERT INTO mapping VALUES (?,?)");
      this.insertScope = this.db.prepare("INSERT INTO scope VALUES (?,?)");
      this.db.exec("BEGIN");
    } catch (cause) {
      this.db.close();
      throw cause;
    }
  }

  add(record: ExecutionTraceStoredRecord, recordOrdinal: number): void {
    if (record.kind === "trace-header") {
      this.checkCounts();
      const indexState = record.index === "published" ? "published" : "historical";
      if (this.indexState !== undefined && this.indexState !== indexState) {
        throw new Error("Execution trace index declarations differ within the Attempt.");
      }
      this.indexState = indexState;
      this.header = record;
      this.eventOrdinal = 0;
      this.scopeOrdinal = 0;
      this.evidenceCount = 0;
      if (indexState === "historical") {
        if (record.scopeCount !== undefined) throw new Error("Historical execution trace contains paged scopes.");
        return;
      }
      if (record.scopeCount !== undefined && record.scopes.length !== 0) {
        throw new Error("Execution trace declares two scope representations.");
      }
      const value = { kind: "trace", traceId: record.traceId, sourceTraceId: record.sourceTraceId } as const;
      this.addMapping(keys.trace(record.sourceTraceId), recordOrdinal, value);
      this.addMapping(keys.traceId(record.traceId), recordOrdinal, value);
      for (const scope of record.scopes) this.insertScope.run(record.traceId, scope.scopeId);
      return;
    }
    const header = this.header;
    if (header === undefined || record.traceId !== header.traceId) {
      throw new Error("Execution trace item has no corresponding header.");
    }
    if (record.kind === "scope") {
      if (header.scopeCount === undefined || record.ordinal !== this.scopeOrdinal++) {
        throw new Error("Execution trace scope sequence is invalid.");
      }
      this.insertScope.run(record.traceId, record.scope.scopeId);
      this.addMapping(keys.scope(header.sourceTraceId, record.ordinal), recordOrdinal, {
        kind: "scope",
        ordinal: record.ordinal,
      });
      return;
    }
    if (record.ordinal !== this.eventOrdinal++) throw new Error("Execution trace event sequence is invalid.");
    this.evidenceCount += record.evidence.length;
    if (this.indexState !== "published") return;
    const event = {
      sourceTraceId: header.sourceTraceId,
      traceId: record.traceId,
      eventId: record.eventId,
      ordinal: record.ordinal,
    } as const;
    const value = { ...event, kind: "event", key: record.key } as const;
    const ordered = keys.ordered(header.sourceTraceId, record.ordinal);
    this.addMapping(keys.eventKey(header.sourceTraceId, record.key), recordOrdinal, value);
    this.addMapping(keys.eventId(record.eventId), recordOrdinal, value);
    this.addMapping(ordered, recordOrdinal, value);
    const evidenceKeys = new Set<string>();
    for (const [evidenceOrdinal, evidence] of record.evidence.entries()) {
      if (evidenceKeys.has(evidence.key)) throw new Error("Execution trace evidence keys must be unique per event.");
      evidenceKeys.add(evidence.key);
      const value = {
        ...event,
        kind: "evidence",
        eventKey: record.key,
        key: evidence.key,
        evidenceId: evidence.evidenceId,
        evidenceOrdinal,
      } as const;
      this.addMapping(keys.evidenceId(evidence.evidenceId), recordOrdinal, value);
      this.addMapping(ordered + keys.evidencePosition(evidenceOrdinal), recordOrdinal, value);
    }
  }

  private addMapping(searchKey: string, recordOrdinal: number, value: ExecutionTraceIndexEntry["value"]): void {
    this.insert.run(searchKey, JSON.stringify({ searchKey, recordOrdinal, value }));
  }

  private checkCounts(): void {
    const current = this.header;
    if (
      (current?.scopeCount ?? 0) !== this.scopeOrdinal ||
      (current?.eventCount !== undefined && current.eventCount !== this.eventOrdinal) ||
      (current?.evidenceCount !== undefined && current.evidenceCount !== this.evidenceCount)
    ) {
      throw new Error("Execution trace counts do not match its header.");
    }
  }

  finish(): "historical" | "published" {
    this.checkCounts();
    this.db.exec("COMMIT");
    return this.indexState ?? "historical";
  }

  *rows(): Generator<ExecutionTraceIndexRecord> {
    let first: ExecutionTraceIndexEntry | undefined;
    let rest: ExecutionTraceIndexEntry[] = [];
    let bytes = 0;
    for (const { item } of this.db.prepare("SELECT item FROM mapping ORDER BY key").iterate()) {
      const text = String(item);
      const length = Buffer.byteLength(text) + 1;
      if (
        first !== undefined &&
        (rest.length + 1 >= EXECUTION_TRACE_INDEX_PAGE_ENTRIES || bytes + length > EXECUTION_TRACE_INDEX_PAGE_BYTES)
      ) {
        yield { entries: [first, ...rest] };
        first = undefined;
        rest = [];
        bytes = 0;
      }
      const entry = JSON.parse(text) as ExecutionTraceIndexEntry;
      if (first === undefined) first = entry;
      else rest.push(entry);
      bytes += length;
    }
    if (first !== undefined) yield { entries: [first, ...rest] };
  }

  close(): void {
    this.db.close();
  }
}
