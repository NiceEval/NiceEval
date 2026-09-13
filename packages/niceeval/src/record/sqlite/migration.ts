import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, fsyncSync, lstatSync, openSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { backup, constants, DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { migrateLegacyClosureBytes, migrateLegacyRunBytes, type LegacyProjectDatabaseFormat } from "../codec/legacy-run-context.ts";
import { closeRecordDatabase, recordStatement, validateExactSchema, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import { exactLogicalSealIdentity } from "./seal.ts";
import {
  RECORD_SQLITE_BASELINE_FINGERPRINT,
  RECORD_SQLITE_BASELINE_SQL,
  RECORD_SQLITE_017_BASELINE_SQL,
  RECORD_SQLITE_017_FINGERPRINT,
  RECORD_SQLITE_017_TABLE_NAMES,
  RECORD_SQLITE_LEGACY_BASELINE_SQL,
  RECORD_SQLITE_LEGACY_FINGERPRINTS,
  RECORD_SQLITE_LEGACY_TABLE_NAMES,
  RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL,
} from "./schema.ts";
import { collectRunSealEntries, verifyAllSealedRuns } from "./storage.ts";
import { RECORD_SQLITE_FORMAT, RECORD_SQLITE_STORAGE_REVISION, type SealEntry } from "./types.ts";
import { validatePortableRecordDatabase } from "./portable-capture.ts";

type MigrationResult = "absent" | "current" | "migrated";
type Row = Record<string, SQLOutputValue>;

const LEGACY_FORMATS = new Set<LegacyProjectDatabaseFormat>([
  "niceeval.project-database/0.15",
  "niceeval.project-database/0.16",
  "niceeval.project-database/0.17",
]);

type HistoricalSchemaKind = "legacy-015-016" | "legacy-017";

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

const COPY_ORDER = [
  "coordination_state",
  "coordination_tickets",
  "runs",
  "slots",
  "attempts",
  "members",
  "attachments",
  "attachment_references",
  "collection_items",
  "contents",
  "content_chunks",
  "run_publication_clock",
  "run_resources",
  "run_expected_slots",
  "attempt_publications",
  "run_slot_bindings",
  "run_slot_absences",
  "run_recoveries",
  "run_deletion_tombstones",
  "invocation_sessions",
  "invocation_session_experiments",
  "invocation_session_queued_attempts",
  "case_locks",
  "teardown_obligations",
  "shared_state_generations",
  "kept_sandboxes",
  "kept_sandbox_operation_leases",
] as const;

function fail(message: string, cause?: unknown): never {
  throw sqliteError("record-schema-unsupported", "auto-migrate", message, cause);
}

function text(value: SQLOutputValue | undefined, field: string): string {
  if (typeof value !== "string") fail(`${field} is not text`);
  return value;
}

function integer(value: SQLOutputValue | undefined, field: string): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) fail(`${field} is not a safe integer`);
  return number;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").replace(/\s*([(),])\s*/gu, "$1").trim().replace(/;$/u, "");
}

