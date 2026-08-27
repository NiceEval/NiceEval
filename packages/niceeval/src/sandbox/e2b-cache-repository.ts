import type { DatabaseSync } from "node:sqlite";
import { Effect, type Scope } from "effect";
import type { UserDatabase } from "../user-database/client.ts";
import type { UserDatabaseFailure } from "../user-database/errors.ts";
import {
  isFiniteValue,
  sqlIn,
  sqlLiteral,
  type FiniteValue,
} from "./finite-domain.ts";

const E2B_CACHE_STATE = Object.freeze({
  building: "building", indexed: "indexed", unverified: "unverified",
  deleting: "deleting", tombstoned: "tombstoned",
} as const);
const E2B_RESERVATION_DISPOSITION = Object.freeze({ reserved: "reserved" } as const);
const E2B_CONTENTION_REASON = Object.freeze({ activeWriter: "active-writer", indexedGeneration: "indexed-generation" } as const);
const E2B_CLEAR_DISPOSITION = Object.freeze({
  missing: "missing", cleared: "cleared", activeRoot: "active-root", activeLease: "active-lease",
} as const);
const E2B_CONTENTION_REASONS = Object.freeze(Object.values(E2B_CONTENTION_REASON));
const E2B_CLEAR_DISPOSITIONS = Object.freeze(Object.values(E2B_CLEAR_DISPOSITION));
const E2B_CACHE_ENTRY_STATES = Object.freeze([
  E2B_CACHE_STATE.building, E2B_CACHE_STATE.indexed, E2B_CACHE_STATE.unverified,
  E2B_CACHE_STATE.deleting, E2B_CACHE_STATE.tombstoned,
] as const);

/**
 * The E2B snapshot registry is a first-party UserDatabase repository.  Its
 * request vocabulary intentionally contains no SQL and its handler receives
 * the worker-owned DatabaseSync connection from UserDatabase.
 */
export const E2B_CACHE_REPOSITORY = "e2b-cache" as const;

export type E2BCacheEntryState = FiniteValue<typeof E2B_CACHE_ENTRY_STATES>;

export interface E2BCacheEntry {
  readonly setupPrefixKey: string;
  readonly baseIdentity: string;
  readonly snapshotId: string | null;
  readonly declarationDigest: string;
  readonly generation: number;
  readonly createdAt: string;
  readonly lastSuccessfulUseAt: string | null;
  readonly replacementScope: string;
  readonly state: E2BCacheEntryState;
  readonly leaseId: string | null;
  readonly leaseUntil: string | null;
}

export interface E2BCacheRoot {
  readonly rootId: string;
  readonly setupPrefixKey: string;
  readonly sandboxId: string;
  readonly createdAt: string;
}

export interface E2BCacheSnapshotCleanup {
  readonly setupPrefixKey: string;
  readonly generation: number;
  readonly snapshotId: string;
}

export type E2BCacheRequest =
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "lookup";
      readonly setupPrefixKey: string;
      readonly baseIdentity: string;
      readonly rootId: string;
      readonly now: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "reserve";
      readonly setupPrefixKey: string;
      readonly baseIdentity: string;
      readonly declarationDigest: string;
      readonly replacementScope: string;
      readonly leaseId: string;
      readonly leaseUntil: string;
      readonly now: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "settle";
      readonly setupPrefixKey: string;
      readonly generation: number;
      readonly leaseId: string;
      readonly snapshotId: string;
      readonly now: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "abort";
      readonly setupPrefixKey: string;
      readonly generation: number;
      readonly leaseId: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "settle-root";
      readonly rootId: string;
      readonly sandboxId: string;
      readonly now: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "release-root";
      readonly rootId: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "adopt-root";
      readonly setupPrefixKey: string;
      readonly generation: number;
      readonly snapshotId: string;
      readonly rootId: string;
      readonly sandboxId: string;
      readonly now: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "reconcile";
      readonly now: string;
      readonly replacementScope?: string;
      readonly exceptSetupPrefixKey?: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "clear";
      readonly setupPrefixKey: string;
      readonly now: string;
    }
  | {
      readonly repository: typeof E2B_CACHE_REPOSITORY;
      readonly operation: "settle-delete";
      readonly setupPrefixKey: string;
      readonly generation: number;
      readonly deleted: boolean;
    };

