import type { RecordDatabase } from "./database.ts";
import { isSqliteBusy, sqliteError } from "./errors.ts";

export function withImmediateTransaction<A>(
  connection: RecordDatabase,
  deadlineEpochMs: number,
  operation: string,
  body: () => A,
): A {
  const remaining = Math.trunc(deadlineEpochMs - Date.now());
  if (!Number.isFinite(deadlineEpochMs) || remaining <= 0) {
    throw sqliteError("record-write-busy", operation, "write deadline elapsed before BEGIN IMMEDIATE");
  }
  connection.db.exec(`PRAGMA busy_timeout=${Math.min(30_000, remaining)}`);
  try {
    connection.db.exec("BEGIN IMMEDIATE");
  } catch (cause) {
    if (isSqliteBusy(cause)) throw sqliteError("record-write-busy", operation, "database remained busy until the operation deadline", cause);
    throw sqliteError("record-sqlite-error", operation, "BEGIN IMMEDIATE failed", cause);
  }
  try {
    const result = body();
    if (Date.now() > deadlineEpochMs) {
      throw sqliteError("record-write-busy", operation, "write deadline elapsed before commit");
    }
    connection.db.exec("COMMIT");
    return result;
  } catch (cause) {
    if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
    throw cause;
  }
}