function schemaRows(db: DatabaseSync): readonly string[] {
  const rows = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name LIMIT 257`).all() as unknown as readonly Row[];
  if (rows.length > 256) fail("database schema exceeds the bounded object allowlist");
  return rows.map((row) => JSON.stringify([
    text(row.type, "sqlite_schema.type"),
    text(row.name, "sqlite_schema.name"),
    text(row.tbl_name, "sqlite_schema.tbl_name"),
    row.sql === null ? null : normalizeSql(text(row.sql, "sqlite_schema.sql")),
  ]));
}

const expectedLegacySchemaRows = (() => {
  const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true, readBigInts: true });
  try {
    db.exec(RECORD_SQLITE_LEGACY_BASELINE_SQL);
    return Object.freeze(schemaRows(db));
  } finally {
    db.close();
  }
})();

const expected017SchemaRows = (() => {
  const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true, readBigInts: true });
  try {
    db.exec(RECORD_SQLITE_017_BASELINE_SQL);
    return Object.freeze(schemaRows(db));
  } finally {
    db.close();
  }
})();

const expectedCurrentSchemaRows = (() => {
  const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true, readBigInts: true });
  try {
    db.exec(RECORD_SQLITE_BASELINE_SQL);
    return Object.freeze(schemaRows(db));
  } finally {
    db.close();
  }
})();

function historicalSchemaKind(db: DatabaseSync): HistoricalSchemaKind {
  const actual = schemaRows(db);
  if (actual.length === expectedLegacySchemaRows.length && actual.every((row, index) => row === expectedLegacySchemaRows[index])) return "legacy-015-016";
  if (actual.length === expected017SchemaRows.length && actual.every((row, index) => row === expected017SchemaRows[index])) return "legacy-017";
  fail("historical database objects do not match an exact 0.15/0.16/0.17 schema allowlist");
}

function exactSchemaKind(db: DatabaseSync): HistoricalSchemaKind | "current" {
  const actual = schemaRows(db);
  if (actual.length === expectedLegacySchemaRows.length && actual.every((row, index) => row === expectedLegacySchemaRows[index])) {
    return "legacy-015-016";
  }
  if (actual.length === expected017SchemaRows.length && actual.every((row, index) => row === expected017SchemaRows[index])) {
    return "legacy-017";
  }
  if (actual.length === expectedCurrentSchemaRows.length && actual.every((row, index) => row === expectedCurrentSchemaRows[index])) {
    return "current";
  }
  fail("private portable database objects do not match an exact current or migratable schema allowlist");
}

/** Classifies only an already-private capture, before reading domain metadata. */
export function capturedRecordSchemaKind(path: string): "legacy" | "current" {
  const db = openRaw(path, true, 0);
  try {
    return exactSchemaKind(db) === "current" ? "current" : "legacy";
  } finally {
    db.close();
  }
}

function privateReaderAuthorizer(action: number, arg1: string | null, arg2: string | null, dbName: string | null): number {
  // All TEMP objects were installed from fixed SQL before this authorizer.
  // The main database is read-only at the VFS level; allowing private TEMP
  // work lets the existing bounded streaming Seal verifier spill and sort.
  if (dbName === "temp") return constants.SQLITE_OK;
  if (dbName !== null && dbName !== "main") return constants.SQLITE_DENY;
  if (READ_DENIED.has(action)) return constants.SQLITE_DENY;
  if (action === constants.SQLITE_PRAGMA && arg1 !== "quick_check" && arg1 !== "foreign_key_check" &&
    arg1 !== "secure_delete" && arg1 !== "table_info") {
    return constants.SQLITE_DENY;
  }
  if (action === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
  return constants.SQLITE_OK;
}

function updatePart(hash: ReturnType<typeof createHash>, value: SQLOutputValue): void {
  let tag: number;
  let bytes: Uint8Array;
  if (value === null) {
    tag = 0;
    bytes = new Uint8Array();
  } else if (typeof value === "string") {
    tag = 1;
    bytes = new TextEncoder().encode(value);
  } else if (typeof value === "number" || typeof value === "bigint") {
    tag = 2;
    bytes = new TextEncoder().encode(String(value));
  } else {
    tag = 3;
    bytes = value;
  }
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.byteLength, false);
  hash.update(Uint8Array.of(tag));
  hash.update(length);
  hash.update(bytes);
}

/** Exact typed digest of every legacy table row, independent of SQLite page layout. */
function legacyFactsDigest(db: DatabaseSync, kind: HistoricalSchemaKind): string {
  const hash = createHash("sha256").update("niceeval.project-database.legacy-facts/v1\0");
  const tables: readonly string[] = kind === "legacy-017" ? RECORD_SQLITE_017_TABLE_NAMES : RECORD_SQLITE_LEGACY_TABLE_NAMES;
  for (const table of tables) {
    hash.update(`${table}\0`);
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as readonly Row[];
    if (columns.length === 0) fail(`legacy table ${table} has no columns`);
    const names = columns.map((column) => text(column.name, `${table}.column`));
    const primary = [...columns]
      .filter((column) => integer(column.pk, `${table}.pk`) > 0)
      .sort((left, right) => integer(left.pk, `${table}.pk`) - integer(right.pk, `${table}.pk`))
      .map((column) => text(column.name, `${table}.column`));
    const order = primary.length === 0 ? names : primary;
    const sql = `SELECT ${names.map((name) => `"${name}"`).join(",")} FROM "${table}" ORDER BY ${order.map((name) => `"${name}"`).join(",")}`;
    for (const row of db.prepare(sql).iterate() as unknown as Iterable<Row>) {
      hash.update(Uint8Array.of(0xff));
      for (const name of names) updatePart(hash, row[name]!);
    }
  }
  return hash.digest("hex");
}

export function projectDatabaseMigrationBackupPath(path: string, format: LegacyProjectDatabaseFormat): string {
  const version = format.slice(format.lastIndexOf("/") + 1);
  return `${path}.pre-0.18-from-${version}.backup`;
}

function configure(db: DatabaseSync): void {
  db.enableLoadExtension(false);
  db.enableDefensive(true);
  db.exec("PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA mmap_size=0; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA recursive_triggers=ON;");
}

function openRaw(path: string, readOnly: boolean, timeout: number): DatabaseSync {
  const db = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    readBigInts: true,
    readOnly,
    timeout,
  });
  configure(db);
  return db;
}

function legacyIdentity(db: DatabaseSync): { readonly format: LegacyProjectDatabaseFormat; readonly digest: string } {
  const kind = historicalSchemaKind(db);
  const prefix = kind === "legacy-017" ? "ne_" : "";
  const row = db.prepare(`SELECT * FROM ${prefix}record_metadata WHERE singleton=1`).get() as Row | undefined;
  if (row === undefined) fail("legacy record_metadata singleton is missing");
  const format = text(row.format, "record_metadata.format");
  if (!LEGACY_FORMATS.has(format as LegacyProjectDatabaseFormat)) fail(`ProjectDatabase format ${format} is not auto-migratable`);
  const legacyFormat = format as LegacyProjectDatabaseFormat;
  if ((legacyFormat === "niceeval.project-database/0.17") !== (kind === "legacy-017")) {
    fail(`ProjectDatabase ${legacyFormat} does not match its exact historical schema`);
  }
  if (integer(row.storage_revision, "record_metadata.storage_revision") !== 1) fail("legacy storage revision is unsupported");
  const expectedFingerprint = legacyFormat === "niceeval.project-database/0.17"
    ? RECORD_SQLITE_017_FINGERPRINT
    : RECORD_SQLITE_LEGACY_FINGERPRINTS[legacyFormat];
  if (text(row.schema_fingerprint, "record_metadata.schema_fingerprint") !== expectedFingerprint) {
    fail("legacy schema fingerprint does not match its format");
  }
  const secureDelete = db.prepare("PRAGMA secure_delete").get() as Row | undefined;
  if (secureDelete === undefined || integer(secureDelete.secure_delete, "secure_delete") !== 1) fail("legacy database does not require secure_delete");
  const coordination = db.prepare(`SELECT operational_generation FROM ${prefix}coordination_state WHERE singleton=1`).get() as Row | undefined;
  if (coordination === undefined || text(coordination.operational_generation, "coordination_state.operational_generation") !== text(row.storage_generation, "record_metadata.storage_generation")) {
    fail("legacy coordination generation does not match record metadata");
  }
  if (legacyFormat === "niceeval.project-database/0.17") {
    const migration = db.prepare("SELECT state FROM ne_migration_state WHERE singleton=1").get() as Row | undefined;
    const state = migration === undefined ? "missing" : text(migration.state, "migration_state.state");
    if (state !== "ready") {
      fail(`historical ProjectDatabase 0.17 migration state is ${state}; open it with the original NiceEval version and finish recovery before upgrading`);
    }
  }
  return Object.freeze({ format: legacyFormat, digest: legacyFactsDigest(db, kind) });
}

function assertLegacyIdle(db: DatabaseSync, format: LegacyProjectDatabaseFormat): void {
  const prefix = format === "niceeval.project-database/0.17" ? "ne_" : "";
  const metadata = db.prepare(`SELECT barrier_state FROM ${prefix}record_metadata WHERE singleton=1`).get() as Row;
  const coordination = db.prepare(`SELECT writer_ticket_id,barrier_id FROM ${prefix}coordination_state WHERE singleton=1`).get() as Row;
  const work = db.prepare(`SELECT
    (SELECT count(*) FROM ${prefix}coordination_tickets)+
    (SELECT count(*) FROM ${prefix}runs WHERE status!='sealed')+
    (SELECT count(*) FROM ${prefix}attempts WHERE publication_state!='published')+
    (SELECT count(*) FROM ${prefix}run_resources WHERE terminal_state IS NULL)+
    (SELECT count(*) FROM ${prefix}invocation_sessions WHERE state IN ('active','recovering'))+
    (SELECT count(*) FROM ${prefix}invocation_session_queued_attempts)+
    (SELECT count(*) FROM ${prefix}case_locks)+
    (SELECT count(*) FROM ${prefix}teardown_obligations)+
    (SELECT count(*) FROM ${prefix}shared_state_generations s WHERE state_kind!='free' AND generation=(SELECT max(generation) FROM ${prefix}shared_state_generations WHERE state_key=s.state_key))+
    (SELECT count(*) FROM ${prefix}kept_sandbox_operation_leases) AS count`).get() as Row;
  if (text(metadata.barrier_state, "record_metadata.barrier_state") === "draining" ||
      coordination.writer_ticket_id !== null || coordination.barrier_id !== null || integer(work.count, "legacy active owner count") !== 0) {
    fail("legacy ProjectDatabase has an active or unknown owner; stop the old NiceEval process and finish or recover its work first");
  }
}

function assertLegacyPortable(db: DatabaseSync, format: LegacyProjectDatabaseFormat): void {
  const prefix = format === "niceeval.project-database/0.17" ? "ne_" : "";
  const metadata = db.prepare(`SELECT barrier_state,portable_generation,portable_revision,storage_generation
    FROM ${prefix}record_metadata WHERE singleton=1`).get() as Row | undefined;
  const coordination = db.prepare(`SELECT writer_ticket_id,barrier_id FROM ${prefix}coordination_state WHERE singleton=1`)
    .get() as Row | undefined;
  const clock = db.prepare(`SELECT revision FROM ${prefix}run_publication_clock WHERE singleton=1`).get() as Row | undefined;
  if (metadata === undefined || text(metadata.barrier_state, "record_metadata.barrier_state") !== "portable" ||
    text(metadata.portable_generation, "record_metadata.portable_generation") !==
      text(metadata.storage_generation, "record_metadata.storage_generation") ||
    clock === undefined || integer(metadata.portable_revision, "record_metadata.portable_revision") !==
      integer(clock.revision, "run_publication_clock.revision") ||
    coordination === undefined || coordination.writer_ticket_id !== null || coordination.barrier_id !== null) {
    fail("legacy private input does not prove a portable idle ProjectDatabase");
  }
  assertLegacyIdle(db, format);
}

const LEGACY_READ_ALIAS_TABLES = [
  "record_metadata",
  "runs",
  "slots",
  "attempts",
  "members",
  "attachments",
  "attachment_references",
  "collection_items",
  "contents",
  "content_chunks",
  "run_seal_entries",
  "attempt_publications",
] as const;

function installLegacyReadAliases(db: DatabaseSync, kind: HistoricalSchemaKind): void {
  const sourcePrefix = kind === "legacy-017" ? "ne_" : "";
  for (const table of LEGACY_READ_ALIAS_TABLES) {
    db.exec(`CREATE TEMP VIEW "ne18_${table}" AS SELECT * FROM main."${sourcePrefix}${table}"`);
  }
  db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
}

function assertSqliteIntegrity(db: DatabaseSync): void {
  const integrity = db.prepare("PRAGMA quick_check").all() as unknown as readonly Row[];
  if (integrity.length !== 1 || text(integrity[0]!.quick_check, "quick_check") !== "ok") {
    fail("private portable SQLite quick_check failed");
  }
  if (db.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    fail("private portable SQLite foreign-key closure is invalid");
  }
}

/**
 * No private capture obtains a writable SQLite connection before its hostile
 * read-only admission has proved an exact known schema and portable closure.
 */
function admitPrivatePortable(path: string, deadlineEpochMs: number): void {
  const db = openRaw(path, true, 0);
  const connection: RecordDatabase = { db, path, mode: "reader", statements: new Map() };
  try {
    const kind = exactSchemaKind(db);
    if (kind !== "current") installLegacyReadAliases(db, kind);
    else db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
    db.setAuthorizer(privateReaderAuthorizer);
    assertSqliteIntegrity(db);
    if (kind !== "current") {
      const identity = legacyIdentity(db);
      assertLegacyPortable(db, identity.format);
      validateLegacySeals(connection, kind === "legacy-017" ? "ne_" : "");
      if (identity.format === "niceeval.project-database/0.17") validateFrozen017Payloads(connection);
      return;
    }
    validateExactSchema(connection);
    const state = currentState(db);
    if (state === undefined) fail("private current ProjectDatabase identity is missing");
    const migrationState = text(state.state, "migration_state.state");
    if (migrationState === "committed") {
      const format = text(state.source_format, "migration_state.source_format") as LegacyProjectDatabaseFormat;
      if (!LEGACY_FORMATS.has(format)) fail("committed migration source format is invalid");
      assertBackup(projectDatabaseMigrationBackupPath(path, format), format, text(state.source_digest, "migration_state.source_digest"));
    } else if (migrationState !== "ready") {
      fail("private current ProjectDatabase migration state is invalid");
    }
    validatePortableRecordDatabase(connection, deadlineEpochMs);
  } finally {
    closeRecordDatabase(connection);
  }
}

function assertBackup(path: string, format: LegacyProjectDatabaseFormat, digest: string): void {
  const db = openRaw(path, true, 0);
  try {
    const identity = legacyIdentity(db);
    if (identity.format !== format || identity.digest !== digest) fail("migration backup does not exactly match the locked legacy input");
  } finally {
    db.close();
  }
}

function fsyncPath(path: string, directory = false): void {
  const descriptor = openSync(path, directory ? "r" : "r+");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

async function ensureBackup(databasePath: string, format: LegacyProjectDatabaseFormat, digest: string): Promise<string> {
  const target = projectDatabaseMigrationBackupPath(databasePath, format);
  try {
    lstatSync(target);
    assertBackup(target, format, digest);
    return target;
  } catch (cause) {
    if (typeof cause !== "object" || cause === null || Reflect.get(cause, "code") !== "ENOENT") throw cause;
  }
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const temporaryDescriptor = openSync(temporary, "wx", 0o600);
  try {
    // The path exists with private permissions before SQLite can copy a byte.
  } finally {
    closeSync(temporaryDescriptor);
  }
  let source: DatabaseSync | undefined;
  try {
    source = openRaw(databasePath, true, 0);
    await backup(source, temporary);
  } catch (cause) {
    try { unlinkSync(temporary); } catch { /* exact temporary may already be absent */ }
    throw cause;
  } finally {
    source?.close();
  }
  try {
    assertBackup(temporary, format, digest);
    fsyncPath(temporary);
    renameSync(temporary, target);
    fsyncPath(dirname(target), true);
    assertBackup(target, format, digest);
    return target;
  } catch (cause) {
    try { unlinkSync(temporary); } catch { /* exact temporary may already have been renamed */ }
    throw cause;
  }
}

function columns(db: DatabaseSync, table: string): readonly string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as readonly Row[])
    .map((row) => text(row.name, `${table}.column`));
}

function copyTable(db: DatabaseSync, table: string, sourcePrefix: "" | "ne_", overrides: Readonly<Record<string, string>> = {}): void {
  const sourceTable = `${sourcePrefix}${table}`;
  const names = columns(db, sourceTable);
  const target = names.map((name) => `"${name}"`).join(",");
  const source = names.map((name) => overrides[name] ?? `"${name}"`).join(",");
  db.exec(`INSERT INTO "ne18_${table}"(${target}) SELECT ${source} FROM "${sourceTable}"`);
}

function equalEntry(row: Row, entry: SealEntry, ordinal: number): boolean {
  return integer(row.ordinal, "run_seal_entries.ordinal") === ordinal &&
    text(row.entry_kind, "run_seal_entries.entry_kind") === entry.kind &&
    text(row.logical_identity, "run_seal_entries.logical_identity") === entry.logicalIdentity &&
    text(row.digest, "run_seal_entries.digest") === entry.digest;
}

function validateLegacySeals(connection: RecordDatabase, sourcePrefix: "" | "ne_"): readonly string[] {
  const runIds: string[] = [];
  for (const run of connection.db.prepare(`SELECT run_id,candidate_seal_identity,candidate_seal_entry_count,
    candidate_seal_staged_count,logical_seal_identity FROM ${sourcePrefix}runs ORDER BY run_id`).iterate() as unknown as Iterable<Row>) {
    const runId = text(run.run_id, "runs.run_id");
    const entries = collectRunSealEntries(connection, runId);
    const stored = connection.db.prepare(`SELECT ordinal,entry_kind,logical_identity,digest FROM ${sourcePrefix}run_seal_entries
      WHERE run_id=? ORDER BY ordinal`).all(runId) as unknown as readonly Row[];
    const identity = exactLogicalSealIdentity(entries);
    if (stored.length !== entries.length || stored.some((row, ordinal) => !equalEntry(row, entries[ordinal]!, ordinal)) ||
      integer(run.candidate_seal_entry_count, "runs.candidate_seal_entry_count") !== entries.length ||
      integer(run.candidate_seal_staged_count, "runs.candidate_seal_staged_count") !== entries.length ||
      text(run.candidate_seal_identity, "runs.candidate_seal_identity") !== identity ||
      text(run.logical_seal_identity, "runs.logical_seal_identity") !== identity) {
      fail(`legacy Run ${runId} Seal does not match its exact stored closure`);
    }
    runIds.push(runId);
  }
  return Object.freeze(runIds);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

/** Runs the independently frozen 0.17 codecs without rewriting historical bytes. */
function validateFrozen017Payloads(connection: RecordDatabase): void {
  const format = "niceeval.project-database/0.17";
  for (const row of connection.db.prepare("SELECT run_id,core_payload,core_digest FROM ne18_runs ORDER BY run_id").iterate() as unknown as Iterable<Row>) {
    if (!(row.core_payload instanceof Uint8Array)) fail("historical 0.17 Run core_payload is not bytes");
    const storedDigest = text(row.core_digest, "runs.core_digest");
    const validated = migrateLegacyRunBytes(format, row.core_payload);
    if (validated.runId !== text(row.run_id, "runs.run_id") || validated.digest !== storedDigest ||
      !sameBytes(validated.bytes, row.core_payload)) {
      fail("historical 0.17 Run Core does not preserve its exact bytes, digest, and identity");
    }
  }
  for (const row of connection.db.prepare(`SELECT attempt_id,origin_run_id,closure_payload,closure_digest
    FROM ne18_attempt_publications ORDER BY attempt_id`).iterate() as unknown as Iterable<Row>) {
    if (!(row.closure_payload instanceof Uint8Array)) fail("historical 0.17 Attempt closure_payload is not bytes");
    const storedDigest = text(row.closure_digest, "attempt_publications.closure_digest");
    const validated = migrateLegacyClosureBytes(format, row.closure_payload);
    if (validated.originRunId !== text(row.origin_run_id, "attempt_publications.origin_run_id") ||
      validated.digest !== storedDigest || !sameBytes(validated.bytes, row.closure_payload)) {
      fail("historical 0.17 Attempt closure does not preserve its exact bytes, digest, and identity");
    }
  }
}

function transformPayloads(connection: RecordDatabase, format: LegacyProjectDatabaseFormat, runIds: readonly string[]): void {
  for (const row of connection.db.prepare("SELECT run_id,core_payload,core_digest FROM ne18_runs ORDER BY run_id").iterate() as unknown as Iterable<Row>) {
    if (!(row.core_payload instanceof Uint8Array)) fail("legacy Run core_payload is not bytes");
    const sourceDigest = createHash("sha256").update(row.core_payload).digest("hex");
    if (sourceDigest !== text(row.core_digest, "runs.core_digest")) fail("legacy Run core digest differs from bytes");
    const migrated = migrateLegacyRunBytes(format, row.core_payload);
    if (migrated.runId !== text(row.run_id, "runs.run_id")) fail("legacy Run payload identity differs from its row");
    connection.db.prepare("UPDATE ne18_runs SET core_payload=?,core_digest=? WHERE run_id=?")
      .run(migrated.bytes, migrated.digest, migrated.runId);
  }
  for (const row of connection.db.prepare(`SELECT attempt_id,origin_run_id,closure_payload,closure_digest
    FROM ne18_attempt_publications ORDER BY attempt_id`).iterate() as unknown as Iterable<Row>) {
    if (!(row.closure_payload instanceof Uint8Array)) fail("legacy Attempt closure_payload is not bytes");
    const sourceDigest = createHash("sha256").update(row.closure_payload).digest("hex");
    if (sourceDigest !== text(row.closure_digest, "attempt_publications.closure_digest")) fail("legacy Attempt closure digest differs from bytes");
    const migrated = migrateLegacyClosureBytes(format, row.closure_payload);
    if (migrated.originRunId !== text(row.origin_run_id, "attempt_publications.origin_run_id")) fail("legacy Attempt closure origin differs from its row");
    connection.db.prepare("UPDATE ne18_attempt_publications SET closure_payload=?,closure_digest=? WHERE attempt_id=?")
      .run(migrated.bytes, migrated.digest, text(row.attempt_id, "attempt_publications.attempt_id"));
  }
  sealCurrentRuns(connection, runIds);
}

function sealCurrentRuns(connection: RecordDatabase, runIds: readonly string[]): void {
  const insert = connection.db.prepare(`INSERT INTO ne18_run_seal_entries(run_id,ordinal,entry_kind,logical_identity,digest)
    VALUES (?,?,?,?,?)`);
  for (const runId of runIds) {
    const entries = collectRunSealEntries(connection, runId);
    const identity = exactLogicalSealIdentity(entries);
    connection.db.prepare(`UPDATE ne18_runs SET status='sealing',candidate_seal_identity=?,candidate_seal_entry_count=?,
      candidate_seal_staged_count=0,logical_seal_identity=NULL WHERE run_id=? AND status='open'`).run(identity, entries.length, runId);
    entries.forEach((entry, ordinal) => insert.run(runId, ordinal, entry.kind, entry.logicalIdentity, entry.digest));
    connection.db.prepare(`UPDATE ne18_runs SET status='sealed',candidate_seal_staged_count=?,logical_seal_identity=?
      WHERE run_id=? AND status='sealing'`).run(entries.length, identity, runId);
  }
}

function convertLocked(connection: RecordDatabase, format: LegacyProjectDatabaseFormat, digest: string): void {
  const db = connection.db;
  const sourcePrefix = format === "niceeval.project-database/0.17" ? "ne_" : "";
  db.exec("PRAGMA defer_foreign_keys=ON");
  db.exec(RECORD_SQLITE_BASELINE_SQL);
  copyTable(db, "record_metadata", sourcePrefix);
  db.prepare(`UPDATE ne18_record_metadata SET format=?,storage_revision=?,schema_fingerprint=? WHERE singleton=1`)
    .run(RECORD_SQLITE_FORMAT, RECORD_SQLITE_STORAGE_REVISION, RECORD_SQLITE_BASELINE_FINGERPRINT);
  db.prepare(`INSERT INTO ne18_migration_state(singleton,state,source_format,source_digest) VALUES (1,'committed',?,?)`)
    .run(format, digest);
  for (const table of COPY_ORDER) {
    if (table === "runs") {
      copyTable(db, table, sourcePrefix, { status: "'open'", candidate_seal_identity: "NULL", candidate_seal_entry_count: "NULL", candidate_seal_staged_count: "0", logical_seal_identity: "NULL" });
    } else if (table === "attempts") {
      copyTable(db, table, sourcePrefix, { publication_state: "'staging'" });
    } else if (table === "run_publication_clock") {
      db.exec(`UPDATE ne18_run_publication_clock SET revision=(SELECT revision FROM ${sourcePrefix}run_publication_clock WHERE singleton=1)
        WHERE singleton=1`);
    } else {
      copyTable(db, table, sourcePrefix);
    }
  }
  const runIds = validateLegacySeals(connection, sourcePrefix);
  if (format === "niceeval.project-database/0.17") {
    validateFrozen017Payloads(connection);
    db.exec(`UPDATE ne18_attempts SET publication_state=(SELECT publication_state FROM ne_attempts old
      WHERE old.origin_run_id=ne18_attempts.origin_run_id AND old.attempt_id=ne18_attempts.attempt_id)`);
    sealCurrentRuns(connection, runIds);
  } else {
    db.exec(`UPDATE ne18_attempts SET publication_state=(SELECT publication_state FROM attempts old
      WHERE old.origin_run_id=ne18_attempts.origin_run_id AND old.attempt_id=ne18_attempts.attempt_id)`);
    transformPayloads(connection, format, runIds);
  }
  const oldTables: readonly string[] = format === "niceeval.project-database/0.17" ? RECORD_SQLITE_017_TABLE_NAMES : RECORD_SQLITE_LEGACY_TABLE_NAMES;
  for (const table of [...oldTables].reverse()) db.exec(`DROP TABLE "${table}"`);
  validateExactSchema(connection);
  verifyAllSealedRuns(connection, true);
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length !== 0) fail("converted ProjectDatabase has a foreign-key violation");
}

function currentState(db: DatabaseSync): Row | undefined {
  const present = db.prepare(`SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name='ne18_record_metadata'`).get() as Row;
  if (integer(present.count, "sqlite_schema.ne18_record_metadata") === 0) return undefined;
  return db.prepare(`SELECT m.format,m.storage_revision,m.schema_fingerprint,s.state,s.source_format,s.source_digest
    FROM ne18_record_metadata m JOIN ne18_migration_state s ON s.singleton=m.singleton WHERE m.singleton=1`).get() as Row | undefined;
}

function verifyCommitted(path: string, format: LegacyProjectDatabaseFormat, digest: string): void {
  assertBackup(projectDatabaseMigrationBackupPath(path, format), format, digest);
  const db = openRaw(path, true, 5_000);
  const connection: RecordDatabase = { db, path, mode: "maintenance", statements: new Map() };
  try {
    db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
    validateExactSchema(connection);
    verifyAllSealedRuns(connection, true);
    const state = currentState(db);
    if (state === undefined || text(state.state, "migration_state.state") !== "committed" ||
      text(state.source_format, "migration_state.source_format") !== format || text(state.source_digest, "migration_state.source_digest") !== digest) {
      fail("committed migration marker differs from its validated backup");
    }
  } finally {
    closeRecordDatabase(connection);
  }
}

function markReady(path: string, format: LegacyProjectDatabaseFormat, digest: string): void {
  const db = openRaw(path, false, 5_000);
  try {
    db.exec("BEGIN IMMEDIATE");
    const changed = db.prepare(`UPDATE ne18_migration_state SET state='ready'
      WHERE singleton=1 AND state='committed' AND source_format=? AND source_digest=?`).run(format, digest);
    if (Number(changed.changes) !== 1) fail("committed migration marker changed before readiness publication");
    db.exec("COMMIT");
  } catch (cause) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw cause;
  } finally {
    db.close();
  }
}

function checkpointReady(path: string): void {
  const db = openRaw(path, false, 5_000);
  try {
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Row | undefined;
    if (checkpoint === undefined || integer(checkpoint.busy, "wal_checkpoint.busy") !== 0 ||
      integer(checkpoint.log, "wal_checkpoint.log") !== integer(checkpoint.checkpointed, "wal_checkpoint.checkpointed")) {
      fail("ready migration could not be checkpointed into its main file");
    }
  } finally {
    db.close();
  }
}

function proveReadyMainFile(path: string, deadlineEpochMs: number): void {
  const proof = `${path}.ready-proof-${process.pid}-${randomUUID()}`;
  const descriptor = openSync(proof, "wx", 0o600);
  closeSync(descriptor);
  try {
    // copyFileSync overwrites the already-private inode without consulting or
    // copying WAL. A successful hostile reopen therefore proves main-file-only
    // readiness for Preview and other byte-copy consumers.
    copyFileSync(path, proof);
    chmodSync(proof, 0o600);
    const db = openRaw(proof, true, 0);
    const connection: RecordDatabase = { db, path: proof, mode: "reader", statements: new Map() };
    try {
      if (exactSchemaKind(db) !== "current") fail("ready migration proof is not the current exact schema");
      db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
      db.setAuthorizer(privateReaderAuthorizer);
      validateExactSchema(connection);
      const state = currentState(db);
      if (state === undefined || text(state.state, "migration_state.state") !== "ready") {
        fail("migration ready marker is not durable in the main file");
      }
      validatePortableRecordDatabase(connection, deadlineEpochMs);
    } finally {
      closeRecordDatabase(connection);
    }
  } finally {
    for (const ownedPath of [proof, `${proof}-wal`, `${proof}-shm`, `${proof}-journal`]) {
      try { unlinkSync(ownedPath); } catch { /* exact private proof path may already be absent */ }
    }
  }
}

/**
 * Migration entry for a Host-owned project inode or an already captured,
 * private, writable portable input. SQLite must never call it on an external
 * source path.
 */
export async function migrateHostOwnedProjectDatabase(
  path: string,
  busyTimeoutMs = 5_000,
  sourceKind: "host-owned" | "private-portable" = "host-owned",
  deadlineEpochMs = Date.now() + 30_000,
): Promise<MigrationResult> {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail("ProjectDatabase path is not a regular Host-owned file");
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return "absent";
    throw cause;
  }
  if (sourceKind === "private-portable") admitPrivatePortable(path, deadlineEpochMs);
  const db = openRaw(path, false, Math.max(0, Math.min(30_000, Math.trunc(busyTimeoutMs))));
  const connection: RecordDatabase = { db, path, mode: "writer", statements: new Map() };
  let migrated = false;
  let identity: { readonly format: LegacyProjectDatabaseFormat; readonly digest: string } | undefined;
  try {
    db.exec("BEGIN IMMEDIATE");
    const current = currentState(db);
    if (current !== undefined) {
      if (text(current.format, "record_metadata.format") !== RECORD_SQLITE_FORMAT ||
          integer(current.storage_revision, "record_metadata.storage_revision") !== RECORD_SQLITE_STORAGE_REVISION ||
          text(current.schema_fingerprint, "record_metadata.schema_fingerprint") !== RECORD_SQLITE_BASELINE_FINGERPRINT) {
        fail("current ProjectDatabase identity is invalid");
      }
      const state = text(current.state, "migration_state.state");
      if (state === "ready") {
        db.exec("ROLLBACK");
        return "current";
      }
      if (state !== "committed") fail("current ProjectDatabase migration state is invalid");
      const format = text(current.source_format, "migration_state.source_format") as LegacyProjectDatabaseFormat;
      if (!LEGACY_FORMATS.has(format)) fail("committed migration source format is invalid");
      identity = { format, digest: text(current.source_digest, "migration_state.source_digest") };
      db.exec("ROLLBACK");
    } else {
      identity = legacyIdentity(db);
      if (sourceKind === "private-portable") assertLegacyPortable(db, identity.format);
      else assertLegacyIdle(db, identity.format);
      await ensureBackup(path, identity.format, identity.digest);
      // The backup came from a second read-only connection. Revalidate the
      // still-locked source before any schema or payload mutation begins.
      const lockedAgain = legacyIdentity(db);
      if (lockedAgain.format !== identity.format || lockedAgain.digest !== identity.digest) fail("legacy facts changed while creating the migration backup");
      convertLocked(connection, identity.format, identity.digest);
      db.exec("COMMIT");
      migrated = true;
    }
    // A post-commit failure deliberately leaves state='committed'. Never copy
    // the old backup over the now-current inode; the next Host open retries
    // checkpoint and hostile validation from this durable marker.
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Row | undefined;
    if (checkpoint === undefined || integer(checkpoint.busy, "wal_checkpoint.busy") !== 0 ||
        integer(checkpoint.log, "wal_checkpoint.log") !== integer(checkpoint.checkpointed, "wal_checkpoint.checkpointed")) {
      throw sqliteError(
        "record-schema-migration-required",
        "auto-migrate-checkpoint",
        "ProjectDatabase migration committed, but an old reader still pins its WAL snapshot; close the old NiceEval process and rerun the experiment",
      );
    }
  } catch (cause) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw cause;
  } finally {
    closeRecordDatabase(connection);
  }
  if (identity === undefined) fail("migration identity was not established");
  verifyCommitted(path, identity.format, identity.digest);
  markReady(path, identity.format, identity.digest);
  if (sourceKind === "private-portable") {
    checkpointReady(path);
    proveReadyMainFile(path, deadlineEpochMs);
  }
  return migrated ? "migrated" : "current";
}
