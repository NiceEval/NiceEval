import { randomUUID } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { constants, DatabaseSync, type SQLOutputValue, type StatementSync } from "node:sqlite";
import { RECORD_SQLITE_BASELINE_SQL, RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL } from "./schema.ts";
import { sqliteError } from "./errors.ts";
import { RECORD_SQLITE_FORMAT } from "./types.ts";
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

/** Mandatory-row boundary for aggregate and singleton queries. */
export function requiredRecordRow(row: Record<string, SQLOutputValue> | undefined): Record<string, SQLOutputValue> {
  if (row === undefined)
    throw sqliteError("record-database-invalid", "decode-row", "SQLite query did not return a row");
  return row;
}

function currentStatement(db: DatabaseSync, sql: string): StatementSync {
  return db.prepare(sql);
}

function currentExec(db: DatabaseSync, sql: string): void {
  db.exec(sql);
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
  if (recordStorageRoot.length === 0)
    throw sqliteError("record-database-invalid", "locate", "Record storage root is empty");
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

function legacyRecordRecovery(): string {
  return (
    "No automatic migration is available. Keep the original project and its .niceeval directory " +
    "for inspection with the original NiceEval version. Stop any old NiceEval processes before " +
    "copying project files. To run with this version, use a separate project copy without .niceeval " +
    "and rerun the experiment there. Do not delete individual legacy locks or records."
  );
}

/** Record/0.13 is never opened or silently migrated into ProjectDatabase. */
function assertLegacyRecordAbsent(path: string): void {
  const legacyPath = legacyRecordSqlitePath(path);
  if (legacyPath === undefined) return;
  if (!pathExists(legacyPath)) return;
  throw sqliteError(
    "record-schema-unsupported",
    "locate",
    `legacy Record/0.13 database is unsupported and blocks ProjectDatabase: ${legacyPath}. ${legacyRecordRecovery()}`,
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
      throw sqliteError(
        "record-schema-unsupported",
        "locate",
        `legacy ${name}/ entries block ProjectDatabase mutation: ${legacy}. ${legacyRecordRecovery()}`,
      );
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
    return { state: "unsupported", format: "niceeval.record/0.13.x" };
  }
  if (!pathExists(path)) return { state: "current", exists: false };
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) return { state: "foreign" };

  let connection: RecordDatabase | undefined;
  try {
    connection = openRecordMaintenance(path);
    const currentTable = connection.db
      .prepare(`SELECT count(*) AS count FROM sqlite_schema
      WHERE type='table' AND name='ne19_record_metadata'`)
      .get() as Record<string, SQLOutputValue>;
    const legacy018Table = connection.db
      .prepare(`SELECT count(*) AS count FROM sqlite_schema
      WHERE type='table' AND name='ne18_record_metadata'`)
      .get() as Record<string, SQLOutputValue>;
    const legacy017Table = connection.db
      .prepare(`SELECT count(*) AS count FROM sqlite_schema
      WHERE type='table' AND name='ne_record_metadata'`)
      .get() as Record<string, SQLOutputValue>;
    const legacyTable = connection.db
      .prepare(`SELECT count(*) AS count FROM sqlite_schema
      WHERE type='table' AND name='record_metadata'`)
      .get() as Record<string, SQLOutputValue>;
    const hasCurrent = decodeInteger(currentTable.count, "sqlite_schema.record_metadata") === 1;
    const hasLegacy018 = decodeInteger(legacy018Table.count, "sqlite_schema.record_metadata") === 1;
    const hasLegacy017 = decodeInteger(legacy017Table.count, "sqlite_schema.record_metadata") === 1;
    const hasLegacy = decodeInteger(legacyTable.count, "sqlite_schema.record_metadata") === 1;
    if (Number(hasCurrent) + Number(hasLegacy018) + Number(hasLegacy017) + Number(hasLegacy) !== 1) {
      return { state: "foreign" };
    }
    function recordMetadataTable(): string {
      if (hasCurrent) return "ne19_record_metadata";
      if (hasLegacy018) return "ne18_record_metadata";
      if (hasLegacy017) return "ne_record_metadata";
      return "record_metadata";
    }
    const metadataTable = recordMetadataTable();
    let row: Record<string, SQLOutputValue> | undefined;
    try {
      row = connection.db
        .prepare(`SELECT format
        FROM ${metadataTable} WHERE singleton=1`)
        .get() as Record<string, SQLOutputValue> | undefined;
    } catch {
      return { state: "foreign" };
    }
    if (row === undefined || typeof row.format !== "string") return { state: "foreign" };
    if (row.format !== RECORD_SQLITE_FORMAT) {
      return { state: "unsupported", format: row.format };
    }
    try {
      validateExactSchema(connection);
      return { state: "current", exists: true };
    } catch {
      return { state: "unsupported", format: row.format };
    }
  } catch {
    return { state: "foreign" };
  } finally {
    if (connection !== undefined) closeRecordDatabase(connection);
  }
}

