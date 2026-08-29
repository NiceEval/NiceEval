/// <reference lib="webworker" />

import sqlite3InitModule, {
  type Database,
  type SqlValue,
} from "@sqlite.org/sqlite-wasm";
import { Result } from "effect";

import { decodeInspectionOperation } from "../../../inspection/public.ts";
import { selectInspectionOperation } from "../../../inspection/select.ts";
import {
  RECORD_SQLITE_FORMAT,
  RECORD_SQLITE_STORAGE_REVISION,
} from "../../../record/sqlite/types.ts";
import { browserInspectionFacts } from "./facts.ts";
import type { WorkerFailureCode, WorkerRequest, WorkerResponse } from "./protocol.ts";

type Row = Record<string, SqlValue>;

const worker = self as unknown as DedicatedWorkerGlobalScope;
let database: Database | undefined;
let requests = Promise.resolve();

worker.onmessage = (event: MessageEvent<unknown>) => {
  requests = requests.then(() => handleRequest(event.data), () => handleRequest(event.data));
};

async function handleRequest(input: unknown): Promise<void> {
  const request = decodeRequest(input);
  if (request instanceof WorkerProtocolError) {
    post(failure(request.id, request.code, request.message));
    return;
  }
  try {
    if (request.kind === "open") {
      await openRecord(request.bytes);
      post({ id: request.id, ok: true, kind: "ready" });
      return;
    }
    if (request.kind === "close") {
      closeRecord();
      post({ id: request.id, ok: true, kind: "closed" });
      worker.close();
      return;
    }
    const db = database;
    if (db === undefined) throw new WorkerProtocolError(request.id, "repository-not-open", "Record repository is not open.");
    post({
      id: request.id,
      ok: true,
      kind: "result",
      operation: request.operation.kind,
      result: selectInspectionOperation(browserInspectionFacts(db), request.operation),
    });
  } catch (cause) {
    const fallback = request.kind === "open" ? "record-open-failed"
      : request.kind === "close" ? "repository-close-failed" : "inspection-failed";
    const error = cause instanceof WorkerProtocolError
      ? cause
      : new WorkerProtocolError(request.id, fallback, message(cause, "The Record could not be read."));
    post(failure(request.id, error.code, error.message));
  }
}

function post(response: WorkerResponse): void {
  worker.postMessage(response);
}

async function openRecord(buffer: ArrayBuffer): Promise<void> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const bytes = portableRecordBytes(buffer);
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  let transferred = false;
  try {
    if (db.pointer === undefined) {
      throw new Error("SQLite opened without a database pointer.");
    }
    const result = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      "main",
      pointer,
      bytes.byteLength,
      bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
    );
    if (result !== sqlite3.capi.SQLITE_OK) {
      throw new Error(`SQLite rejected the Record (${result}).`);
    }
    transferred = true;
    db.exec("PRAGMA journal_mode=MEMORY; PRAGMA temp_store=MEMORY; PRAGMA query_only=ON");
    assertCurrentRecord(db);
    database?.close();
    database = db;
    return;
  } finally {
    if (database !== db) db.close();
    if (!transferred) sqlite3.wasm.dealloc(pointer);
  }
}

function portableRecordBytes(buffer: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 100) throw new Error("SQLite Record header is incomplete.");
  const writeVersion = bytes[18];
  const readVersion = bytes[19];
  if ((writeVersion !== 1 && writeVersion !== 2) || writeVersion !== readVersion) {
    throw new Error("SQLite Record journal header is invalid.");
  }
  // A checkpointed WAL database remains marked as WAL even when its main file
  // is self-contained. sqlite3_deserialize() has no sidecar VFS, so normalize
  // only this transferred browser copy to the rollback-journal header format.
  if (writeVersion === 2) {
    bytes[18] = 1;
    bytes[19] = 1;
  }
  return bytes;
}

function closeRecord(): void {
  const db = database;
  database = undefined;
  db?.close();
}

function decodeRequest(input: unknown): WorkerRequest | WorkerProtocolError {
  if (!isObject(input) || !Number.isSafeInteger(input.id) || (input.id as number) < 0) {
    return new WorkerProtocolError(validId(input) ?? 0, "worker-request-invalid", "SQLite Worker request id is invalid.");
  }
  const id = input.id as number;
  if (input.kind === "open" && exactKeys(input, ["id", "kind", "bytes"]) && input.bytes instanceof ArrayBuffer) {
    return { id, kind: "open", bytes: input.bytes };
  }
  if (input.kind === "close" && exactKeys(input, ["id", "kind"])) return { id, kind: "close" };
  if (input.kind === "inspect" && exactKeys(input, ["id", "kind", "operation"])) {
    const decoded = decodeInspectionOperation(input.operation);
    if (Result.isSuccess(decoded)) return { id, kind: "inspect", operation: decoded.success };
  }
  return new WorkerProtocolError(id, "worker-request-invalid", "SQLite Worker request is invalid.");
}

function failure(id: number, code: WorkerFailureCode, message: string): WorkerResponse {
  return { id, ok: false, error: { code, message } };
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): number | undefined {
  return isObject(value) && Number.isSafeInteger(value.id) && (value.id as number) >= 0 ? value.id as number : undefined;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && [...expected].sort().every((key, index) => actual[index] === key);
}

class WorkerProtocolError extends Error {
  constructor(readonly id: number, readonly code: WorkerFailureCode, message: string) {
    super(message);
  }
}

function assertCurrentRecord(db: Database): void {
  const rows = query(
    db,
    `SELECT format, storage_revision
      FROM record_metadata
      WHERE singleton = 1`,
  );
  const row = rows[0];
  if (row === undefined) throw migrationRequired("Record metadata is missing");
  const format = sqlText(row.format, "record_metadata.format");
  if (format !== RECORD_SQLITE_FORMAT) {
    throw migrationRequired(
      `Record format ${JSON.stringify(format)} is not ${JSON.stringify(RECORD_SQLITE_FORMAT)}`,
    );
  }
  const revision = integer(
    row.storage_revision,
    "record_metadata.storage_revision",
  );
  if (revision !== RECORD_SQLITE_STORAGE_REVISION) {
    throw migrationRequired(
      `Record storage revision ${revision} is not current revision ${RECORD_SQLITE_STORAGE_REVISION}`,
    );
  }
}

function migrationRequired(reason: string): Error {
  return new Error(
    `${reason}. Upgrade NiceEval and reopen View from the project.`,
  );
}

function query(db: Database, sql: string): Row[] {
  return db.selectObjects(sql) as Row[];
}

function sqlText(value: SqlValue | undefined, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be text.`);
  return value;
}

function integer(value: SqlValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${path} must be an integer.`);
  }
  return value;
}
