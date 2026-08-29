import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { constants, DatabaseSync, type SQLOutputValue, type StatementSync } from "node:sqlite";
import {
  inspectSqliteMigrationLedger,
  migrateSqliteDatabase,
  SqliteMigrationKernelFailure,
} from "../../sqlite-migration-kernel.ts";
import { recordSqliteMigrations } from "./migrations.ts";
import {
  RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL,
  RECORD_SQLITE_REVISION_1_DIGEST,
  RECORD_SQLITE_REVISION_1_SQL,
} from "./schema.ts";
import { sqliteError } from "./errors.ts";
import { RECORD_SQLITE_FORMAT, RECORD_SQLITE_STORAGE_REVISION } from "./types.ts";

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

/** Resolves the one ProjectDatabase while preserving custom non-project roots. */
export function recordSqlitePath(recordStorageRoot: string): string {
  if (recordStorageRoot.length === 0) throw sqliteError("record-database-invalid", "locate", "Record storage root is empty");
  const resolvedRoot = resolve(recordStorageRoot);
  return basename(resolvedRoot) === "record" && basename(dirname(resolvedRoot)) === ".niceeval"
    ? join(dirname(resolvedRoot), "record.sqlite")
    : join(resolvedRoot, "record.sqlite");
}

function legacyRecordSqlitePath(path: string): string | undefined {
  const parent = dirname(path);
  return basename(path) === "record.sqlite" && basename(parent) === ".niceeval"
    ? join(parent, "record", "record.sqlite")
    : undefined;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return false;
    throw sqliteError("record-database-invalid", "locate", "Record path could not be inspected safely", cause);
  }
}

/** Record/0.13 is never opened or silently migrated into ProjectDatabase. */
function assertLegacyRecordAbsent(path: string): void {
  const legacyPath = legacyRecordSqlitePath(path);
  if (legacyPath === undefined) return;
  if (!pathExists(legacyPath)) return;
  throw sqliteError(
    "record-schema-unsupported",
    "locate",
    `legacy Record/0.13 database is unsupported and blocks ProjectDatabase: ${legacyPath}`,
  );
}

export type ProjectRecordDatabaseInspection =
  | { readonly state: "current"; readonly exists: boolean }
  | { readonly state: "unsupported"; readonly format: string }
  | { readonly state: "foreign" };

/**
 * Bounded identity probe used only by explicit maintenance. It never creates a
 * database and never treats the pre-ProjectDatabase directory as a migration
 * source.
 */
export function inspectProjectRecordDatabase(path: string): ProjectRecordDatabaseInspection {
  assertRecordSqliteRuntime();
  const legacyPath = legacyRecordSqlitePath(path);
  if (legacyPath !== undefined && pathExists(legacyPath)) {
    return Object.freeze({ state: "unsupported", format: "niceeval.record/0.13.x" });
  }
  if (!pathExists(path)) return Object.freeze({ state: "current", exists: false });
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) return Object.freeze({ state: "foreign" });

  let connection: RecordDatabase | undefined;
  try {
    connection = openRecordMaintenance(path);
    const table = connection.db.prepare(`SELECT count(*) AS count FROM sqlite_schema
      WHERE type='table' AND name='record_metadata'`).get() as Record<string, SQLOutputValue>;
    if (decodeInteger(table.count, "sqlite_schema.record_metadata") !== 1) {
      return Object.freeze({ state: "foreign" });
    }
    let row: Record<string, SQLOutputValue> | undefined;
    try {
      row = connection.db.prepare(`SELECT format,storage_revision
        FROM record_metadata WHERE singleton=1`).get() as
          | Record<string, SQLOutputValue>
          | undefined;
    } catch {
      return Object.freeze({ state: "foreign" });
    }
    if (row === undefined || typeof row.format !== "string") return Object.freeze({ state: "foreign" });
    if (row.format !== RECORD_SQLITE_FORMAT) {
      return Object.freeze({ state: "unsupported", format: row.format });
    }
    let revision: number;
    try {
      revision = decodeInteger(row.storage_revision, "record_metadata.storage_revision");
    } catch {
      return Object.freeze({ state: "foreign" });
    }
    if (revision !== RECORD_SQLITE_STORAGE_REVISION) {
      return Object.freeze({ state: "unsupported", format: row.format });
    }
    try {
      validateExactSchema(connection);
      return Object.freeze({ state: "current", exists: true });
    } catch {
      return Object.freeze({ state: "unsupported", format: row.format });
    }
  } catch {
    return Object.freeze({ state: "foreign" });
  } finally {
    if (connection !== undefined) closeRecordDatabase(connection);
  }
}

function configureCommon(db: DatabaseSync): void {
  db.enableLoadExtension(false);
  db.enableDefensive(true);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA mmap_size=0; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA recursive_triggers=ON;");
}

interface RecordMaintenanceOpenOptions {
  readonly vacuumIntoPath?: string;
}

