import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { constants, DatabaseSync, type SQLOutputValue, type StatementSync } from "node:sqlite";
import { createRecordSchema, RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL, RECORD_SQLITE_REVISION_1_DIGEST, RECORD_SQLITE_SCHEMA_SQL } from "./schema.ts";
import { sqliteError } from "./errors.ts";
import { RECORD_SQLITE_FORMAT, RECORD_SQLITE_MAX_SNAPSHOT_BYTES, RECORD_SQLITE_STORAGE_REVISION } from "./types.ts";

const MINIMUM_NODE = [24, 15, 0] as const;
const READ_DENIED = new Set([
  constants.SQLITE_ATTACH,
  constants.SQLITE_DETACH,
  constants.SQLITE_INSERT,
  constants.SQLITE_UPDATE,
  constants.SQLITE_DELETE,
  constants.SQLITE_CREATE_INDEX,
  constants.SQLITE_CREATE_TABLE,
  constants.SQLITE_CREATE_TEMP_INDEX,
  constants.SQLITE_CREATE_TEMP_TABLE,
  constants.SQLITE_CREATE_TEMP_TRIGGER,
  constants.SQLITE_CREATE_TEMP_VIEW,
  constants.SQLITE_CREATE_TRIGGER,
  constants.SQLITE_CREATE_VIEW,
  constants.SQLITE_DROP_INDEX,
  constants.SQLITE_DROP_TABLE,
  constants.SQLITE_DROP_TEMP_INDEX,
  constants.SQLITE_DROP_TEMP_TABLE,
  constants.SQLITE_DROP_TEMP_TRIGGER,
  constants.SQLITE_DROP_TEMP_VIEW,
  constants.SQLITE_DROP_TRIGGER,
  constants.SQLITE_DROP_VIEW,
  constants.SQLITE_ALTER_TABLE,
  constants.SQLITE_REINDEX,
  constants.SQLITE_ANALYZE,
  constants.SQLITE_CREATE_VTABLE,
  constants.SQLITE_DROP_VTABLE,
]);

export interface RecordDatabase {
  readonly db: DatabaseSync;
  readonly path: string;
  readonly mode: "writer" | "reader" | "maintenance";
  readonly statements: Map<string, StatementSync>;
}

export function recordStatement(connection: RecordDatabase, sql: string): StatementSync {
  const existing = connection.statements.get(sql);
  if (existing !== undefined) return existing;
  const prepared = connection.db.prepare(sql);
  connection.statements.set(sql, prepared);
  return prepared;
}

function nodeVersionTuple(): readonly number[] {
  return process.versions.node.split(".").map((part) => Number(part));
}

export function assertRecordSqliteRuntime(): void {
  const actual = nodeVersionTuple();
  for (let index = 0; index < MINIMUM_NODE.length; index += 1) {
    const value = actual[index] ?? 0;
    const minimum = MINIMUM_NODE[index];
    if (value > minimum) return;
    if (value < minimum) {
      throw sqliteError(
        "record-runtime-unsupported",
        "open",
        `Project Record SQLite requires Node 24.15.0 or newer; received ${process.versions.node}`,
      );
    }
  }
}

/** Resolves the database below the already-issued Record storage root. */
export function recordSqlitePath(recordStorageRoot: string): string {
  if (recordStorageRoot.length === 0) throw sqliteError("record-database-invalid", "locate", "Record storage root is empty");
  return join(resolve(recordStorageRoot), "record.sqlite");
}

function configureCommon(db: DatabaseSync): void {
  db.enableLoadExtension(false);
  db.enableDefensive(true);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA mmap_size=0; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA recursive_triggers=ON;");
}

