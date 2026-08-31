import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { constants, DatabaseSync, type SQLOutputValue, type StatementSync } from "node:sqlite";
import {
  RECORD_SQLITE_BASELINE_FINGERPRINT,
  RECORD_SQLITE_BASELINE_SQL,
  RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL,
} from "./schema.ts";
import { sqliteError } from "./errors.ts";
import { RECORD_SQLITE_FORMAT, RECORD_SQLITE_STORAGE_REVISION } from "./types.ts";
import { currentProcessOwnerIdentity, exactProcessState } from "../../coordination/platform/node-process-identity.ts";

const MINIMUM_NODE = [24, 15, 0] as const;
const MINIMUM_IMMUTABLE_READER_NODE = [24, 10, 0] as const;
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

function assertMinimumNode(minimum: readonly number[], capability: string): void {
  const actual = nodeVersionTuple();
  for (let index = 0; index < minimum.length; index += 1) {
    const value = actual[index] ?? 0;
    const required = minimum[index];
    if (value > required) return;
    if (value < required) {
      throw sqliteError(
        "record-runtime-unsupported",
        "open",
        `${capability} requires Node ${minimum.join(".")} or newer; received ${process.versions.node}`,
      );
    }
  }
}

export function assertRecordSqliteRuntime(): void {
  assertMinimumNode(MINIMUM_NODE, "Project Record SQLite");
}

function assertImmutableRecordReaderRuntime(): void {
  // The 24.15 floor protects mutable WAL ownership. An already-admitted,
  // immutable generation only needs the defensive read APIs introduced in
  // 24.10 and never opens a writer or checkpoints WAL.
  assertMinimumNode(MINIMUM_IMMUTABLE_READER_NODE, "Immutable Project Record reader");
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

function assertLegacyCoordinationEntriesAbsent(path: string): void {
  const parent = dirname(path);
  if (basename(path) !== "record.sqlite" || basename(parent) !== ".niceeval") return;
  for (const name of ["locks", "sessions", "teardowns", "shared-state-leases", "sandboxes"] as const) {
    const legacy = join(parent, name);
    if (!pathExists(legacy)) continue;
    const metadata = lstatSync(legacy);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || readdirSync(legacy).length > 0) {
      throw sqliteError("record-schema-unsupported", "locate", `legacy ${name}/ entries block ProjectDatabase mutation: ${legacy}`);
    }
  }
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
  db.exec("PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA mmap_size=0; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA recursive_triggers=ON;");
}

function requireSecureDelete(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA secure_delete").get() as Record<string, SQLOutputValue> | undefined;
  if (row === undefined || decodeInteger(row.secure_delete, "secure_delete") !== 1) {
    throw sqliteError("record-database-invalid", "open", "ProjectDatabase requires PRAGMA secure_delete=ON");
  }
}