function writableAuthorizer(input?: RecordMaintenanceOpenOptions) {
  return (action: number, arg1: string | null, arg2: string | null): number => {
    if (action === constants.SQLITE_ATTACH) {
      // SQLite implements VACUUM INTO as a private ATTACH. Only the exact
      // Host-created target is admitted; maintenance callers cannot attach an
      // arbitrary database.
      return input?.vacuumIntoPath !== undefined && arg1 === input.vacuumIntoPath
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    }
    if (action === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
    if (action === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
    if (action === constants.SQLITE_PRAGMA) {
      const permitted = arg1 === "busy_timeout" || arg1 === "quick_check" || arg1 === "foreign_key_check" || arg1 === "wal_checkpoint";
      if (!permitted) return constants.SQLITE_DENY;
    }
    return constants.SQLITE_OK;
  };
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

const canonicalSchemaRows = new Map<string, readonly string[]>();

function expectedSchemaRows(sql?: string): readonly string[] {
  const key = sql ?? "bootstrap";
  const cached = canonicalSchemaRows.get(key);
  if (cached !== undefined) return cached;
  const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true, readBigInts: true });
  try {
    if (sql === undefined) {
      const appliedAt = "1970-01-01T00:00:00.000Z";
      migrateSqliteDatabase({
        database: db,
        ledgerTable: "storage_migrations",
        catalog: recordSqliteMigrations({ storageGeneration: "00000000-0000-4000-8000-000000000000", appliedAt }),
        expectedFromVersion: 0,
        bootstrapping: true,
        appliedAt: () => appliedAt,
        validateCurrent: () => undefined,
      });
    } else {
      db.exec(sql);
    }
    const rows = Object.freeze(schemaRows(db));
    canonicalSchemaRows.set(key, rows);
    return rows;
  } finally {
    db.close();
  }
}

function validateSchemaObjects(connection: RecordDatabase, sql?: string): void {
  const actual = schemaRows(connection.db);
  const expected = expectedSchemaRows(sql);
  if (actual.length !== expected.length || actual.some((row, index) => row !== expected[index])) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "database objects do not match the exact Project Record schema allowlist");
  }
}

function storageRevision(connection: RecordDatabase): number {
  const row = connection.db.prepare("SELECT storage_revision FROM record_metadata WHERE singleton=1").get() as
    | Record<string, SQLOutputValue>
    | undefined;
  if (row === undefined) throw sqliteError("record-schema-unsupported", "validate-schema", "ProjectDatabase identity is missing");
  return decodeInteger(row.storage_revision, "record_metadata.storage_revision");
}

function validateExistingOperationalSchemaForWriter(connection: RecordDatabase): void {
  const revision = storageRevision(connection);
  if (revision === RECORD_SQLITE_STORAGE_REVISION) {
    validateExactSchema(connection);
    return;
  }
  throw sqliteError(
    "record-schema-unsupported",
    "validate-schema",
    `record storage revision ${revision} cannot be opened by revision ${RECORD_SQLITE_STORAGE_REVISION}`,
  );
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

function validateCurrentRecordDomain(connection: RecordDatabase): void {
  let metadata: Record<string, SQLOutputValue> | undefined;
  try {
    metadata = connection.db.prepare(`SELECT format,storage_revision,storage_generation
      FROM record_metadata WHERE singleton=1`).get() as
      | Record<string, SQLOutputValue>
      | undefined;
  } catch (cause) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "database does not expose the ProjectDatabase identity", cause);
  }
  if (metadata === undefined) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "ProjectDatabase identity is missing");
  }
  if (decodeText(metadata.format, "record_metadata.format") !== RECORD_SQLITE_FORMAT) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "record format is unsupported");
  }
  const revision = decodeInteger(metadata.storage_revision, "record_metadata.storage_revision");
  if (revision !== RECORD_SQLITE_STORAGE_REVISION) {
    throw sqliteError(
      "record-schema-unsupported",
      "validate-schema",
      `record storage revision ${revision} is not ${RECORD_SQLITE_STORAGE_REVISION}`,
    );
  }
  validateSchemaObjects(connection);
  const coordination = connection.db.prepare(`SELECT revision,operational_generation,next_writer_sequence,
    writer_ticket_id,barrier_id FROM coordination_state WHERE singleton=1`).get() as
    | Record<string, SQLOutputValue>
    | undefined;
  if (coordination === undefined) {
    throw sqliteError("record-database-invalid", "validate-schema", "host coordination generation is missing");
  }
  const operationalGeneration = decodeText(
    coordination.operational_generation,
    "coordination_state.operational_generation",
  );
  const storageGeneration = decodeText(metadata.storage_generation, "record_metadata.storage_generation");
  if (operationalGeneration !== storageGeneration) {
    throw sqliteError(
      "record-database-invalid",
      "validate-schema",
      "operational coordination generation does not match ProjectDatabase",
    );
  }
}

