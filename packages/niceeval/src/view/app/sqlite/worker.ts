/// <reference lib="webworker" />

import sqlite3InitModule, {
  type Database,
  type SqlValue,
} from "@sqlite.org/sqlite-wasm";

import { selectInspectionOperation } from "../../../inspection/select.ts";
import {
  RECORD_SQLITE_FORMAT,
  RECORD_SQLITE_STORAGE_REVISION,
} from "../../../record/sqlite/types.ts";
import { browserInspectionFacts } from "./facts.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

type Row = Record<string, SqlValue>;

const worker = self as unknown as DedicatedWorkerGlobalScope;
let database: Database | undefined;

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const operation = request.kind === "open"
    ? openSnapshot(request.bytes).then(
        (): WorkerResponse => ({ id: request.id, ok: true, kind: "ready" }),
      )
    : Promise.resolve().then((): WorkerResponse => {
        const db = database;
        if (db === undefined) {
          throw new Error("RecordSnapshot repository is not open.");
        }
        return {
          id: request.id,
          ok: true,
          kind: "result",
          operation: request.operation.kind,
          result: selectInspectionOperation(
            browserInspectionFacts(db),
            request.operation,
          ),
        };
      });
  void operation.then(
    (response) => post(response),
    (cause: unknown) =>
      post({
        id: request.id,
        ok: false,
        error:
          cause instanceof Error
            ? cause.message
            : "The sealed Record snapshot could not be read.",
      }),
  );
};

function post(response: WorkerResponse): void {
  worker.postMessage(response);
}

async function openSnapshot(buffer: ArrayBuffer): Promise<void> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const bytes = new Uint8Array(buffer);
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
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        sqlite3.capi.SQLITE_DESERIALIZE_READONLY,
    );
    if (result !== sqlite3.capi.SQLITE_OK) {
      throw new Error(`SQLite rejected the Record snapshot (${result}).`);
    }
    transferred = true;
    assertCurrentRecordSnapshot(db);
    database?.close();
    database = db;
    return;
  } finally {
    if (database !== db) db.close();
    if (!transferred) sqlite3.wasm.dealloc(pointer);
  }
}

function assertCurrentRecordSnapshot(db: Database): void {
  const rows = query(
    db,
    `SELECT format, storage_revision, artifact_kind
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
  if (sqlText(row.artifact_kind, "record_metadata.artifact_kind") !== "snapshot") {
    throw migrationRequired("Record artifact is not a RecordSnapshot");
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
