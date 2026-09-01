import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, link, mkdir, open as openFile, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { constants, DatabaseSync } from "node:sqlite";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import {
  defineSqliteMigrationCatalog,
  inspectSqliteMigrationLedger,
  migrateSqliteDatabase,
  SqliteMigrationKernelFailure,
  sqliteMigrationLedgerSql,
} from "../sqlite-migration-kernel.ts";
import { isDockerCacheRepositoryRequest } from "../sandbox/docker-cache-repository.ts";
import { isE2BCacheRequest } from "../sandbox/e2b-cache-repository.ts";
import { isIncusRepositoryRequest } from "../sandbox/incus/repository.ts";
import {
  UserDatabaseInvalid,
  UserDatabaseLegacyFound,
  UserDatabaseUnsupported,
} from "./errors.ts";
import {
  DURABLE_STATE_REPOSITORY,
  type DurableStateRequest,
  type UserDatabaseRepositoryRequest,
  type UserDatabaseMigrationResult,
  type UserDatabaseWorkerData,
  type UserDatabaseWorkerFailure,
  type UserDatabaseWorkerRequest,
  type UserDatabaseWorkerResponse,
} from "./protocol.ts";
import {
  dispatchUserDatabaseRepository,
  repositoryHandlerFor,
  userDatabaseRepositoryCatalog,
} from "./repositories/catalog.ts";

const LedgerTable = "__niceeval_user_database_schema_migrations";
const CreateLedger = sqliteMigrationLedgerSql(LedgerTable);
const HostFormatTable = "__niceeval_user_database_format";
const HostFormatIdentity = "niceeval-user-database/0.14.0";
const UnsupportedPrereleaseIdentities = new Set(["niceeval-user-database/v2"]);
const MigrationBaseline = "0.14.0";
const CreateHostFormat = `CREATE TABLE ${HostFormatTable} (format_id TEXT PRIMARY KEY CHECK(format_id = '${HostFormatIdentity}')) STRICT`;
const CurrentVersion = 1;

function schemaObjectKey([type, name, table]: readonly string[]): string {
  return `${type}\u0000${name}\u0000${table}`;
}