export type E2BCacheResult =
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "lookup"; readonly entry: E2BCacheEntry | null; readonly root: E2BCacheRoot | null }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "reserve"; readonly disposition: typeof E2B_RESERVATION_DISPOSITION.reserved; readonly generation: number }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "reserve"; readonly disposition: FiniteValue<typeof E2B_CONTENTION_REASONS> }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "settle"; readonly settled: boolean }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "abort"; readonly aborted: boolean }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "settle-root"; readonly settled: boolean }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "release-root"; readonly released: boolean }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "adopt-root"; readonly adopted: boolean }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "reconcile"; readonly cleanup: readonly E2BCacheSnapshotCleanup[] }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "clear"; readonly disposition: FiniteValue<typeof E2B_CLEAR_DISPOSITIONS>; readonly cleanup: E2BCacheSnapshotCleanup | null }
  | { readonly repository: typeof E2B_CACHE_REPOSITORY; readonly operation: "settle-delete"; readonly settled: boolean };

export type E2BCacheResultFor<Request extends E2BCacheRequest> = Extract<E2BCacheResult, { readonly operation: Request["operation"] }>;

function hasStringFields(value: object, fields: readonly string[]): boolean {
  return fields.every((field) => typeof Reflect.get(value, field) === "string");
}

function hasGeneration(value: object): boolean {
  return Number.isSafeInteger(Reflect.get(value, "generation")) && Number(Reflect.get(value, "generation")) > 0;
}

/** Worker-side decoder for the closed E2B repository vocabulary. */
export function isE2BCacheRequest(value: unknown): value is E2BCacheRequest {
  if (!isRecord(value) || Reflect.get(value, "repository") !== E2B_CACHE_REPOSITORY) return false;
  switch (Reflect.get(value, "operation")) {
    case "lookup":
      return hasStringFields(value, ["setupPrefixKey", "baseIdentity", "rootId", "now"]);
    case "reserve":
      return hasStringFields(value, [
        "setupPrefixKey", "baseIdentity", "declarationDigest", "replacementScope", "leaseId", "leaseUntil", "now",
      ]);
    case "settle":
      return hasGeneration(value) && hasStringFields(value, ["setupPrefixKey", "leaseId", "snapshotId", "now"]);
    case "abort":
      return hasGeneration(value) && hasStringFields(value, ["setupPrefixKey", "leaseId"]);
    case "settle-root":
      return hasStringFields(value, ["rootId", "sandboxId", "now"]);
    case "release-root":
      return hasStringFields(value, ["rootId"]);
    case "adopt-root":
      return hasGeneration(value) && hasStringFields(value, ["setupPrefixKey", "snapshotId", "rootId", "sandboxId", "now"]);
    case "reconcile":
      return hasStringFields(value, ["now"]) &&
        (Reflect.get(value, "replacementScope") === undefined || typeof Reflect.get(value, "replacementScope") === "string") &&
        (Reflect.get(value, "exceptSetupPrefixKey") === undefined || typeof Reflect.get(value, "exceptSetupPrefixKey") === "string");
    case "clear":
      return hasStringFields(value, ["setupPrefixKey", "now"]);
    case "settle-delete":
      return hasGeneration(value) && hasStringFields(value, ["setupPrefixKey"]) && typeof Reflect.get(value, "deleted") === "boolean";
    default:
      return false;
  }
}

function isCleanup(value: unknown): value is E2BCacheSnapshotCleanup {
  return isRecord(value) && hasGeneration(value) && hasStringFields(value, ["setupPrefixKey", "snapshotId"]);
}

function isEntryResult(value: unknown): value is E2BCacheEntry {
  try {
    decodeEntry(value);
    return true;
  } catch {
    return false;
  }
}

function isRootResult(value: unknown): value is E2BCacheRoot {
  try {
    decodeRoot(value);
    return true;
  } catch {
    return false;
  }
}

