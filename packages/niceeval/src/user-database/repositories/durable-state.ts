import type { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { UserDatabaseInvalid, type UserDatabaseFailure } from "../errors.ts";
import {
  DURABLE_STATE_REPOSITORY,
  type DurableStateEntry,
  type DurableStateRequest,
  type UserDatabaseRepositoryResult,
} from "../protocol.ts";
import type { UserDatabaseRepositoryHandler } from "../repository.ts";
import type { UserDatabase } from "../client.ts";

const EntriesTable = "durable_state_entries";
const CreateEntries = `CREATE TABLE ${EntriesTable} (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`;

type SchemaRow = { readonly type: string; readonly name: string; readonly tbl_name: string; readonly sql: string | null };

function exactSql(sql: string): string {
  return sql.trim().replace(/;+$/u, "").replace(/\s+/gu, " ");
}

function invalid(message: string): UserDatabaseInvalid {
  return new UserDatabaseInvalid({
    code: "user-database-invalid",
    message,
    repository: DURABLE_STATE_REPOSITORY,
  });
}

function decodeEntry(row: unknown): DurableStateEntry {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw invalid("durable-state returned a non-object row");
  const key = Reflect.get(row, "key");
  const value = Reflect.get(row, "value");
  if (typeof key !== "string" || typeof value !== "string") throw invalid("durable-state row has invalid key/value fields");
  return Object.freeze({ key, value });
}

function assertCurrentSchema(database: DatabaseSync): void {
  const rows = database.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE tbl_name = ? OR name = ? ORDER BY type, name",
  ).all(EntriesTable, EntriesTable) as SchemaRow[];
  const table = rows.find((row) => row.type === "table" && row.name === EntriesTable && row.tbl_name === EntriesTable);
  const automaticIndex = rows.find((row) => row.type === "index" && row.tbl_name === EntriesTable && row.sql === null);
  if (rows.length !== 2 || table === undefined || exactSql(table.sql ?? "") !== exactSql(CreateEntries) || automaticIndex === undefined) {
    throw invalid("durable-state schema does not match revision 1");
  }
}

function migrateAdjacent(database: DatabaseSync, fromRevision: number): number {
  if (fromRevision !== 0) throw invalid(`durable-state has no migration from revision ${fromRevision}`);
  database.exec(CreateEntries);
  assertCurrentSchema(database);
  return 1;
}

function dispatch(database: DatabaseSync, request: DurableStateRequest): DurableStateResult {
  if (request.operation === "put") {
    database.exec("BEGIN IMMEDIATE");
    try {
      const receipt = database.prepare(
        `INSERT INTO ${EntriesTable}(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(request.key, request.value);
      const changes = Number(receipt.changes);
      if (!Number.isSafeInteger(changes)) throw invalid("durable-state write returned an unsafe change count");
      database.exec("COMMIT");
      return Object.freeze({ repository: DURABLE_STATE_REPOSITORY, operation: "put", changes });
    } catch (cause) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw cause;
    }
  }
  if (request.operation === "get") {
    const row = database.prepare(`SELECT key, value FROM ${EntriesTable} WHERE key = ?`).get(request.key);
    return Object.freeze({
      repository: DURABLE_STATE_REPOSITORY,
      operation: "get",
      entry: row === undefined ? null : decodeEntry(row),
    });
  }
  const entries = database.prepare(`SELECT key, value FROM ${EntriesTable} ORDER BY key`).all().map(decodeEntry);
  return Object.freeze({ repository: DURABLE_STATE_REPOSITORY, operation: "list", entries: Object.freeze(entries) });
}

type DurableStateResult = Extract<UserDatabaseRepositoryResult, { readonly repository: typeof DURABLE_STATE_REPOSITORY }>;

export const durableStateRepositoryHandler: UserDatabaseRepositoryHandler<DurableStateRequest, DurableStateResult> = Object.freeze({
  id: DURABLE_STATE_REPOSITORY,
  currentRevision: 1,
  migrateAdjacent,
  assertCurrentSchema,
  dispatch,
});

function wrongResult(operation: DurableStateRequest["operation"]): UserDatabaseInvalid {
  return invalid(`durable-state worker returned the wrong result for ${operation}`);
}

/** Concrete first-party client facade; it grants no SQL or registration capability. */
export const durableStateRepository = Object.freeze({
  put: (database: UserDatabase, input: DurableStateEntry): Effect.Effect<void, UserDatabaseFailure> =>
    database.dispatch({ repository: DURABLE_STATE_REPOSITORY, operation: "put", ...input }).pipe(
      Effect.flatMap((result) => result.repository === DURABLE_STATE_REPOSITORY && result.operation === "put"
        ? Effect.void
        : Effect.fail(wrongResult("put"))),
    ),
  get: (database: UserDatabase, key: string): Effect.Effect<DurableStateEntry | null, UserDatabaseFailure> =>
    database.dispatch({ repository: DURABLE_STATE_REPOSITORY, operation: "get", key }).pipe(
      Effect.flatMap((result) => result.repository === DURABLE_STATE_REPOSITORY && result.operation === "get"
        ? Effect.succeed(result.entry)
        : Effect.fail(wrongResult("get"))),
    ),
  list: (database: UserDatabase): Effect.Effect<readonly DurableStateEntry[], UserDatabaseFailure> =>
    database.dispatch({ repository: DURABLE_STATE_REPOSITORY, operation: "list" }).pipe(
      Effect.flatMap((result) => result.repository === DURABLE_STATE_REPOSITORY && result.operation === "list"
        ? Effect.succeed(result.entries)
        : Effect.fail(wrongResult("list"))),
    ),
});