function configureCommon(db: DatabaseSync): void {
  db.enableLoadExtension(false);
  db.enableDefensive(true);
  db.exec(
    "PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA mmap_size=0; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA recursive_triggers=ON;",
  );
}

function requireSecureDelete(db: DatabaseSync): void {
  const row = currentStatement(db, "PRAGMA secure_delete").get() as Record<string, SQLOutputValue> | undefined;
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
      const permitted =
        arg1 === "busy_timeout" ||
        arg1 === "quick_check" ||
        arg1 === "foreign_key_check" ||
        arg1 === "wal_checkpoint" ||
        arg1 === "secure_delete";
      if (!permitted) return constants.SQLITE_DENY;
    }
    return constants.SQLITE_OK;
  };
}

function readerAuthorizer(action: number, arg1: string | null, arg2: string | null, dbName: string | null): number {
  if (dbName === "temp") {
    const preparedTable = arg1 === "niceeval_prepared_seal_raw" || arg1 === "niceeval_prepared_seal_ordered";
    return preparedTable &&
      (action === constants.SQLITE_READ || action === constants.SQLITE_INSERT || action === constants.SQLITE_DELETE)
      ? constants.SQLITE_OK
      : constants.SQLITE_DENY;
  }
  if (dbName !== null && dbName !== "main") return constants.SQLITE_DENY;
  if (READ_DENIED.has(action)) return constants.SQLITE_DENY;
  if (
    action === constants.SQLITE_PRAGMA &&
    arg1 !== "quick_check" &&
    arg1 !== "foreign_key_check" &&
    arg1 !== "secure_delete"
  )
    return constants.SQLITE_DENY;
  if (action === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
  return constants.SQLITE_OK;
}

function schemaRows(db: DatabaseSync): readonly string[] {
  const rows = currentStatement(
    db,
    `SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type, name LIMIT 257`,
  ).all();
  if (rows.length > 256)
    throw sqliteError(
      "record-database-invalid",
      "validate-schema",
      "database schema exceeds the bounded object allowlist",
    );
  return rows.map((row) =>
    JSON.stringify([
      decodeText(row.type, "sqlite_schema.type"),
      decodeText(row.name, "sqlite_schema.name"),
      decodeText(row.tbl_name, "sqlite_schema.tbl_name"),
      row.sql === null ? null : normalizeSql(decodeText(row.sql, "sqlite_schema.sql")),
    ]),
  );
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/gu, " ")
    .replace(/\s*([(),])\s*/gu, "$1")
    .trim()
    .replace(/;$/u, "");
}

const canonicalSchemaRows = new Map<string, readonly string[]>();