function writableAuthorizer() {
  return (action: number, arg1: string | null, arg2: string | null): number => {
    if (action === constants.SQLITE_ATTACH) return constants.SQLITE_DENY;
    if (action === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
    if (action === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
    if (action === constants.SQLITE_PRAGMA) {
      const permitted = arg1 === "busy_timeout" || arg1 === "quick_check" || arg1 === "foreign_key_check" || arg1 === "wal_checkpoint" || arg1 === "secure_delete";
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
  if (action === constants.SQLITE_PRAGMA && arg1 !== "quick_check" && arg1 !== "foreign_key_check" && arg1 !== "secure_delete") return constants.SQLITE_DENY;
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
    db.exec(sql ?? RECORD_SQLITE_BASELINE_SQL);
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
    metadata = connection.db.prepare(`SELECT format,storage_revision,storage_generation,schema_fingerprint,barrier_state
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
  if (decodeText(metadata.schema_fingerprint, "record_metadata.schema_fingerprint") !== RECORD_SQLITE_BASELINE_FINGERPRINT) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "ProjectDatabase baseline fingerprint is unsupported");
  }
  const barrierState = decodeText(metadata.barrier_state, "record_metadata.barrier_state");
  if (barrierState !== "open" && barrierState !== "draining" && barrierState !== "portable") {
    throw sqliteError("record-database-invalid", "validate-schema", "ProjectDatabase barrier state is invalid");
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
  requireSecureDelete(connection.db);
  validateCurrentRecordDomain(connection);
}

export function openRecordWriter(path: string, busyTimeoutMs = 5_000): RecordDatabase {
  assertRecordSqliteRuntime();
  assertLegacyRecordAbsent(path);
  assertLegacyCoordinationEntriesAbsent(path);
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
    if (!isEmpty) {
      validateExistingOperationalSchemaForWriter(connection);
      requireSecureDelete(db);
    } else {
      db.exec("PRAGMA secure_delete=ON");
      requireSecureDelete(db);
    }
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    let created = false;
    try {
      if (isEmpty) {
        const appliedAt = new Date().toISOString();
        const generation = randomUUID();
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec(RECORD_SQLITE_BASELINE_SQL);
          db.prepare(`INSERT INTO record_metadata(singleton,format,storage_revision,storage_generation,schema_fingerprint,
            created_at,barrier_state,portable_generation,portable_revision,portable_gate_id,record_payload,record_digest)
            VALUES (1,?,?,?,?,?,'open',NULL,NULL,NULL,NULL,NULL)`).run(
            RECORD_SQLITE_FORMAT,
            RECORD_SQLITE_STORAGE_REVISION,
            generation,
            RECORD_SQLITE_BASELINE_FINGERPRINT,
            appliedAt,
          );
          db.prepare(`INSERT INTO coordination_state(singleton,revision,operational_generation,next_writer_sequence)
            VALUES (1,0,?,1)`).run(generation);
          db.exec("COMMIT");
          created = true;
        } catch (cause) {
          if (db.isTransaction) db.exec("ROLLBACK");
          throw cause;
        }
      } else {
        // Revalidate under the write lock so a concurrent schema change cannot
        // cross the admission boundary between the read probe and this writer.
        validateExistingOperationalSchemaForWriter(connection);
      }
    } catch (cause) { throw cause; }
    // Both the creator and every concurrent loser validate the exact committed
    // bootstrap identity before the connection becomes a writer.
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
  return openRecordReaderAfterRuntimeAdmission(path);
}

export function openImmutableRecordReader(path: string): RecordDatabase {
  assertImmutableRecordReaderRuntime();
  return openRecordReaderAfterRuntimeAdmission(path);
}

function openRecordReaderAfterRuntimeAdmission(path: string): RecordDatabase {
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
    requireSecureDelete(db);
    // The main database is opened read-only. These two private TEMP tables are
    // the only writable reader state and are required for bounded Seal sort.
    db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
    db.setAuthorizer(readerAuthorizer);
    validateExactSchema(connection);
    const integrity = db.prepare("PRAGMA quick_check").get() as Record<string, SQLOutputValue> | undefined;
    if (integrity === undefined || decodeText(integrity.quick_check, "quick_check") !== "ok") {
      throw sqliteError("record-database-invalid", "open", "ProjectDatabase integrity check failed");
    }
    const foreignKeyViolation = db.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyViolation !== undefined) {
      throw sqliteError("record-database-invalid", "open", "ProjectDatabase foreign key closure is invalid");
    }
    return connection;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

export function openRecordMaintenance(path: string): RecordDatabase {
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
    db.setAuthorizer(writableAuthorizer());
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

/** Starts a new operational generation before coordination services acquire it. */
export function reopenProjectDatabase(path: string): void {
  const connection = openRecordWriter(path);
  try {
    connection.db.exec("BEGIN IMMEDIATE");
    const row = connection.db.prepare("SELECT barrier_state FROM record_metadata WHERE singleton=1")
      .get() as Record<string, SQLOutputValue> | undefined;
    if (row === undefined || decodeText(row.barrier_state, "barrier_state") === "draining") {
      throw sqliteError("record-command-conflict", "reopen", "ProjectDatabase portable gate is draining");
    }
    if (decodeText(row.barrier_state, "barrier_state") === "portable") {
      const generation = randomUUID();
      connection.db.prepare(`UPDATE record_metadata SET barrier_state='open',storage_generation=?,portable_generation=NULL,
        portable_revision=NULL,portable_gate_id=NULL WHERE singleton=1 AND barrier_state='portable'`).run(generation);
      connection.db.prepare("UPDATE coordination_state SET operational_generation=?,revision=revision+1 WHERE singleton=1")
        .run(generation);
    }
    connection.db.exec("COMMIT");
  } catch (cause) {
    if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
    throw cause;
  } finally {
    closeRecordDatabase(connection);
  }
}

/**
 * Closes the project-wide writer admission and proves that the canonical file
 * itself is portable. The first transaction deliberately persists draining;
 * any later failure therefore remains fail-closed for explicit recovery.
 */
export function makeProjectDatabasePortable(path: string): boolean {
  const gateId = randomUUID();
  const gateNonce = randomUUID();
  const gateOwner = currentProcessOwnerIdentity(gateId);
  const admissionDrainDeadline = Date.now() + 5_000;
  const waitCell = new Int32Array(new SharedArrayBuffer(4));
  let connection = openRecordWriter(path);
  try {
    connection.db.exec("BEGIN IMMEDIATE");
    const metadata = connection.db.prepare("SELECT barrier_state,portable_gate_id FROM record_metadata WHERE singleton=1")
      .get() as Record<string, SQLOutputValue> | undefined;
    if (metadata === undefined) {
      throw sqliteError("record-database-invalid", "portable-gate", "ProjectDatabase barrier is missing");
    }
    const barrierState = decodeText(metadata.barrier_state, "barrier_state");
    if (barrierState === "portable") {
      connection.db.exec("COMMIT");
      return true;
    }
    if (barrierState === "draining") {
      const previous = connection.db.prepare(`SELECT barrier_id,barrier_nonce,barrier_host,barrier_pid,
        barrier_boot_id,barrier_process_start FROM coordination_state WHERE singleton=1`).get() as
        | Record<string, SQLOutputValue>
        | undefined;
      if (previous === undefined || previous.barrier_id === null || previous.barrier_nonce === null) {
        throw sqliteError("record-database-invalid", "portable-gate", "draining portable gate has no fenced owner");
      }
      const previousOwner = {
        ownerId: decodeText(previous.barrier_id, "barrier_id"),
        host: decodeText(previous.barrier_host, "barrier_host"),
        pid: decodeInteger(previous.barrier_pid, "barrier_pid"),
        bootId: decodeText(previous.barrier_boot_id, "barrier_boot_id"),
        processStart: decodeText(previous.barrier_process_start, "barrier_process_start"),
      };
      const sameProcess = previousOwner.host === gateOwner.host && previousOwner.pid === gateOwner.pid &&
        previousOwner.bootId === gateOwner.bootId && previousOwner.processStart === gateOwner.processStart;
      if (!sameProcess && exactProcessState(previousOwner) !== "dead") {
        throw sqliteError("record-command-conflict", "portable-gate", "draining portable gate owner is not proven dead");
      }
      const fenced = connection.db.prepare(`UPDATE coordination_state SET barrier_id=?,barrier_nonce=?,barrier_host=?,
        barrier_pid=?,barrier_boot_id=?,barrier_process_start=?,barrier_deadline=?,barrier_requested_at=?,
        barrier_lease_expires_at=?,barrier_status='active',barrier_active_at=?,revision=revision+1
        WHERE singleton=1 AND barrier_id=? AND barrier_nonce=?`).run(
          gateId, gateNonce, gateOwner.host, gateOwner.pid, gateOwner.bootId, gateOwner.processStart,
          admissionDrainDeadline, Date.now(), admissionDrainDeadline, Date.now(),
          previous.barrier_id, previous.barrier_nonce,
        );
      const metadataFenced = connection.db.prepare(`UPDATE record_metadata SET portable_gate_id=?
        WHERE singleton=1 AND barrier_state='draining' AND portable_gate_id=?`).run(gateId, metadata.portable_gate_id);
      if (Number(fenced.changes) !== 1 || Number(metadataFenced.changes) !== 1) {
        throw sqliteError("record-command-conflict", "portable-gate", "draining portable gate changed during recovery");
      }
    } else if (barrierState === "open") {
      const entered = recordStatement(connection, `UPDATE record_metadata SET barrier_state='draining',portable_gate_id=?
        WHERE singleton=1 AND barrier_state='open' AND portable_gate_id IS NULL`).run(gateId);
      const established = connection.db.prepare(`UPDATE coordination_state SET barrier_id=?,barrier_nonce=?,barrier_host=?,
        barrier_pid=?,barrier_boot_id=?,barrier_process_start=?,barrier_deadline=?,barrier_requested_at=?,
        barrier_lease_expires_at=?,barrier_status='active',barrier_active_at=?,revision=revision+1
        WHERE singleton=1 AND barrier_id IS NULL`).run(
          gateId, gateNonce, gateOwner.host, gateOwner.pid, gateOwner.bootId, gateOwner.processStart,
          admissionDrainDeadline, Date.now(), admissionDrainDeadline, Date.now(),
        );
      if (Number(entered.changes) !== 1 || Number(established.changes) !== 1) {
        throw sqliteError("record-command-conflict", "portable-gate", "ProjectDatabase barrier is not open");
      }
    } else {
      throw sqliteError("record-database-invalid", "portable-gate", "ProjectDatabase barrier state is invalid");
    }
    const admittedActive = connection.db.prepare(`SELECT
      (SELECT count(*) FROM run_resources WHERE terminal_state IS NULL)+
      (SELECT count(*) FROM invocation_sessions WHERE state IN ('active','recovering'))+
      (SELECT count(*) FROM case_locks)+
      (SELECT count(*) FROM teardown_obligations)+
      (SELECT count(*) FROM shared_state_generations s WHERE state_kind!='free' AND generation=(SELECT max(generation) FROM shared_state_generations WHERE state_key=s.state_key))+
      (SELECT count(*) FROM kept_sandbox_operation_leases) AS count`)
      .get() as Record<string, SQLOutputValue>;
    if (decodeInteger(admittedActive.count, "active_runs") !== 0) {
      connection.db.prepare(`UPDATE record_metadata SET barrier_state='open',portable_gate_id=NULL
        WHERE singleton=1 AND barrier_state='draining' AND portable_gate_id=?`).run(gateId);
      connection.db.prepare(`UPDATE coordination_state SET barrier_id=NULL,barrier_nonce=NULL,barrier_host=NULL,
        barrier_pid=NULL,barrier_boot_id=NULL,barrier_process_start=NULL,barrier_deadline=NULL,
        barrier_requested_at=NULL,barrier_lease_expires_at=NULL,barrier_status=NULL,barrier_active_at=NULL,
        revision=revision+1 WHERE singleton=1 AND barrier_id=? AND barrier_nonce=?`).run(gateId, gateNonce);
      connection.db.exec("COMMIT");
      return false;
    }
    // The draining barrier rejects new tickets. Queued-but-not-admitted work
    // has no writer authority and is canceled; an already admitted writer or
    // barrier must release its exact identity before the gate continues.
    connection.db.prepare("DELETE FROM coordination_tickets").run();
    connection.db.exec("COMMIT");

    while (true) {
      const coordination = connection.db.prepare(`SELECT
        (writer_ticket_id IS NOT NULL OR (barrier_id IS NOT NULL AND barrier_id!=?)) AS active
        FROM coordination_state WHERE singleton=1`).get(gateId) as Record<string, SQLOutputValue> | undefined;
      if (coordination === undefined) {
        throw sqliteError("record-database-invalid", "portable-gate", "coordination singleton is missing");
      }
      if (decodeInteger(coordination.active, "portable_admission") === 0) break;
      if (Date.now() >= admissionDrainDeadline) {
        throw sqliteError("record-write-busy", "portable-gate", "admitted writer did not drain before the portable deadline");
      }
      Atomics.wait(waitCell, 0, 0, 15);
    }

    connection.db.exec("BEGIN IMMEDIATE");
    const active = connection.db.prepare("SELECT count(*) AS count FROM run_resources WHERE terminal_state IS NULL")
      .get() as Record<string, SQLOutputValue>;
    if (decodeInteger(active.count, "active_runs") !== 0) {
      throw sqliteError("record-command-conflict", "portable-gate", "active Run owners prevent portable close");
    }
    const invocationWork = connection.db.prepare(`SELECT
      (SELECT count(*) FROM invocation_sessions WHERE state IN ('active','recovering'))+
      (SELECT count(*) FROM invocation_session_queued_attempts)+
      (SELECT count(*) FROM case_locks) AS count`).get() as Record<string, SQLOutputValue>;
    if (decodeInteger(invocationWork.count, "invocation_work") !== 0) {
      throw sqliteError("record-command-conflict", "portable-gate", "invocation coordination work prevents portable close");
    }
    connection.db.exec(`DELETE FROM runs WHERE status!='sealed' AND NOT EXISTS
      (SELECT 1 FROM attempt_publications WHERE origin_run_id=runs.run_id); DELETE FROM coordination_tickets;`);
    connection.db.prepare(`UPDATE coordination_state SET revision=revision+1,next_writer_sequence=1,
      writer_ticket_id=NULL,writer_sequence=NULL,writer_host=NULL,writer_pid=NULL,writer_deadline=NULL,
      writer_boot_id=NULL,writer_process_start=NULL,
      writer_enqueued_at=NULL,writer_nonce=NULL,writer_admitted_at=NULL,writer_lease_expires_at=NULL,
      barrier_id=NULL,barrier_nonce=NULL,barrier_host=NULL,barrier_pid=NULL,barrier_deadline=NULL,
      barrier_boot_id=NULL,barrier_process_start=NULL,
      barrier_requested_at=NULL,barrier_lease_expires_at=NULL,barrier_status=NULL,barrier_active_at=NULL
      WHERE singleton=1`).run();
    const clock = connection.db.prepare("SELECT revision FROM run_publication_clock WHERE singleton=1")
      .get() as Record<string, SQLOutputValue>;
    const generation = connection.db.prepare("SELECT storage_generation FROM record_metadata WHERE singleton=1")
      .get() as Record<string, SQLOutputValue>;
    connection.db.prepare(`UPDATE record_metadata SET barrier_state='portable',portable_generation=?,portable_revision=?
      WHERE singleton=1 AND barrier_state='draining' AND portable_gate_id=?`).run(
      decodeText(generation.storage_generation, "storage_generation"),
      decodeInteger(clock.revision, "publication_revision"),
      gateId,
    );
    connection.db.exec("COMMIT");
    checkpointRecordDatabase(connection);
  } catch (cause) {
    if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
    throw cause;
  } finally {
    closeRecordDatabase(connection);
  }

  connection = openRecordReader(path);
  try {
    const state = connection.db.prepare(`SELECT barrier_state,portable_generation,portable_revision,storage_generation
      FROM record_metadata WHERE singleton=1`).get() as Record<string, SQLOutputValue> | undefined;
    const active = connection.db.prepare(`SELECT
      (SELECT count(*) FROM run_resources WHERE terminal_state IS NULL)+
      (SELECT count(*) FROM runs r WHERE status!='sealed' AND
        (EXISTS (SELECT 1 FROM attempts a WHERE a.origin_run_id=r.run_id AND a.publication_state!='published') OR
         EXISTS (SELECT 1 FROM run_resources rr WHERE rr.run_id=r.run_id AND rr.terminal_state IS NULL)))+
      (SELECT count(*) FROM coordination_tickets) AS count`).get() as Record<string, SQLOutputValue>;
    const invocationWork = connection.db.prepare(`SELECT
      (SELECT count(*) FROM invocation_sessions WHERE state IN ('active','recovering'))+
      (SELECT count(*) FROM invocation_session_queued_attempts)+
      (SELECT count(*) FROM case_locks) AS count`).get() as Record<string, SQLOutputValue>;
    const registryWork = connection.db.prepare(`SELECT
      (SELECT count(*) FROM teardown_obligations)+
      (SELECT count(*) FROM shared_state_generations s WHERE state_kind!='free' AND generation=(SELECT max(generation) FROM shared_state_generations WHERE state_key=s.state_key))+
      (SELECT count(*) FROM kept_sandbox_operation_leases) AS count`).get() as Record<string, SQLOutputValue>;
    const coordination = connection.db.prepare(`SELECT writer_ticket_id,barrier_id FROM coordination_state WHERE singleton=1`)
      .get() as Record<string, SQLOutputValue> | undefined;
    const clock = connection.db.prepare("SELECT revision FROM run_publication_clock WHERE singleton=1")
      .get() as Record<string, SQLOutputValue> | undefined;
    if (state === undefined || decodeText(state.barrier_state, "barrier_state") !== "portable" ||
      decodeText(state.portable_generation, "portable_generation") !== decodeText(state.storage_generation, "storage_generation") ||
      clock === undefined || decodeInteger(state.portable_revision, "portable_revision") !== decodeInteger(clock.revision, "publication_revision") ||
      decodeInteger(active.count, "portable_work") !== 0 ||
      decodeInteger(invocationWork.count, "portable_invocation_work") !== 0 ||
      decodeInteger(registryWork.count, "portable_registry_work") !== 0 ||
      coordination === undefined || coordination.writer_ticket_id !== null || coordination.barrier_id !== null) {
      throw sqliteError("record-database-invalid", "portable-gate", "hostile reopen did not prove a portable ProjectDatabase");
    }
  } finally {
    closeRecordDatabase(connection);
  }
  return true;
}

/** Invocation-boundary portable operation; terminal session projections remain durable. */
export const finalizeInvocationPortable = makeProjectDatabasePortable;
