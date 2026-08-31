import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { closeRecordDatabase, openRecordReader, openRecordWriter, recordSqlitePath } from "../../record/sqlite/database.ts";

export interface SqliteRegistryRow { readonly [key: string]: SQLOutputValue }

function decodePayload<A>(value: SQLOutputValue): A {
  const text = typeof value === "string" ? value : value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : undefined;
  if (text === undefined) throw new Error("canonical registry payload is not text");
  return JSON.parse(text) as A;
}

export function readRegistry<A>(root: string, run: (db: ReturnType<typeof openRecordReader>["db"], decode: typeof decodePayload<A>) => A): A {
  const connection = openRecordReader(recordSqlitePath(root));
  try { return run(connection.db, decodePayload<A>); } finally { closeRecordDatabase(connection); }
}

export function writeRegistry<A>(root: string, run: (db: ReturnType<typeof openRecordWriter>["db"], encode: (value: unknown) => Uint8Array) => A): A {
  const connection = openRecordWriter(recordSqlitePath(root));
  try {
    connection.db.exec("BEGIN IMMEDIATE");
    const barrier = connection.db.prepare("SELECT barrier_state FROM record_metadata WHERE singleton=1").get() as SqliteRegistryRow | undefined;
    if (barrier?.barrier_state !== "open") throw new Error("ProjectDatabase writer barrier is not open");
    const result = run(connection.db, (value) => Buffer.from(JSON.stringify(value), "utf8"));
    connection.db.exec("COMMIT");
    return result;
  } catch (cause) {
    if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
    throw cause;
  } finally { closeRecordDatabase(connection); }
}

export function readRows(db: DatabaseSync, sql: string, ...params: readonly unknown[]): SqliteRegistryRow[] {
  return db.prepare(sql).all(...params as never[]) as SqliteRegistryRow[];
}

export function readRow(db: DatabaseSync, sql: string, ...params: readonly unknown[]): SqliteRegistryRow | undefined {
  return db.prepare(sql).get(...params as never[]) as SqliteRegistryRow | undefined;
}

export { decodePayload };