/** UserDatabase is one static application format with one complete final schema. */
const AllowedSchemaObjects = new Set<string>([
  ["table", HostFormatTable, HostFormatTable],
  ["table", LedgerTable, LedgerTable],
  ["table", "durable_state_entries", "durable_state_entries"],
  ["table", "docker_cache_domains", "docker_cache_domains"],
  ["table", "docker_cache_metadata", "docker_cache_metadata"],
  ["table", "docker_task_build_entries", "docker_task_build_entries"],
  ["table", "docker_task_build_leases", "docker_task_build_leases"],
  ["table", "docker_task_build_roots", "docker_task_build_roots"],
  ["table", "docker_cache_gc_plans", "docker_cache_gc_plans"],
  ["table", "docker_image_gc_locks", "docker_image_gc_locks"],
  ["table", "docker_setup_prefix_entries", "docker_setup_prefix_entries"],
  ["table", "docker_setup_prefix_index", "docker_setup_prefix_index"],
  ["table", "docker_setup_prefix_generation_fences", "docker_setup_prefix_generation_fences"],
  ["table", "docker_setup_prefix_replacement_scopes", "docker_setup_prefix_replacement_scopes"],
  ["table", "docker_setup_prefix_replacement_heads", "docker_setup_prefix_replacement_heads"],
  ["table", "docker_setup_prefix_leases", "docker_setup_prefix_leases"],
  ["table", "docker_setup_prefix_roots", "docker_setup_prefix_roots"],
  ["table", "e2b_cache_entries", "e2b_cache_entries"],
  ["table", "e2b_cache_roots", "e2b_cache_roots"],
  ["table", "e2b_cache_replacement_heads", "e2b_cache_replacement_heads"],
  ["table", "incus_allocation_intents", "incus_allocation_intents"],
  ["table", "incus_artifact_intents", "incus_artifact_intents"],
  ["table", "incus_admission_leases", "incus_admission_leases"],
  ["table", "incus_artifact_replacement_heads", "incus_artifact_replacement_heads"],
  ["table", "incus_artifact_consumer_leases", "incus_artifact_consumer_leases"],
  ["table", "incus_artifact_destroy_receipts", "incus_artifact_destroy_receipts"],
  ["table", "incus_artifact_release_receipts", "incus_artifact_release_receipts"],
  ["index", "docker_setup_prefix_writer", "docker_setup_prefix_entries"],
  ["index", "docker_setup_prefix_replacement_scope", "docker_setup_prefix_replacement_scopes"],
  ["index", "e2b_cache_entries_cleanup", "e2b_cache_entries"],
  ["trigger", "docker_setup_prefix_exact_base_insert", "docker_setup_prefix_entries"],
  ["trigger", "docker_setup_prefix_exact_base_update", "docker_setup_prefix_entries"],
  ["index", "sqlite_autoindex___niceeval_user_database_format_1", HostFormatTable],
  ["index", "sqlite_autoindex_durable_state_entries_1", "durable_state_entries"],
  ["index", "sqlite_autoindex_docker_cache_domains_1", "docker_cache_domains"],
  ["index", "sqlite_autoindex_docker_cache_gc_plans_1", "docker_cache_gc_plans"],
  ["index", "sqlite_autoindex_docker_cache_metadata_1", "docker_cache_metadata"],
  ["index", "sqlite_autoindex_docker_image_gc_locks_1", "docker_image_gc_locks"],
  ["index", "sqlite_autoindex_docker_setup_prefix_entries_1", "docker_setup_prefix_entries"],
  ["index", "sqlite_autoindex_docker_setup_prefix_entries_2", "docker_setup_prefix_entries"],
  ["index", "sqlite_autoindex_docker_setup_prefix_generation_fences_1", "docker_setup_prefix_generation_fences"],
  ["index", "sqlite_autoindex_docker_setup_prefix_index_1", "docker_setup_prefix_index"],
  ["index", "sqlite_autoindex_docker_setup_prefix_index_2", "docker_setup_prefix_index"],
  ["index", "sqlite_autoindex_docker_setup_prefix_leases_1", "docker_setup_prefix_leases"],
  ["index", "sqlite_autoindex_docker_setup_prefix_replacement_heads_1", "docker_setup_prefix_replacement_heads"],
  ["index", "sqlite_autoindex_docker_setup_prefix_replacement_scopes_1", "docker_setup_prefix_replacement_scopes"],
  ["index", "sqlite_autoindex_docker_setup_prefix_roots_1", "docker_setup_prefix_roots"],
  ["index", "sqlite_autoindex_docker_task_build_entries_1", "docker_task_build_entries"],
  ["index", "sqlite_autoindex_docker_task_build_leases_1", "docker_task_build_leases"],
  ["index", "sqlite_autoindex_docker_task_build_roots_1", "docker_task_build_roots"],
  ["index", "sqlite_autoindex_e2b_cache_entries_1", "e2b_cache_entries"],
  ["index", "sqlite_autoindex_e2b_cache_entries_2", "e2b_cache_entries"],
  ["index", "sqlite_autoindex_e2b_cache_replacement_heads_1", "e2b_cache_replacement_heads"],
  ["index", "sqlite_autoindex_e2b_cache_roots_1", "e2b_cache_roots"],
  ["index", "sqlite_autoindex_incus_admission_leases_1", "incus_admission_leases"],
  ["index", "sqlite_autoindex_incus_allocation_intents_1", "incus_allocation_intents"],
  ["index", "sqlite_autoindex_incus_artifact_intents_1", "incus_artifact_intents"],
  ["index", "sqlite_autoindex_incus_artifact_replacement_heads_1", "incus_artifact_replacement_heads"],
  ["index", "sqlite_autoindex_incus_artifact_consumer_leases_1", "incus_artifact_consumer_leases"],
  ["index", "sqlite_autoindex_incus_artifact_destroy_receipts_1", "incus_artifact_destroy_receipts"],
  ["index", "sqlite_autoindex_incus_artifact_release_receipts_1", "incus_artifact_release_receipts"],
].map(schemaObjectKey));