export function isE2BCacheResult(value: unknown): value is E2BCacheResult {
  if (!isRecord(value) || Reflect.get(value, "repository") !== E2B_CACHE_REPOSITORY) return false;
  switch (Reflect.get(value, "operation")) {
    case "lookup":
      return (Reflect.get(value, "entry") === null || isEntryResult(Reflect.get(value, "entry"))) &&
        (Reflect.get(value, "root") === null || isRootResult(Reflect.get(value, "root")));
    case "reserve": {
      const disposition = Reflect.get(value, "disposition");
      return disposition === E2B_RESERVATION_DISPOSITION.reserved
        ? hasGeneration(value)
        : typeof disposition === "string" && isFiniteValue(E2B_CONTENTION_REASONS, disposition);
    }
    case "settle":
      return typeof Reflect.get(value, "settled") === "boolean";
    case "abort":
      return typeof Reflect.get(value, "aborted") === "boolean";
    case "settle-root":
      return typeof Reflect.get(value, "settled") === "boolean";
    case "release-root":
      return typeof Reflect.get(value, "released") === "boolean";
    case "adopt-root":
      return typeof Reflect.get(value, "adopted") === "boolean";
    case "reconcile":
      return Array.isArray(Reflect.get(value, "cleanup")) && (Reflect.get(value, "cleanup") as unknown[]).every(isCleanup);
    case "clear":
      return isFiniteValue(E2B_CLEAR_DISPOSITIONS, String(Reflect.get(value, "disposition"))) &&
        (Reflect.get(value, "cleanup") === null || isCleanup(Reflect.get(value, "cleanup")));
    case "settle-delete":
      return typeof Reflect.get(value, "settled") === "boolean";
    default:
      return false;
  }
}

type SchemaRow = { readonly type: unknown; readonly name: unknown; readonly tbl_name: unknown; readonly sql: unknown };

const EntriesTable = "e2b_cache_entries";
const RootsTable = "e2b_cache_roots";
const ReplacementHeadsTable = "e2b_cache_replacement_heads";
const CleanupIndex = "e2b_cache_entries_cleanup";
const CreateEntries = `CREATE TABLE ${EntriesTable} (
  setup_prefix_key TEXT PRIMARY KEY,
  base_identity TEXT NOT NULL,
  snapshot_id TEXT UNIQUE,
  declaration_digest TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  created_at TEXT NOT NULL,
  last_successful_use_at TEXT,
  replacement_scope TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN (${sqlIn(E2B_CACHE_ENTRY_STATES)})),
  lease_id TEXT,
  lease_until TEXT,
  CHECK ((state = ${sqlLiteral(E2B_CACHE_STATE.building)}) = (lease_id IS NOT NULL AND lease_until IS NOT NULL))
) STRICT`;
const CreateRoots = `CREATE TABLE ${RootsTable} (
  root_id TEXT PRIMARY KEY,
  setup_prefix_key TEXT NOT NULL REFERENCES ${EntriesTable}(setup_prefix_key),
  sandbox_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT`;
const CreateReplacementHeads = `CREATE TABLE ${ReplacementHeadsTable} (
  replacement_scope TEXT PRIMARY KEY,
  setup_prefix_key TEXT NOT NULL REFERENCES ${EntriesTable}(setup_prefix_key)
) STRICT`;
const CreateCleanupIndex = `CREATE INDEX ${CleanupIndex} ON ${EntriesTable}(state, replacement_scope, setup_prefix_key)`;

function exactSql(sql: string): string {
  return sql.trim().replace(/;+$/u, "").replace(/\s+/gu, " ");
}