function writerAuthorizer(action: number, arg1: string | null, arg2: string | null): number {
  if (action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
  if (action === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
  if (action === constants.SQLITE_PRAGMA && arg1 !== "busy_timeout" && arg1 !== "quick_check" && arg1 !== "foreign_key_check") {
    return constants.SQLITE_DENY;
  }
  return constants.SQLITE_OK;
}

function readerAuthorizer(action: number, arg1: string | null, arg2: string | null, dbName: string | null): number {
  if (dbName === "temp") {
    const preparedTable = arg1 === "niceeval_prepared_seal_raw" || arg1 === "niceeval_prepared_seal_ordered";
    return preparedTable && (action === constants.SQLITE_READ || action === constants.SQLITE_INSERT || action === constants.SQLITE_DELETE)
      ? constants.SQLITE_OK
      : constants.SQLITE_DENY;
  }
  if (dbName !== null && dbName !== "main") return constants.SQLITE_DENY;
  if (READ_DENIED.has(action)) return constants.SQLITE_DENY;
  if (action === constants.SQLITE_PRAGMA && arg1 !== "quick_check" && arg1 !== "foreign_key_check") return constants.SQLITE_DENY;
  if (action === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
  return constants.SQLITE_OK;
}

function schemaRows(db: DatabaseSync): readonly string[] {
  const rows = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type, name LIMIT 257`).all() as unknown as readonly Record<string, SQLOutputValue>[];
  if (rows.length > 256) throw sqliteError("record-database-invalid", "validate-schema", "database schema exceeds the bounded object allowlist");
  return rows.map((row) => JSON.stringify([
    decodeText(row.type, "sqlite_schema.type"),
    decodeText(row.name, "sqlite_schema.name"),
    decodeText(row.tbl_name, "sqlite_schema.tbl_name"),
    row.sql === null ? null : normalizeSql(decodeText(row.sql, "sqlite_schema.sql")),
  ]));
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").replace(/\s*([(),])\s*/gu, "$1").trim().replace(/;$/u, "");
}

let canonicalSchemaRows: readonly string[] | undefined;

function expectedSchemaRows(): readonly string[] {
  if (canonicalSchemaRows !== undefined) return canonicalSchemaRows;
  const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true, readBigInts: true });
  try {
    db.exec(RECORD_SQLITE_SCHEMA_SQL);
    canonicalSchemaRows = Object.freeze(schemaRows(db));
    return canonicalSchemaRows;
  } finally {
    db.close();
  }
}

function decodeText(value: SQLOutputValue | undefined, field: string): string {
  if (typeof value !== "string") throw sqliteError("record-database-invalid", "decode", `${field} is not text`);
  return value;
}

function decodeInteger(value: SQLOutputValue | undefined, field: string): number {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric)) {
    throw sqliteError("record-database-invalid", "decode", `${field} is not a safe integer`);
  }
  return numeric;
}

export function validateExactSchema(
  connection: RecordDatabase,
  expectedArtifactKind?: "operational" | "snapshot",
): void {
  const actual = schemaRows(connection.db);
  const expected = expectedSchemaRows();
  if (actual.length !== expected.length || actual.some((row, index) => row !== expected[index])) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "database objects do not match the exact Project Record schema allowlist");
  }
  const metadata = connection.db.prepare(`SELECT format,storage_revision,artifact_kind,snapshot_identity,
    snapshot_source_generation,snapshot_created_at FROM record_metadata WHERE singleton=1`).get() as
    | Record<string, SQLOutputValue>
    | undefined;
  if (metadata === undefined) throw sqliteError("record-database-invalid", "validate-schema", "record metadata is missing");
  if (decodeText(metadata.format, "record_metadata.format") !== RECORD_SQLITE_FORMAT) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "record format is unsupported");
  }
  const revision = decodeInteger(metadata.storage_revision, "record_metadata.storage_revision");
  if (revision !== RECORD_SQLITE_STORAGE_REVISION) {
    throw sqliteError(
      revision < RECORD_SQLITE_STORAGE_REVISION ? "record-schema-migration-required" : "record-schema-unsupported",
      "validate-schema",
      `record storage revision ${revision} is not ${RECORD_SQLITE_STORAGE_REVISION}`,
    );
  }
  const artifactKind = decodeText(metadata.artifact_kind, "record_metadata.artifact_kind");
  if (expectedArtifactKind !== undefined && artifactKind !== expectedArtifactKind) {
    throw sqliteError("record-database-invalid", "validate-schema", `expected ${expectedArtifactKind} Record artifact, received ${artifactKind}`);
  }
  const migrations = connection.db.prepare(`SELECT target_revision,migration_digest FROM storage_migrations ORDER BY target_revision LIMIT ?`)
    .all(RECORD_SQLITE_STORAGE_REVISION + 1) as unknown as readonly Record<string, SQLOutputValue>[];
  if (migrations.length !== RECORD_SQLITE_STORAGE_REVISION || migrations.some((row, index) =>
    decodeInteger(row.target_revision, "storage_migrations.target_revision") !== index + 1)) {
    throw sqliteError("record-database-invalid", "validate-schema", "storage migration receipts are not a continuous checked-in chain");
  }
  if (decodeText(migrations[0]?.migration_digest, "storage_migrations.migration_digest") !== RECORD_SQLITE_REVISION_1_DIGEST) {
    throw sqliteError("record-database-invalid", "validate-schema", "storage revision 1 migration receipt digest is invalid");
  }
}

export function openRecordWriter(path: string, busyTimeoutMs = 5_000): RecordDatabase {
  assertRecordSqliteRuntime();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    readBigInts: true,
    timeout: Math.max(0, Math.min(30_000, Math.trunc(busyTimeoutMs))),
  });
  const connection: RecordDatabase = { db, path, mode: "writer", statements: new Map() };
  try {
    configureCommon(db);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;");
    let created = false;
    try {
      const objectCount = db.prepare("SELECT count(*) AS count FROM sqlite_schema").get() as Record<string, SQLOutputValue>;
      if (decodeInteger(objectCount.count, "sqlite_schema.count") === 0) {
        createRecordSchema(db, randomUUID(), new Date().toISOString());
        created = true;
      }
      db.exec("COMMIT");
    } catch (cause) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw cause;
    }
    // Both the creator and every concurrent loser validate the exact committed
    // schema + migration receipt before the connection becomes a writer.
    validateExactSchema(connection, "operational");
    if (created) db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    db.setAuthorizer(writerAuthorizer);
    return connection;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

export function openRecordReader(
  path: string,
  expectedArtifactKind: "operational" | "snapshot" = "operational",
): RecordDatabase {
  assertRecordSqliteRuntime();
  if (expectedArtifactKind === "snapshot") {
    let metadata;
    try {
      metadata = lstatSync(path);
    } catch (cause) {
      throw sqliteError("record-database-invalid", "open-snapshot", "RecordSnapshot is not an accessible regular file", cause);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > RECORD_SQLITE_MAX_SNAPSHOT_BYTES) {
      throw sqliteError("record-resource-limit-exceeded", "open-snapshot", `RecordSnapshot exceeds the ${RECORD_SQLITE_MAX_SNAPSHOT_BYTES} byte file ceiling or is not a regular file`);
    }
  }
  const db = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    readBigInts: true,
    readOnly: true,
    timeout: 0,
  });
  const connection: RecordDatabase = { db, path, mode: "reader", statements: new Map() };
  try {
    configureCommon(db);
    // The main database is opened read-only. These two private TEMP tables are
    // the only writable reader state and are required for bounded Seal sort.
    db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
    db.setAuthorizer(readerAuthorizer);
    validateExactSchema(connection, expectedArtifactKind);
    return connection;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

export function openRecordMaintenance(path: string): RecordDatabase {
  assertRecordSqliteRuntime();
  const db = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    readBigInts: true,
    timeout: 5_000,
  });
  const connection: RecordDatabase = { db, path, mode: "maintenance", statements: new Map() };
  configureCommon(db);
  return connection;
}

export function closeRecordDatabase(connection: RecordDatabase): void {
  // node:sqlite finalizes every cached statement when its owning connection is
  // closed; StatementSync intentionally exposes no independent finalize API.
  connection.statements.clear();
  if (connection.db.isOpen) connection.db.close();
}