type SchemaRow = { readonly type: string; readonly name: string; readonly tbl_name: string; readonly sql: string | null };
type FormatRow = { readonly format_id: unknown };

const Migration1Digest = createHash("sha256")
  .update(`niceeval.user-database/${MigrationBaseline}/migration/1\0`)
  .update(CreateHostFormat)
  .update("\0")
  .update(CreateLedger)
  .update("\0")
  .update(userDatabaseRepositoryCatalog.map((entry) => entry.id).join("\n"))
  .digest("hex");

function exactSql(sql: string): string {
  return sql.trim().replace(/;+$/u, "").replace(/\s+/gu, " ");
}

function invalid(message: string, repository?: string, cause?: unknown): UserDatabaseInvalid {
  return new UserDatabaseInvalid({ code: "user-database-invalid", message, repository, cause });
}

function unsupportedBaseline(databaseBaseline: string): UserDatabaseUnsupported {
  return new UserDatabaseUnsupported({
    code: "user-database-unsupported",
    message: `unsupported UserDatabase baseline ${databaseBaseline}; supported baseline is ${MigrationBaseline}`,
    repository: "global",
    databaseBaseline,
    supportedBaseline: MigrationBaseline,
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return false;
    throw cause;
  }
}

function schemaFor(database: DatabaseSync, object: string): readonly SchemaRow[] {
  return database.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE tbl_name = ? OR name = ? ORDER BY type, name",
  ).all(object, object) as SchemaRow[];
}

function hasExactTableAndPrimaryKeyIndex(database: DatabaseSync, tableName: string, createSql: string): boolean {
  const rows = schemaFor(database, tableName);
  const table = rows.find((row) => row.type === "table" && row.name === tableName && row.tbl_name === tableName);
  const automaticIndex = rows.find((row) =>
    row.type === "index" && row.name === `sqlite_autoindex_${tableName}_1` && row.tbl_name === tableName && row.sql === null);
  return rows.length === 2 && table !== undefined && automaticIndex !== undefined && exactSql(table.sql ?? "") === exactSql(createSql);
}

function schemaObjects(database: DatabaseSync): readonly SchemaRow[] {
  return database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all() as SchemaRow[];
}

function isKnownSchemaObject(row: SchemaRow): boolean {
  return AllowedSchemaObjects.has(schemaObjectKey([row.type, row.name, row.tbl_name]));
}

function assertStaticSchemaObjectAllowlist(database: DatabaseSync): void {
  for (const row of schemaObjects(database)) {
    if (!isKnownSchemaObject(row)) throw invalid(`UserDatabase has an unsupported schema object ${row.type} ${row.name}`);
  }
}

function assertHostFormat(database: DatabaseSync, identity: string, createSql: string): void {
  if (!hasExactTableAndPrimaryKeyIndex(database, HostFormatTable, createSql)) {
    throw invalid("UserDatabase format identity has an unsupported schema");
  }
  const rows = database.prepare(`SELECT format_id FROM ${HostFormatTable}`).all() as FormatRow[];
  if (rows.length !== 1 || rows[0]?.format_id !== identity) {
    throw invalid("UserDatabase format identity is missing or unsupported");
  }
}

function rejectUnsupportedPrereleaseIdentity(database: DatabaseSync): void {
  const table = schemaObjects(database).find((row) => row.type === "table" && row.name === HostFormatTable);
  if (table === undefined) return;
  let rows: readonly FormatRow[];
  try {
    rows = database.prepare(`SELECT format_id FROM ${HostFormatTable}`).all() as FormatRow[];
  } catch (cause) {
    throw invalid("UserDatabase format identity has an unsupported schema", "global", cause);
  }
  const identity = rows.length === 1 && typeof rows[0]?.format_id === "string" ? rows[0].format_id : undefined;
  if (identity !== undefined && UnsupportedPrereleaseIdentities.has(identity)) throw unsupportedBaseline(identity);
}