function invalid(message: string): Error {
  return new Error(`e2b-cache: ${message}`);
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(row: object, name: string): string {
  const value = Reflect.get(row, name);
  if (typeof value !== "string") throw invalid(`row has invalid ${name}`);
  return value;
}

function nullableStringField(row: object, name: string): string | null {
  const value = Reflect.get(row, name);
  if (value === null) return null;
  if (typeof value !== "string") throw invalid(`row has invalid ${name}`);
  return value;
}

function positiveIntegerField(row: object, name: string): number {
  const value = Reflect.get(row, name);
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalid(`row has invalid ${name}`);
  return Number(value);
}

function stateField(row: object): E2BCacheEntryState {
  const value = stringField(row, "state");
  if (isFiniteValue(E2B_CACHE_ENTRY_STATES, value)) return value;
  throw invalid("row has invalid state");
}

function decodeEntry(value: unknown): E2BCacheEntry {
  if (!isRecord(value)) throw invalid("entry query returned a non-object row");
  const entry = {
    setupPrefixKey: stringField(value, "setup_prefix_key"),
    baseIdentity: stringField(value, "base_identity"),
    snapshotId: nullableStringField(value, "snapshot_id"),
    declarationDigest: stringField(value, "declaration_digest"),
    generation: positiveIntegerField(value, "generation"),
    createdAt: stringField(value, "created_at"),
    lastSuccessfulUseAt: nullableStringField(value, "last_successful_use_at"),
    replacementScope: stringField(value, "replacement_scope"),
    state: stateField(value),
    leaseId: nullableStringField(value, "lease_id"),
    leaseUntil: nullableStringField(value, "lease_until"),
  } as const;
  if ((entry.state === E2B_CACHE_STATE.building) !== (entry.leaseId !== null && entry.leaseUntil !== null)) {
    throw invalid("entry lease does not agree with state");
  }
  if (entry.state === E2B_CACHE_STATE.indexed && entry.snapshotId === null) throw invalid("indexed entry has no snapshot id");
  return Object.freeze(entry);
}

function decodeRoot(value: unknown): E2BCacheRoot {
  if (!isRecord(value)) throw invalid("root query returned a non-object row");
  return Object.freeze({
    rootId: stringField(value, "root_id"),
    setupPrefixKey: stringField(value, "setup_prefix_key"),
    sandboxId: stringField(value, "sandbox_id"),
    createdAt: stringField(value, "created_at"),
  });
}

function cleanupFor(entry: E2BCacheEntry): E2BCacheSnapshotCleanup {
  if (entry.snapshotId === null) throw invalid("cleanup candidate has no registered snapshot id");
  return Object.freeze({ setupPrefixKey: entry.setupPrefixKey, generation: entry.generation, snapshotId: entry.snapshotId });
}

function inTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw cause;
  }
}

function expireLeases(database: DatabaseSync, now: string): void {
  database.prepare(
    `UPDATE ${EntriesTable} SET state = ${sqlLiteral(E2B_CACHE_STATE.unverified)}, lease_id = NULL, lease_until = NULL ` +
      `WHERE state = ${sqlLiteral(E2B_CACHE_STATE.building)} AND lease_until <= ?`,
  ).run(now);
}