export function validateExactSchema(
  connection: RecordDatabase,
): void {
  const appliedAt = "1970-01-01T00:00:00.000Z";
  const catalog = recordSqliteMigrations({ storageGeneration: "validation-only", appliedAt });
  try {
    if (connection.db.isTransaction) {
      const version = inspectSqliteMigrationLedger(connection.db, "storage_migrations", catalog);
      if (version !== RECORD_SQLITE_STORAGE_REVISION) {
        throw new SqliteMigrationKernelFailure("receipt-discontinuous", "SQLite migration receipts do not reach the current version");
      }
      validateCurrentRecordDomain(connection);
      return;
    }
    migrateSqliteDatabase({
      database: connection.db,
      ledgerTable: "storage_migrations",
      catalog,
      expectedFromVersion: RECORD_SQLITE_STORAGE_REVISION,
      bootstrapping: false,
      appliedAt: () => appliedAt,
      validateCurrent: () => validateCurrentRecordDomain(connection),
    });
  } catch (cause) {
    if (cause instanceof SqliteMigrationKernelFailure) {
      throw sqliteError("record-database-invalid", "validate-schema", cause.message, cause);
    }
    throw cause;
  }
}

export function openRecordWriter(path: string, busyTimeoutMs = 5_000): RecordDatabase {
  assertRecordSqliteRuntime();
  assertLegacyRecordAbsent(path);
  const existed = pathExists(path);
  if (existed) {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw sqliteError("record-schema-unsupported", "open", "ProjectDatabase path is not a regular Host-owned file");
    }
  }
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
    const objectCount = db.prepare("SELECT count(*) AS count FROM sqlite_schema").get() as Record<string, SQLOutputValue>;
    const isEmpty = decodeInteger(objectCount.count, "sqlite_schema.count") === 0;
    if (isEmpty && existed) {
      throw sqliteError("record-schema-unsupported", "open", "existing empty SQLite is not a ProjectDatabase");
    }
    // Never persist WAL mode or acquire a write transaction until an existing
    // file has proved that it is the exact Host-owned ProjectDatabase format.
    if (!isEmpty) validateExistingOperationalSchemaForWriter(connection);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    let created = false;
    try {
      if (isEmpty) {
        const appliedAt = new Date().toISOString();
        const generation = randomUUID();
        const migration = migrateSqliteDatabase({
          database: db,
          ledgerTable: "storage_migrations",
          catalog: recordSqliteMigrations({ storageGeneration: generation, appliedAt }),
          expectedFromVersion: 0,
          bootstrapping: true,
          acceptConcurrentBootstrapCurrent: true,
          appliedAt: () => appliedAt,
          validateCurrent: () => validateCurrentRecordDomain(connection),
        });
        created = migration.status === "bootstrapped";
      } else {
        // Revalidate under the write lock so a concurrent schema change cannot
        // cross the admission boundary between the read probe and this writer.
        validateExistingOperationalSchemaForWriter(connection);
      }
    } catch (cause) {
      if (cause instanceof SqliteMigrationKernelFailure) {
        throw sqliteError("record-database-invalid", "migrate", cause.message, cause);
      }
      throw cause;
    }
    // Both the creator and every concurrent loser validate the exact committed
    // schema + migration receipt before the connection becomes a writer.
    validateExactSchema(connection);
    if (created) db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    db.setAuthorizer(writableAuthorizer());
    return connection;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

export function openRecordReader(path: string): RecordDatabase {
  assertRecordSqliteRuntime();
  assertLegacyRecordAbsent(path);
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
    validateExactSchema(connection);
    return connection;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

export function openRecordMaintenance(
  path: string,
  options?: RecordMaintenanceOpenOptions,
): RecordDatabase {
  assertRecordSqliteRuntime();
  assertLegacyRecordAbsent(path);
  if (!pathExists(path)) {
    throw sqliteError("record-database-invalid", "open-maintenance", "ProjectDatabase does not exist");
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw sqliteError("record-schema-unsupported", "open-maintenance", "ProjectDatabase path is not a regular Host-owned file");
  }
  const db = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    readBigInts: true,
    timeout: 5_000,
  });
  const connection: RecordDatabase = { db, path, mode: "maintenance", statements: new Map() };
  try {
    configureCommon(db);
    db.setAuthorizer(writableAuthorizer(options));
    return connection;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

export function closeRecordDatabase(connection: RecordDatabase): void {
  // node:sqlite finalizes every cached statement when its owning connection is
  // closed; StatementSync intentionally exposes no independent finalize API.
  connection.statements.clear();
  if (connection.db.isOpen) connection.db.close();
}

export function checkpointRecordDatabase(connection: RecordDatabase): void {
  if (connection.mode !== "writer" || !connection.db.isOpen) {
    throw sqliteError("record-database-invalid", "checkpoint", "Record checkpoint requires an open writer");
  }
  connection.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}