function assertCurrentDatabase(database: DatabaseSync): void {
  assertHostFormat(database, HostFormatIdentity, CreateHostFormat);
  const appliedVersion = inspectMigrationReceipts(database);
  if (appliedVersion !== CurrentVersion) throw invalid("UserDatabase global migration receipts do not reach the current version");
  for (const handler of userDatabaseRepositoryCatalog) handler.assertCurrentSchema(database);
  assertStaticSchemaObjectAllowlist(database);
}

const UserDatabaseMigrationCatalog = defineSqliteMigrationCatalog([
  Object.freeze({
    version: 1,
    digest: Migration1Digest,
    apply: (database: DatabaseSync): void => {
      for (const handler of userDatabaseRepositoryCatalog) handler.installCurrentSchema(database);
      database.exec(CreateHostFormat);
      database.prepare(`INSERT INTO ${HostFormatTable}(format_id) VALUES (?)`).run(HostFormatIdentity);
    },
  }),
], CurrentVersion);

function receipt(status: "bootstrapped" | "current" | "migrated", fromVersion = 0): UserDatabaseMigrationResult {
  const receipts = Object.freeze(UserDatabaseMigrationCatalog.map(({ version, digest }) => Object.freeze({ version, digest })));
  return status === "current"
    ? Object.freeze({ status, baseline: MigrationBaseline, version: CurrentVersion, receipts })
    : status === "bootstrapped"
      ? Object.freeze({ status, baseline: MigrationBaseline, fromVersion: 0 as const, toVersion: CurrentVersion, receipts })
      : Object.freeze({ status, baseline: MigrationBaseline, fromVersion, toVersion: CurrentVersion, receipts });
}

function inspectMigrationReceipts(database: DatabaseSync): number {
  try {
    return inspectSqliteMigrationLedger(database, LedgerTable, UserDatabaseMigrationCatalog);
  } catch (cause) {
    if (cause instanceof SqliteMigrationKernelFailure && cause.reason === "receipt-version-ahead") {
      throw unsupportedBaseline(`${MigrationBaseline}@ahead`);
    }
    if (cause instanceof SqliteMigrationKernelFailure) throw invalid(cause.message, "global", cause);
    throw cause;
  }
}

function applyMigrations(database: DatabaseSync, fromVersion: number, createdByThisHost: boolean): UserDatabaseMigrationResult {
  try {
    const result = migrateSqliteDatabase({
      database,
      ledgerTable: LedgerTable,
      catalog: UserDatabaseMigrationCatalog,
      expectedFromVersion: fromVersion,
      bootstrapping: createdByThisHost,
      appliedAt: () => new Date().toISOString(),
      validateCurrent: () => assertCurrentDatabase(database),
    });
    return receipt(result.status, result.fromVersion);
  } catch (cause) {
    if (cause instanceof SqliteMigrationKernelFailure) throw invalid(cause.message, "global", cause);
    throw cause;
  }
}

function migrateToCurrent(database: DatabaseSync, createdByThisHost: boolean): UserDatabaseMigrationResult {
  const objects = schemaObjects(database);
  if (createdByThisHost) {
    if (objects.length !== 0) throw invalid("New UserDatabase file unexpectedly contains schema objects");
    return applyMigrations(database, 0, true);
  }
  rejectUnsupportedPrereleaseIdentity(database);
  assertHostFormat(database, HostFormatIdentity, CreateHostFormat);
  const fromVersion = inspectMigrationReceipts(database);
  return applyMigrations(database, fromVersion, false);
}

function openStorageDatabase(path: string, busyTimeoutMs: number): DatabaseSync {
  const database = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: busyTimeoutMs,
  });
  try {
    database.enableLoadExtension(false);
    database.enableDefensive(true);
    database.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;");
    return database;
  } catch (cause) {
    database.close();
    throw cause;
  }
}

/**
 * A new public database path must never expose the empty file used to claim
 * creation. Initialize a private same-directory file first, then publish its
 * inode with an atomic hard link. Concurrent creators either win that link or
 * open the winner's complete host format; an unrelated pre-existing file is
 * still validated and never adopted.
 */