function expectedSchemaRows(sql?: string): readonly string[] {
  const key = sql ?? "bootstrap";
  const cached = canonicalSchemaRows.get(key);
  if (cached !== undefined) return cached;
  const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true, readBigInts: true });
  try {
    db.exec(sql ?? RECORD_SQLITE_BASELINE_SQL);
    const rows = schemaRows(db);
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
    throw sqliteError(
      "record-schema-unsupported",
      "validate-schema",
      "database objects do not match the exact Project Record schema allowlist",
    );
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

function validateCurrentRecordDomain(connection: RecordDatabase): void {
  let metadata: Record<string, SQLOutputValue> | undefined;
  try {
    metadata = currentStatement(
      connection.db,
      `SELECT format,storage_generation,barrier_state
      FROM ne19_record_metadata WHERE singleton=1`,
    ).get() as Record<string, SQLOutputValue> | undefined;
  } catch (cause) {
    throw sqliteError(
      "record-schema-unsupported",
      "validate-schema",
      "This Record was written by an older version of NiceEval. Rerun the experiment or remove this Record storage.",
      cause,
    );
  }
  if (metadata === undefined) {
    throw sqliteError("record-schema-unsupported", "validate-schema", "ProjectDatabase identity is missing");
  }
  if (decodeText(metadata.format, "record_metadata.format") !== RECORD_SQLITE_FORMAT) {
    throw sqliteError(
      "record-schema-unsupported",
      "validate-schema",
      "This Record was written by an older version of NiceEval. Rerun the experiment or remove this Record storage.",
    );
  }
  const barrierState = decodeText(metadata.barrier_state, "record_metadata.barrier_state");
  if (barrierState !== "open" && barrierState !== "draining" && barrierState !== "portable") {
    throw sqliteError("record-database-invalid", "validate-schema", "ProjectDatabase barrier state is invalid");
  }
  validateSchemaObjects(connection);
  const coordination = currentStatement(
    connection.db,
    `SELECT revision,operational_generation,next_writer_sequence,
    writer_ticket_id,barrier_id FROM ne19_coordination_state WHERE singleton=1`,
  ).get() as Record<string, SQLOutputValue> | undefined;
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

export function validateExactSchema(connection: RecordDatabase): void {
  // Metadata and coordination generations must come from one snapshot even
  // when another Invocation reopens the portable database between queries.
  const ownsTransaction = !connection.db.isTransaction;
  if (ownsTransaction) connection.db.exec("BEGIN");
  try {
    requireSecureDelete(connection.db);
    validateCurrentRecordDomain(connection);
    if (ownsTransaction) connection.db.exec("COMMIT");
  } catch (cause) {
    if (ownsTransaction && connection.db.isTransaction) connection.db.exec("ROLLBACK");
    throw cause;
  }
}

/**
 * Publish the initial file only after the complete SQLite bootstrap commits.
 * The temporary path is on the same filesystem. A no-replace link lets
 * concurrent creators converge on the first committed file.
 */
function bootstrapRecordDatabase(path: string): void {
  const directory = mkdtempSync(join(dirname(path), ".record-bootstrap-"));
  const candidate = join(directory, "record.sqlite");
  try {
    const db = new DatabaseSync(candidate, {
      allowExtension: false,
      defensive: true,
      enableForeignKeyConstraints: true,
      readBigInts: true,
    });
    try {
      configureCommon(db);
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      requireSecureDelete(db);
      const generation = randomUUID();
      db.exec("BEGIN IMMEDIATE");
      db.exec(RECORD_SQLITE_BASELINE_SQL);
      currentStatement(
        db,
        `INSERT INTO ne19_record_metadata(singleton,format,storage_generation,
        created_at,barrier_state,portable_generation,portable_revision,portable_gate_id,record_payload,record_digest)
        VALUES (1,?,?,?,'open',NULL,NULL,NULL,NULL,NULL)`,
      ).run(RECORD_SQLITE_FORMAT, generation, new Date().toISOString());
      currentStatement(
        db,
        `INSERT INTO ne19_coordination_state(singleton,revision,operational_generation,next_writer_sequence)
        VALUES (1,0,?,1)`,
      ).run(generation);
      db.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE);");
    } finally {
      db.close();
    }
    try {
      linkSync(candidate, path);
    } catch (cause) {
      if (!(cause instanceof Error) || Reflect.get(cause, "code") !== "EEXIST") throw cause;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Decides "written by an older NiceEval" without creating WAL or shared-memory files: a WAL-mode
 * file opened even read-only gets -shm/-wal siblings, so the probe opens it immutable. It only
 * rejects on positive evidence (a legacy metadata namespace or a different format); anything else,
 * including an unreadable or concurrently written file, is left to the normal open to judge.
 */
function assertNotPredecessorRecord(path: string): void {
  if (!pathExists(path)) return;
  let verdict: "older" | "undecided" = "undecided";
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true, defensive: true });
    const names = new Set(
      (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    );
    if (names.has("ne19_record_metadata")) {
      const row = db.prepare("SELECT format FROM ne19_record_metadata WHERE singleton=1").get() as
        | { format?: unknown }
        | undefined;
      if (typeof row?.format === "string" && row.format !== RECORD_SQLITE_FORMAT) verdict = "older";
    } else if (["ne18_record_metadata", "ne_record_metadata", "record_metadata"].some((name) => names.has(name))) {
      verdict = "older";
    }
  } catch {
    verdict = "undecided";
  } finally {
    if (db?.isOpen) db.close();
  }
  if (verdict === "older") {
    throw sqliteError(
      "record-schema-unsupported",
      "validate-schema",
      "This Record was written by an older version of NiceEval. Rerun the experiment or remove this Record storage.",
    );
  }
}

export function openRecordWriter(path: string, busyTimeoutMs = 5_000): RecordDatabase {
  assertRecordSqliteRuntime();
  assertLegacyRecordAbsent(path);
  assertLegacyCoordinationEntriesAbsent(path);
  if (!pathExists(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    bootstrapRecordDatabase(path);
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw sqliteError("record-schema-unsupported", "open", "ProjectDatabase path is not a regular Host-owned file");
  }
  assertNotPredecessorRecord(path);
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
    // Only a fully committed, exact ProjectDatabase may be opened for writes.
    validateExactSchema(connection);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.setAuthorizer(writableAuthorizer());
    return connection;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

/** Host admission path: reject legacy coordination before any in-place migration mutation. */
export async function openHostOwnedRecordWriter(path: string, busyTimeoutMs = 5_000): Promise<RecordDatabase> {
  assertRecordSqliteRuntime();
  assertLegacyRecordAbsent(path);
  assertLegacyCoordinationEntriesAbsent(path);
  return openRecordWriter(path, busyTimeoutMs);
}

export function openRecordReader(path: string): RecordDatabase {
  assertRecordSqliteRuntime();
  return openRecordReaderAfterRuntimeAdmission(path);
}

export function openImmutableRecordReader(path: string, snapshotBusyTimeoutMs?: number): RecordDatabase {
  assertImmutableRecordReaderRuntime();
  return openRecordReaderAfterRuntimeAdmission(path, snapshotBusyTimeoutMs);
}

function openRecordReaderAfterRuntimeAdmission(path: string, snapshotBusyTimeoutMs?: number): RecordDatabase {
  assertLegacyRecordAbsent(path);
  assertNotPredecessorRecord(path);
  const db = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    readBigInts: true,
    readOnly: true,
    timeout: snapshotBusyTimeoutMs ?? 0,
  });
  const connection: RecordDatabase = { db, path, mode: "reader", statements: new Map() };
  try {
    configureCommon(db);
    requireSecureDelete(db);
    // The main database is opened read-only. These two private TEMP tables are
    // the only writable reader state and are required for bounded Seal sort.
    db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
    db.setAuthorizer(readerAuthorizer);
    if (snapshotBusyTimeoutMs !== undefined) db.exec("BEGIN");
    validateExactSchema(connection);
    // Full structure and closure validation belongs to import, publication and
    // maintenance. Opening a Host-owned reader must not scan historical payload.
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
    throw sqliteError(
      "record-schema-unsupported",
      "open-maintenance",
      "ProjectDatabase path is not a regular Host-owned file",
    );
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
    reopenProjectDatabaseOnConnection(connection);
    connection.db.exec("COMMIT");
  } catch (cause) {
    if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
    throw cause;
  } finally {
    closeRecordDatabase(connection);
  }
}

/** Reopen and owner admission share the caller's BEGIN IMMEDIATE transaction. */
export function reopenProjectDatabaseOnConnection(connection: RecordDatabase): void {
  const row = currentStatement(
    connection.db,
    `SELECT m.barrier_state,c.barrier_status FROM ne19_record_metadata m
    JOIN ne19_coordination_state c ON c.singleton=m.singleton WHERE m.singleton=1`,
  ).get() as Record<string, SQLOutputValue> | undefined;
  if (
    row === undefined ||
    decodeText(row.barrier_state, "barrier_state") === "draining" ||
    row.barrier_status === "active"
  ) {
    throw sqliteError("record-command-conflict", "reopen", "ProjectDatabase portable gate is draining");
  }
  if (decodeText(row.barrier_state, "barrier_state") === "portable") {
    const generation = randomUUID();
    currentStatement(
      connection.db,
      `UPDATE ne19_record_metadata SET barrier_state='open',storage_generation=?,portable_generation=NULL,
      portable_revision=NULL,portable_gate_id=NULL WHERE singleton=1 AND barrier_state='portable'`,
    ).run(generation);
    currentStatement(
      connection.db,
      "UPDATE ne19_coordination_state SET operational_generation=?,revision=revision+1 WHERE singleton=1",
    ).run(generation);
  }
}

export function clearRecordWriterOnConnection(
  connection: RecordDatabase,
  owner: { readonly ticketId: string; readonly sequence: number; readonly nonce: string },
): void {
  const result = recordStatement(
    connection,
    `UPDATE ne19_coordination_state SET
    writer_ticket_id=NULL,writer_sequence=NULL,writer_host=NULL,writer_pid=NULL,
    writer_boot_id=NULL,writer_process_start=NULL,
    writer_deadline=NULL,writer_enqueued_at=NULL,writer_nonce=NULL,
    writer_admitted_at=NULL,writer_lease_expires_at=NULL,revision=revision+1
    WHERE singleton=1 AND writer_ticket_id=? AND writer_sequence=? AND writer_nonce=?`,
  ).run(owner.ticketId, owner.sequence, owner.nonce);
  if (Number(result.changes) !== 1)
    throw sqliteError("record-database-invalid", "coordination", "writer owner changed while clearing");
}

function reclaimTerminatedWriter(connection: RecordDatabase): boolean {
  const writer = requiredRecordRow(
    recordStatement(
      connection,
      `SELECT writer_ticket_id,writer_sequence,writer_nonce,writer_host,writer_pid,writer_boot_id,
        writer_process_start FROM ne19_coordination_state WHERE singleton=1`,
    ).get(),
  );
  if (writer.writer_ticket_id === null) return true;
  const ticketId = decodeText(writer.writer_ticket_id, "writer_ticket_id");
  if (
    exactProcessState({
      ownerId: ticketId,
      host: decodeText(writer.writer_host, "writer_host"),
      pid: decodeInteger(writer.writer_pid, "writer_pid"),
      bootId: decodeText(writer.writer_boot_id, "writer_boot_id"),
      processStart: decodeText(writer.writer_process_start, "writer_process_start"),
    }) !== "dead"
  )
    return false;
  clearRecordWriterOnConnection(connection, {
    ticketId,
    sequence: decodeInteger(writer.writer_sequence, "writer_sequence"),
    nonce: decodeText(writer.writer_nonce, "writer_nonce"),
  });
  return true;
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
    const metadata = currentStatement(
      connection.db,
      "SELECT barrier_state,portable_gate_id FROM ne19_record_metadata WHERE singleton=1",
    ).get() as Record<string, SQLOutputValue> | undefined;
    if (metadata === undefined) {
      throw sqliteError("record-database-invalid", "portable-gate", "ProjectDatabase barrier is missing");
    }
    const barrierState = decodeText(metadata.barrier_state, "barrier_state");
    if (barrierState === "portable") {
      connection.db.exec("COMMIT");
      return true;
    }
    const admittedActive = currentStatement(
      connection.db,
      `SELECT
      (SELECT count(*) FROM ne19_run_resources WHERE terminal_state IS NULL)+
      (SELECT count(*) FROM ne19_invocation_sessions WHERE state IN ('active','recovering'))+
      (SELECT count(*) FROM ne19_case_locks)+
      (SELECT count(*) FROM ne19_teardown_obligations)+
      (SELECT count(*) FROM ne19_shared_state_generations s WHERE state_kind!='free' AND generation=(SELECT max(generation) FROM ne19_shared_state_generations WHERE state_key=s.state_key)) AS count`,
    ).get() as Record<string, SQLOutputValue>;
    const hasActiveWork = decodeInteger(admittedActive.count, "active_runs") !== 0;
    // Admission and this check share the SQLite write lock. A live or unproven
    // writer keeps the gate open. A dead writer's exact ticket must be cleared
    // before draining, where the schema forbids updates retaining a writer.
    if (barrierState === "open" && (hasActiveWork || !reclaimTerminatedWriter(connection))) {
      connection.db.exec("COMMIT");
      return false;
    }
    if (barrierState === "draining") {
      const previous = currentStatement(
        connection.db,
        `SELECT barrier_id,barrier_nonce,barrier_host,barrier_pid,
        barrier_boot_id,barrier_process_start FROM ne19_coordination_state WHERE singleton=1`,
      ).get() as Record<string, SQLOutputValue> | undefined;
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
      const sameProcess =
        previousOwner.host === gateOwner.host &&
        previousOwner.pid === gateOwner.pid &&
        previousOwner.bootId === gateOwner.bootId &&
        previousOwner.processStart === gateOwner.processStart;
      if (!sameProcess && exactProcessState(previousOwner) !== "dead") {
        throw sqliteError(
          "record-command-conflict",
          "portable-gate",
          "draining portable gate owner is not proven dead",
        );
      }
      const fenced = currentStatement(
        connection.db,
        `UPDATE ne19_coordination_state SET barrier_id=?,barrier_nonce=?,barrier_host=?,
        barrier_pid=?,barrier_boot_id=?,barrier_process_start=?,barrier_deadline=?,barrier_requested_at=?,
        barrier_lease_expires_at=?,barrier_status='active',barrier_active_at=?,revision=revision+1
        WHERE singleton=1 AND barrier_id=? AND barrier_nonce=?`,
      ).run(
        gateId,
        gateNonce,
        gateOwner.host,
        gateOwner.pid,
        gateOwner.bootId,
        gateOwner.processStart,
        admissionDrainDeadline,
        Date.now(),
        admissionDrainDeadline,
        Date.now(),
        previous.barrier_id,
        previous.barrier_nonce,
      );
      const metadataFenced = currentStatement(
        connection.db,
        `UPDATE ne19_record_metadata SET portable_gate_id=?
        WHERE singleton=1 AND barrier_state='draining' AND portable_gate_id=?`,
      ).run(gateId, metadata.portable_gate_id);
      if (Number(fenced.changes) !== 1 || Number(metadataFenced.changes) !== 1) {
        throw sqliteError("record-command-conflict", "portable-gate", "draining portable gate changed during recovery");
      }
    } else if (barrierState === "open") {
      const entered = recordStatement(
        connection,
        `UPDATE ne19_record_metadata SET barrier_state='draining',portable_gate_id=?
        WHERE singleton=1 AND barrier_state='open' AND portable_gate_id IS NULL`,
      ).run(gateId);
      const established = currentStatement(
        connection.db,
        `UPDATE ne19_coordination_state SET barrier_id=?,barrier_nonce=?,barrier_host=?,
        barrier_pid=?,barrier_boot_id=?,barrier_process_start=?,barrier_deadline=?,barrier_requested_at=?,
        barrier_lease_expires_at=?,barrier_status='active',barrier_active_at=?,revision=revision+1
        WHERE singleton=1 AND barrier_id IS NULL`,
      ).run(
        gateId,
        gateNonce,
        gateOwner.host,
        gateOwner.pid,
        gateOwner.bootId,
        gateOwner.processStart,
        admissionDrainDeadline,
        Date.now(),
        admissionDrainDeadline,
        Date.now(),
      );
      if (Number(entered.changes) !== 1 || Number(established.changes) !== 1) {
        throw sqliteError("record-command-conflict", "portable-gate", "ProjectDatabase barrier is not open");
      }
    } else {
      throw sqliteError("record-database-invalid", "portable-gate", "ProjectDatabase barrier state is invalid");
    }
    if (hasActiveWork) {
      currentStatement(
        connection.db,
        `UPDATE ne19_record_metadata SET barrier_state='open',portable_gate_id=NULL
        WHERE singleton=1 AND barrier_state='draining' AND portable_gate_id=?`,
      ).run(gateId);
      currentStatement(
        connection.db,
        `UPDATE ne19_coordination_state SET barrier_id=NULL,barrier_nonce=NULL,barrier_host=NULL,
        barrier_pid=NULL,barrier_boot_id=NULL,barrier_process_start=NULL,barrier_deadline=NULL,
        barrier_requested_at=NULL,barrier_lease_expires_at=NULL,barrier_status=NULL,barrier_active_at=NULL,
        revision=revision+1 WHERE singleton=1 AND barrier_id=? AND barrier_nonce=?`,
      ).run(gateId, gateNonce);
      connection.db.exec("COMMIT");
      return false;
    }
    // The draining barrier rejects new tickets. Queued-but-not-admitted work
    // has no writer authority and is canceled; an already admitted writer or
    // barrier must release its exact identity before the gate continues.
    currentStatement(connection.db, "DELETE FROM ne19_coordination_tickets").run();
    connection.db.exec("COMMIT");

    while (true) {
      const coordination = currentStatement(
        connection.db,
        `SELECT
        (writer_ticket_id IS NOT NULL OR (barrier_id IS NOT NULL AND barrier_id!=?)) AS active
        FROM ne19_coordination_state WHERE singleton=1`,
      ).get(gateId) as Record<string, SQLOutputValue> | undefined;
      if (coordination === undefined) {
        throw sqliteError("record-database-invalid", "portable-gate", "coordination singleton is missing");
      }
      if (decodeInteger(coordination.active, "portable_admission") === 0) break;
      if (Date.now() >= admissionDrainDeadline) {
        throw sqliteError(
          "record-write-busy",
          "portable-gate",
          "admitted writer did not drain before the portable deadline",
        );
      }
      Atomics.wait(waitCell, 0, 0, 15);
    }

    connection.db.exec("BEGIN IMMEDIATE");
    const active = currentStatement(
      connection.db,
      "SELECT count(*) AS count FROM ne19_run_resources WHERE terminal_state IS NULL",
    ).get() as Record<string, SQLOutputValue>;
    if (decodeInteger(active.count, "active_runs") !== 0) {
      throw sqliteError("record-command-conflict", "portable-gate", "active Run owners prevent portable close");
    }
    const invocationWork = currentStatement(
      connection.db,
      `SELECT
      (SELECT count(*) FROM ne19_invocation_sessions WHERE state IN ('active','recovering'))+
      (SELECT count(*) FROM ne19_invocation_session_queued_attempts)+
      (SELECT count(*) FROM ne19_case_locks) AS count`,
    ).get() as Record<string, SQLOutputValue>;
    if (decodeInteger(invocationWork.count, "invocation_work") !== 0) {
      throw sqliteError(
        "record-command-conflict",
        "portable-gate",
        "invocation coordination work prevents portable close",
      );
    }
    currentExec(
      connection.db,
      `DELETE FROM ne19_runs WHERE status!='sealed' AND NOT EXISTS
      (SELECT 1 FROM ne19_attempt_publications WHERE origin_run_id=ne19_runs.run_id); DELETE FROM ne19_coordination_tickets;`,
    );
    currentStatement(
      connection.db,
      `UPDATE ne19_coordination_state SET revision=revision+1,next_writer_sequence=1,
      writer_ticket_id=NULL,writer_sequence=NULL,writer_host=NULL,writer_pid=NULL,writer_deadline=NULL,
      writer_boot_id=NULL,writer_process_start=NULL,
      writer_enqueued_at=NULL,writer_nonce=NULL,writer_admitted_at=NULL,writer_lease_expires_at=NULL,
      barrier_id=NULL,barrier_nonce=NULL,barrier_host=NULL,barrier_pid=NULL,barrier_deadline=NULL,
      barrier_boot_id=NULL,barrier_process_start=NULL,
      barrier_requested_at=NULL,barrier_lease_expires_at=NULL,barrier_status=NULL,barrier_active_at=NULL
      WHERE singleton=1`,
    ).run();
    const clock = currentStatement(
      connection.db,
      "SELECT revision FROM ne19_run_publication_clock WHERE singleton=1",
    ).get() as Record<string, SQLOutputValue>;
    const generation = currentStatement(
      connection.db,
      "SELECT storage_generation FROM ne19_record_metadata WHERE singleton=1",
    ).get() as Record<string, SQLOutputValue>;
    currentStatement(
      connection.db,
      `UPDATE ne19_record_metadata SET barrier_state='portable',portable_generation=?,portable_revision=?
      WHERE singleton=1 AND barrier_state='draining' AND portable_gate_id=?`,
    ).run(
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
    const state = currentStatement(
      connection.db,
      `SELECT barrier_state,portable_generation,portable_revision,storage_generation
      FROM ne19_record_metadata WHERE singleton=1`,
    ).get() as Record<string, SQLOutputValue> | undefined;
    const active = currentStatement(
      connection.db,
      `SELECT
      (SELECT count(*) FROM ne19_run_resources WHERE terminal_state IS NULL)+
      (SELECT count(*) FROM ne19_runs r WHERE status!='sealed' AND
        (EXISTS (SELECT 1 FROM ne19_attempts a WHERE a.origin_run_id=r.run_id AND a.publication_state!='published') OR
         EXISTS (SELECT 1 FROM ne19_run_resources rr WHERE rr.run_id=r.run_id AND rr.terminal_state IS NULL)))+
      (SELECT count(*) FROM ne19_coordination_tickets) AS count`,
    ).get() as Record<string, SQLOutputValue>;
    const invocationWork = currentStatement(
      connection.db,
      `SELECT
      (SELECT count(*) FROM ne19_invocation_sessions WHERE state IN ('active','recovering'))+
      (SELECT count(*) FROM ne19_invocation_session_queued_attempts)+
      (SELECT count(*) FROM ne19_case_locks) AS count`,
    ).get() as Record<string, SQLOutputValue>;
    const registryWork = currentStatement(
      connection.db,
      `SELECT
      (SELECT count(*) FROM ne19_teardown_obligations)+
      (SELECT count(*) FROM ne19_shared_state_generations s WHERE state_kind!='free' AND generation=(SELECT max(generation) FROM ne19_shared_state_generations WHERE state_key=s.state_key)) AS count`,
    ).get() as Record<string, SQLOutputValue>;
    const coordination = currentStatement(
      connection.db,
      `SELECT writer_ticket_id,barrier_id FROM ne19_coordination_state WHERE singleton=1`,
    ).get() as Record<string, SQLOutputValue> | undefined;
    const clock = currentStatement(
      connection.db,
      "SELECT revision FROM ne19_run_publication_clock WHERE singleton=1",
    ).get() as Record<string, SQLOutputValue> | undefined;
    if (
      state === undefined ||
      decodeText(state.barrier_state, "barrier_state") !== "portable" ||
      decodeText(state.portable_generation, "portable_generation") !==
        decodeText(state.storage_generation, "storage_generation") ||
      clock === undefined ||
      decodeInteger(state.portable_revision, "portable_revision") !==
        decodeInteger(clock.revision, "publication_revision") ||
      decodeInteger(active.count, "portable_work") !== 0 ||
      decodeInteger(invocationWork.count, "portable_invocation_work") !== 0 ||
      decodeInteger(registryWork.count, "portable_registry_work") !== 0 ||
      coordination === undefined ||
      coordination.writer_ticket_id !== null ||
      coordination.barrier_id !== null
    ) {
      throw sqliteError(
        "record-database-invalid",
        "portable-gate",
        "hostile reopen did not prove a portable ProjectDatabase",
      );
    }
  } finally {
    closeRecordDatabase(connection);
  }
  return true;
}

/** Invocation-boundary portable operation; terminal session projections remain durable. */
export const finalizeInvocationPortable = makeProjectDatabasePortable;