function assertCurrentSchema(database: DatabaseSync): void {
  const rows = database.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE tbl_name IN (?, ?, ?) OR name = ? ORDER BY type, name`,
  ).all(EntriesTable, RootsTable, ReplacementHeadsTable, CleanupIndex) as SchemaRow[];
  const required = [
    ["table", EntriesTable, EntriesTable, CreateEntries],
    ["table", RootsTable, RootsTable, CreateRoots],
    ["table", ReplacementHeadsTable, ReplacementHeadsTable, CreateReplacementHeads],
    ["index", CleanupIndex, EntriesTable, CreateCleanupIndex],
  ] as const;
  for (const [type, name, table, sql] of required) {
    const row = rows.find((candidate) => candidate.type === type && candidate.name === name && candidate.tbl_name === table);
    if (row === undefined || typeof row.sql !== "string" || exactSql(row.sql) !== exactSql(sql)) {
      throw invalid(`schema does not match revision 1 (${name})`);
    }
  }
  const expectedObjects = new Set([
    EntriesTable,
    RootsTable,
    ReplacementHeadsTable,
    CleanupIndex,
    `sqlite_autoindex_${EntriesTable}_1`,
    `sqlite_autoindex_${EntriesTable}_2`,
    `sqlite_autoindex_${RootsTable}_1`,
    `sqlite_autoindex_${ReplacementHeadsTable}_1`,
  ]);
  if (rows.length !== expectedObjects.size || rows.some((row) => typeof row.name !== "string" || !expectedObjects.has(row.name))) {
    throw invalid("schema has missing or unexpected objects");
  }
}

function migrateAdjacent(database: DatabaseSync, fromRevision: number): number {
  if (fromRevision !== 0) throw invalid(`has no migration from revision ${fromRevision}`);
  database.exec(`${CreateEntries}; ${CreateRoots}; ${CreateReplacementHeads}; ${CreateCleanupIndex};`);
  assertCurrentSchema(database);
  return 1;
}

function nextGeneration(database: DatabaseSync): number {
  const row = database.prepare(`SELECT COALESCE(MAX(generation), 0) AS generation FROM ${EntriesTable}`).get();
  if (!isRecord(row) || !Number.isSafeInteger(Reflect.get(row, "generation")) || Number(Reflect.get(row, "generation")) < 0) {
    throw invalid("generation query returned an invalid value");
  }
  return Number(Reflect.get(row, "generation")) + 1;
}

function reconcile(database: DatabaseSync, request: Extract<E2BCacheRequest, { readonly operation: "reconcile" }>): E2BCacheResultFor<typeof request> {
  return inTransaction(database, () => {
    expireLeases(database, request.now);
    const candidates = database.prepare(`
      SELECT entry.* FROM ${EntriesTable} AS entry
      LEFT JOIN ${ReplacementHeadsTable} AS head ON head.replacement_scope = entry.replacement_scope
      WHERE entry.snapshot_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${RootsTable} WHERE ${RootsTable}.setup_prefix_key = entry.setup_prefix_key)
        AND (
          entry.state = ${sqlLiteral(E2B_CACHE_STATE.deleting)}
          OR (
            entry.state = ${sqlLiteral(E2B_CACHE_STATE.indexed)}
            AND entry.replacement_scope != ''
            AND entry.setup_prefix_key != head.setup_prefix_key
            AND (? IS NULL OR entry.replacement_scope = ?)
            AND (? IS NULL OR entry.setup_prefix_key != ?)
          )
        )
    `).all(
      request.replacementScope ?? null,
      request.replacementScope ?? null,
      request.exceptSetupPrefixKey ?? null,
      request.exceptSetupPrefixKey ?? null,
    ).map(decodeEntry);
    for (const entry of candidates) {
      if (entry.state === E2B_CACHE_STATE.indexed) {
        database.prepare(`UPDATE ${EntriesTable} SET state = ${sqlLiteral(E2B_CACHE_STATE.deleting)} WHERE setup_prefix_key = ? AND generation = ? AND state = ${sqlLiteral(E2B_CACHE_STATE.indexed)}`)
          .run(entry.setupPrefixKey, entry.generation);
      }
    }
    return Object.freeze({
      repository: E2B_CACHE_REPOSITORY,
      operation: "reconcile" as const,
      cleanup: Object.freeze(candidates.map(cleanupFor)),
    });
  });
}

function dispatch(database: DatabaseSync, request: E2BCacheRequest): E2BCacheResult {
  if (request.operation === "lookup") {
    return inTransaction(database, () => {
      expireLeases(database, request.now);
      const entry = database.prepare(
        `SELECT * FROM ${EntriesTable} WHERE setup_prefix_key = ? AND base_identity = ? AND state = ${sqlLiteral(E2B_CACHE_STATE.indexed)}`,
      ).get(request.setupPrefixKey, request.baseIdentity);
      if (entry === undefined) {
        return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "lookup" as const, entry: null, root: null });
      }
      const decoded = decodeEntry(entry);
      const pendingSandboxId = `pending:${request.rootId}`;
      database.prepare(
        `INSERT INTO ${RootsTable}(root_id, setup_prefix_key, sandbox_id, created_at) VALUES (?, ?, ?, ?)`,
      ).run(request.rootId, decoded.setupPrefixKey, pendingSandboxId, request.now);
      return Object.freeze({
        repository: E2B_CACHE_REPOSITORY,
        operation: "lookup" as const,
        entry: decoded,
        root: Object.freeze({ rootId: request.rootId, setupPrefixKey: decoded.setupPrefixKey, sandboxId: pendingSandboxId, createdAt: request.now }),
      });
    });
  }
  if (request.operation === "reserve") {
    return inTransaction(database, () => {
      expireLeases(database, request.now);
      const existing = database.prepare(`SELECT * FROM ${EntriesTable} WHERE setup_prefix_key = ?`).get(request.setupPrefixKey);
      if (existing !== undefined) {
        const entry = decodeEntry(existing);
        if (entry.state === E2B_CACHE_STATE.indexed) {
          return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "reserve" as const, disposition: E2B_CONTENTION_REASON.indexedGeneration });
        }
        if (entry.state === E2B_CACHE_STATE.building) {
          return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "reserve" as const, disposition: E2B_CONTENTION_REASON.activeWriter });
        }
      }
      const generation = nextGeneration(database);
      database.prepare(`
        INSERT INTO ${EntriesTable}(
          setup_prefix_key, base_identity, snapshot_id, declaration_digest, generation, created_at,
          last_successful_use_at, replacement_scope, state, lease_id, lease_until
        ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ${sqlLiteral(E2B_CACHE_STATE.building)}, ?, ?)
        ON CONFLICT(setup_prefix_key) DO UPDATE SET
          base_identity = excluded.base_identity,
          snapshot_id = NULL,
          declaration_digest = excluded.declaration_digest,
          generation = excluded.generation,
          created_at = excluded.created_at,
          last_successful_use_at = NULL,
          replacement_scope = excluded.replacement_scope,
          state = ${sqlLiteral(E2B_CACHE_STATE.building)},
          lease_id = excluded.lease_id,
          lease_until = excluded.lease_until
      `).run(
        request.setupPrefixKey,
        request.baseIdentity,
        request.declarationDigest,
        generation,
        request.now,
        request.replacementScope,
        request.leaseId,
        request.leaseUntil,
      );
      return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "reserve" as const, disposition: E2B_RESERVATION_DISPOSITION.reserved, generation });
    });
  }
  if (request.operation === "settle") {
    return inTransaction(database, () => {
      const receipt = database.prepare(`
        UPDATE ${EntriesTable} SET snapshot_id = ?, state = ${sqlLiteral(E2B_CACHE_STATE.indexed)}, lease_id = NULL, lease_until = NULL
        WHERE setup_prefix_key = ? AND generation = ? AND lease_id = ? AND state = ${sqlLiteral(E2B_CACHE_STATE.building)} AND lease_until > ?
      `).run(request.snapshotId, request.setupPrefixKey, request.generation, request.leaseId, request.now);
      if (receipt.changes === 1) {
        const entry = database.prepare(`SELECT replacement_scope FROM ${EntriesTable} WHERE setup_prefix_key = ?`).get(request.setupPrefixKey);
        if (!isRecord(entry)) throw invalid("settled entry disappeared");
        const scope = stringField(entry, "replacement_scope");
        database.prepare(`
          INSERT INTO ${ReplacementHeadsTable}(replacement_scope, setup_prefix_key) VALUES (?, ?)
          ON CONFLICT(replacement_scope) DO UPDATE SET setup_prefix_key = excluded.setup_prefix_key
        `).run(scope, request.setupPrefixKey);
      }
      return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "settle" as const, settled: receipt.changes === 1 });
    });
  }
  if (request.operation === "abort") {
    const receipt = database.prepare(`
      UPDATE ${EntriesTable} SET state = ${sqlLiteral(E2B_CACHE_STATE.unverified)}, lease_id = NULL, lease_until = NULL
      WHERE setup_prefix_key = ? AND generation = ? AND lease_id = ? AND state = ${sqlLiteral(E2B_CACHE_STATE.building)}
    `).run(request.setupPrefixKey, request.generation, request.leaseId);
    return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "abort" as const, aborted: receipt.changes === 1 });
  }
  if (request.operation === "settle-root") {
    return inTransaction(database, () => {
      const root = database.prepare(`SELECT setup_prefix_key FROM ${RootsTable} WHERE root_id = ?`).get(request.rootId);
      if (!isRecord(root)) return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "settle-root" as const, settled: false });
      const setupPrefixKey = stringField(root, "setup_prefix_key");
      const updatedRoot = database.prepare(`UPDATE ${RootsTable} SET sandbox_id = ? WHERE root_id = ?`).run(request.sandboxId, request.rootId);
      const updatedEntry = database.prepare(`UPDATE ${EntriesTable} SET last_successful_use_at = ? WHERE setup_prefix_key = ? AND state = ${sqlLiteral(E2B_CACHE_STATE.indexed)}`)
        .run(request.now, setupPrefixKey);
      return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "settle-root" as const, settled: updatedRoot.changes === 1 && updatedEntry.changes === 1 });
    });
  }
  if (request.operation === "release-root") {
    const receipt = database.prepare(`DELETE FROM ${RootsTable} WHERE root_id = ?`).run(request.rootId);
    return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "release-root" as const, released: receipt.changes === 1 });
  }
  if (request.operation === "adopt-root") {
    return inTransaction(database, () => {
      const receipt = database.prepare(`
        INSERT INTO ${RootsTable}(root_id, setup_prefix_key, sandbox_id, created_at)
        SELECT ?, setup_prefix_key, ?, ? FROM ${EntriesTable}
        WHERE setup_prefix_key = ? AND generation = ? AND snapshot_id = ? AND state = ${sqlLiteral(E2B_CACHE_STATE.indexed)}
      `).run(request.rootId, request.sandboxId, request.now, request.setupPrefixKey, request.generation, request.snapshotId);
      return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "adopt-root" as const, adopted: receipt.changes === 1 });
    });
  }
  if (request.operation === "reconcile") return reconcile(database, request);
  if (request.operation === "clear") {
    return inTransaction(database, () => {
      expireLeases(database, request.now);
      const row = database.prepare(`SELECT * FROM ${EntriesTable} WHERE setup_prefix_key = ?`).get(request.setupPrefixKey);
      if (row === undefined) {
        return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "clear" as const, disposition: E2B_CLEAR_DISPOSITION.missing, cleanup: null });
      }
      const entry = decodeEntry(row);
      if (entry.state === E2B_CACHE_STATE.building) {
        return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "clear" as const, disposition: E2B_CLEAR_DISPOSITION.activeLease, cleanup: null });
      }
      const activeRoot = database.prepare(`SELECT root_id FROM ${RootsTable} WHERE setup_prefix_key = ? LIMIT 1`).get(entry.setupPrefixKey);
      if (activeRoot !== undefined) {
        return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "clear" as const, disposition: E2B_CLEAR_DISPOSITION.activeRoot, cleanup: null });
      }
      if (entry.snapshotId === null) {
        database.prepare(`UPDATE ${EntriesTable} SET state = ${sqlLiteral(E2B_CACHE_STATE.tombstoned)}, lease_id = NULL, lease_until = NULL WHERE setup_prefix_key = ?`)
          .run(entry.setupPrefixKey);
        return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "clear" as const, disposition: E2B_CLEAR_DISPOSITION.cleared, cleanup: null });
      }
      database.prepare(`UPDATE ${EntriesTable} SET state = ${sqlLiteral(E2B_CACHE_STATE.deleting)} WHERE setup_prefix_key = ? AND generation = ?`)
        .run(entry.setupPrefixKey, entry.generation);
      return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "clear" as const, disposition: E2B_CLEAR_DISPOSITION.cleared, cleanup: cleanupFor(entry) });
    });
  }
  const receipt = database.prepare(`
    UPDATE ${EntriesTable} SET state = CASE WHEN ? THEN ${sqlLiteral(E2B_CACHE_STATE.tombstoned)} ELSE ${sqlLiteral(E2B_CACHE_STATE.deleting)} END
    WHERE setup_prefix_key = ? AND generation = ? AND state = ${sqlLiteral(E2B_CACHE_STATE.deleting)}
  `).run(request.deleted ? 1 : 0, request.setupPrefixKey, request.generation);
  return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation: "settle-delete" as const, settled: receipt.changes === 1 });
}

/** This object is statically composed into UserDatabase's catalog by its owner. */
export const e2bCacheRepositoryHandler = Object.freeze({
  id: E2B_CACHE_REPOSITORY,
  currentRevision: 1,
  migrateAdjacent,
  assertCurrentSchema,
  dispatch,
});

export interface E2BCacheDatabase {
  readonly dispatch: <Request extends E2BCacheRequest>(request: Request) => Effect.Effect<E2BCacheResultFor<Request>, UserDatabaseFailure>;
}

export interface E2BCacheRepository {
  readonly lookup: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "lookup" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "lookup" }>, UserDatabaseFailure>;
  readonly reserve: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "reserve" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "reserve" }>, UserDatabaseFailure>;
  readonly settle: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "settle" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "settle" }>, UserDatabaseFailure>;
  readonly abort: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "abort" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "abort" }>, UserDatabaseFailure>;
  readonly settleRoot: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "settle-root" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "settle-root" }>, UserDatabaseFailure>;
  readonly releaseRoot: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "release-root" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "release-root" }>, UserDatabaseFailure>;
  readonly adoptRoot: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "adopt-root" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "adopt-root" }>, UserDatabaseFailure>;
  readonly reconcile: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "reconcile" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "reconcile" }>, UserDatabaseFailure>;
  readonly clear: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "clear" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "clear" }>, UserDatabaseFailure>;
  readonly settleDelete: (input: Omit<Extract<E2BCacheRequest, { readonly operation: "settle-delete" }>, "repository" | "operation">) => Effect.Effect<Extract<E2BCacheResult, { readonly operation: "settle-delete" }>, UserDatabaseFailure>;
}

function request<Operation extends E2BCacheRequest["operation"]>(
  operation: Operation,
  input: Omit<Extract<E2BCacheRequest, { readonly operation: Operation }>, "repository" | "operation">,
): Extract<E2BCacheRequest, { readonly operation: Operation }> {
  return Object.freeze({ repository: E2B_CACHE_REPOSITORY, operation, ...input }) as Extract<E2BCacheRequest, { readonly operation: Operation }>;
}

/** Main-thread facade: the caller gets typed operations, never a DatabaseSync handle or SQL. */
export function e2bCacheRepository(database: E2BCacheDatabase): E2BCacheRepository {
  return Object.freeze({
    lookup: (input: Parameters<E2BCacheRepository["lookup"]>[0]) => database.dispatch(request("lookup", input)),
    reserve: (input: Parameters<E2BCacheRepository["reserve"]>[0]) => database.dispatch(request("reserve", input)),
    settle: (input: Parameters<E2BCacheRepository["settle"]>[0]) => database.dispatch(request("settle", input)),
    abort: (input: Parameters<E2BCacheRepository["abort"]>[0]) => database.dispatch(request("abort", input)),
    settleRoot: (input: Parameters<E2BCacheRepository["settleRoot"]>[0]) => database.dispatch(request("settle-root", input)),
    releaseRoot: (input: Parameters<E2BCacheRepository["releaseRoot"]>[0]) => database.dispatch(request("release-root", input)),
    adoptRoot: (input: Parameters<E2BCacheRepository["adoptRoot"]>[0]) => database.dispatch(request("adopt-root", input)),
    reconcile: (input: Parameters<E2BCacheRepository["reconcile"]>[0]) => database.dispatch(request("reconcile", input)),
    clear: (input: Parameters<E2BCacheRepository["clear"]>[0]) => database.dispatch(request("clear", input)),
    settleDelete: (input: Parameters<E2BCacheRepository["settleDelete"]>[0]) => database.dispatch(request("settle-delete", input)),
  });
}

/**
 * A short UserDatabase scope is deliberately opened per registry operation.
 * E2B RPCs are always outside that scope/SQLite transaction; the UserDatabase
 * worker remains the sole owner of paths and sqlite connections.
 */
export function e2bCacheRepositoryFromUserDatabase(
  open: () => Effect.Effect<UserDatabase, UserDatabaseFailure, Scope.Scope>,
): E2BCacheRepository {
  const operation = <Result>(select: (repository: E2BCacheRepository) => Effect.Effect<Result, UserDatabaseFailure>) =>
    Effect.scoped(open().pipe(Effect.flatMap((database) => select(e2bCacheRepository(database as unknown as E2BCacheDatabase)))));
  return Object.freeze({
    lookup: (input: Parameters<E2BCacheRepository["lookup"]>[0]) => operation((repository) => repository.lookup(input)),
    reserve: (input: Parameters<E2BCacheRepository["reserve"]>[0]) => operation((repository) => repository.reserve(input)),
    settle: (input: Parameters<E2BCacheRepository["settle"]>[0]) => operation((repository) => repository.settle(input)),
    abort: (input: Parameters<E2BCacheRepository["abort"]>[0]) => operation((repository) => repository.abort(input)),
    settleRoot: (input: Parameters<E2BCacheRepository["settleRoot"]>[0]) => operation((repository) => repository.settleRoot(input)),
    releaseRoot: (input: Parameters<E2BCacheRepository["releaseRoot"]>[0]) => operation((repository) => repository.releaseRoot(input)),
    adoptRoot: (input: Parameters<E2BCacheRepository["adoptRoot"]>[0]) => operation((repository) => repository.adoptRoot(input)),
    reconcile: (input: Parameters<E2BCacheRepository["reconcile"]>[0]) => operation((repository) => repository.reconcile(input)),
    clear: (input: Parameters<E2BCacheRepository["clear"]>[0]) => operation((repository) => repository.clear(input)),
    settleDelete: (input: Parameters<E2BCacheRepository["settleDelete"]>[0]) => operation((repository) => repository.settleDelete(input)),
  });
}