async function publishInitialHostFormat(input: UserDatabaseWorkerData): Promise<UserDatabaseMigrationResult | undefined> {
  if (await exists(input.databasePath)) return undefined;
  const temporaryPath = join(
    dirname(input.databasePath),
    `.${basename(input.databasePath)}.${process.pid}.${randomUUID()}.initialize`,
  );
  const handle = await openFile(temporaryPath, "wx", 0o600);
  await handle.close();
  try {
    const database = openStorageDatabase(temporaryPath, input.busyTimeoutMs);
    try {
      migrateToCurrent(database, true);
    } finally {
      database.close();
    }
    try {
      await link(temporaryPath, input.databasePath);
      return receipt("bootstrapped");
    } catch (cause) {
      if (typeof cause !== "object" || cause === null || Reflect.get(cause, "code") !== "EEXIST") throw cause;
      return undefined;
    }
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (cause) {
      if (typeof cause !== "object" || cause === null || Reflect.get(cause, "code") !== "ENOENT") throw cause;
    }
  }
}

function decodeWorkerData(value: unknown): UserDatabaseWorkerData {
  if (typeof value !== "object" || value === null) throw invalid("UserDatabase worker data is not an object");
  const databasePath = Reflect.get(value, "databasePath");
  const legacyPath = Reflect.get(value, "legacyPath");
  const busyTimeoutMs = Reflect.get(value, "busyTimeoutMs");
  if (typeof databasePath !== "string" || typeof legacyPath !== "string" ||
    !Number.isSafeInteger(busyTimeoutMs) || Number(busyTimeoutMs) < 1 || Number(busyTimeoutMs) > 120_000) {
    throw invalid("UserDatabase worker data is invalid");
  }
  return Object.freeze({ databasePath, legacyPath, busyTimeoutMs: Number(busyTimeoutMs) });
}

function isDurableStateRequest(value: unknown): value is DurableStateRequest {
  if (typeof value !== "object" || value === null || Reflect.get(value, "repository") !== DURABLE_STATE_REPOSITORY) return false;
  const operation = Reflect.get(value, "operation");
  if (operation === "list") return true;
  const key = Reflect.get(value, "key");
  if ((operation !== "get" && operation !== "put") || typeof key !== "string" || Buffer.byteLength(key) > 64 * 1024) return false;
  return operation === "get" || (typeof Reflect.get(value, "value") === "string" && Buffer.byteLength(String(Reflect.get(value, "value"))) <= 1024 * 1024);
}

function decodeRequest(value: unknown): UserDatabaseWorkerRequest | undefined {
  if (typeof value !== "object" || value === null || !Number.isSafeInteger(Reflect.get(value, "id"))) return undefined;
  const id = Number(Reflect.get(value, "id"));
  const kind = Reflect.get(value, "kind");
  if (kind === "close") return Object.freeze({ id, kind });
  if (kind === "maintenance" && Reflect.get(value, "operation") === "migrate-all") {
    return Object.freeze({ id, kind, operation: "migrate-all" });
  }
  const request = Reflect.get(value, "request");
  return kind === "repository" && (
    isDurableStateRequest(request) ||
    isDockerCacheRepositoryRequest(request) ||
    isE2BCacheRequest(request) ||
    isIncusRepositoryRequest(request)
  )
    ? Object.freeze({ id, kind, request })
    : undefined;
}

class UserDatabaseStorage {
  private constructor(private readonly database: DatabaseSync, private pendingMigration: UserDatabaseMigrationResult) {}

  static async open(input: UserDatabaseWorkerData): Promise<UserDatabaseStorage> {
    if (await exists(input.legacyPath)) {
      throw new UserDatabaseLegacyFound({
        code: "user-database-legacy-found",
        message: `Legacy user database ${input.legacyPath} must be removed or migrated explicitly before opening ${input.databasePath}`,
        legacyPath: input.legacyPath,
        databasePath: input.databasePath,
      });
    }
    await mkdir(dirname(input.databasePath), { recursive: true, mode: 0o700 });
    const publishedMigration = await publishInitialHostFormat(input);
    const database = openStorageDatabase(input.databasePath, input.busyTimeoutMs);
    try {
      const migration = publishedMigration ?? migrateToCurrent(database, false);
      database.exec("PRAGMA journal_mode=WAL;");
      const storage = new UserDatabaseStorage(database, migration);
      storage.installAuthorizer();
      return storage;
    } catch (cause) {
      database.close();
      throw cause;
    }
  }

  close(): void {
    if (this.database.isOpen) this.database.close();
  }

  dispatch(request: UserDatabaseRepositoryRequest) {
    repositoryHandlerFor(request).assertCurrentSchema(this.database);
    return dispatchUserDatabaseRepository(this.database, request);
  }

  migrateAll(): UserDatabaseMigrationResult {
    assertCurrentDatabase(this.database);
    const result = this.pendingMigration;
    this.pendingMigration = receipt("current");
    return result;
  }

  private installAuthorizer(): void {
    this.database.setAuthorizer((actionCode, _arg1, arg2, databaseName) => {
      if (databaseName !== null && databaseName !== "main") return constants.SQLITE_DENY;
      if (actionCode === constants.SQLITE_ATTACH || actionCode === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
      if (actionCode === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
      if (actionCode === constants.SQLITE_PRAGMA) return constants.SQLITE_DENY;
      return constants.SQLITE_OK;
    });
  }

}

function serializeFailure(cause: unknown): UserDatabaseWorkerFailure {
  const object = typeof cause === "object" && cause !== null ? cause : undefined;
  const rawMessage = cause instanceof Error ? cause.message : String(cause);
  const message = rawMessage.length === 0 ? "UserDatabase operation failed" : rawMessage;
  const code = object === undefined ? undefined : Reflect.get(object, "code");
  const repository = typeof Reflect.get(object ?? {}, "repository") === "string" ? String(Reflect.get(object!, "repository")) : undefined;
  if (code === "user-database-legacy-found") {
    return Object.freeze({
      code,
      message,
      legacyPath: String(Reflect.get(object!, "legacyPath")),
      databasePath: String(Reflect.get(object!, "databasePath")),
    });
  }
  if (code === "user-database-unsupported") {
    return Object.freeze({
      code,
      message,
      repository: repository ?? "unknown",
      databaseBaseline: String(Reflect.get(object!, "databaseBaseline")),
      supportedBaseline: String(Reflect.get(object!, "supportedBaseline")),
    });
  }
  if (code === "user-database-busy" || /SQLITE_BUSY|database is locked/iu.test(message)) {
    return Object.freeze({ code: "user-database-busy", message, repository });
  }
  return Object.freeze({ code: "user-database-invalid", message, repository });
}

if (!isMainThread && parentPort !== null) {
  let data: UserDatabaseWorkerData | undefined;
  try {
    data = decodeWorkerData(workerData);
  } catch (cause) {
    parentPort.postMessage(Object.freeze({ state: "startup-failure", error: serializeFailure(cause) }));
    parentPort.close();
  }
  if (data !== undefined) {
    void UserDatabaseStorage.open(data).then((storage) => {
      parentPort!.postMessage(Object.freeze({ state: "ready", migration: storage.migrateAll() }));
      let queue = Promise.resolve();
      parentPort!.on("message", (incoming: unknown) => {
        const request = decodeRequest(incoming);
        if (request === undefined) return;
        queue = queue.then(() => {
          let response: UserDatabaseWorkerResponse;
          try {
            const result = request.kind === "repository"
              ? storage.dispatch(request.request)
              : request.kind === "maintenance"
                ? storage.migrateAll()
                : (storage.close(), Object.freeze({ kind: "void" as const }));
            response = Object.freeze({ id: request.id, state: "success", result });
          } catch (cause) {
            response = Object.freeze({ id: request.id, state: "failure", error: serializeFailure(cause) });
          }
          parentPort!.postMessage(response);
          if (request.kind === "close") parentPort!.close();
        });
      });
    }, (cause) => {
      parentPort!.postMessage(Object.freeze({ state: "startup-failure", error: serializeFailure(cause) }));
      parentPort!.close();
    });
  }
}
