import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { constants, DatabaseSync, type StatementSync } from "node:sqlite";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { USER_STATE_HOST_CURRENT_REVISION, USER_STATE_HOST_MIGRATION_0_TO_1 } from "./migrations.ts";
import { ServiceStateInvalid, ServiceStateMigrationRequired, ServiceStateUnsupported, type StateMigration, type StateSchemaObject, type StateSqlValue } from "./types.ts";
import type { StateWorkerCatalogModule, StateWorkerData, StateWorkerFailure, StateWorkerRequest, StateWorkerResponse, StateWorkerResult } from "./worker-protocol.ts";

type SchemaRow = { readonly type: string; readonly name: string; readonly tbl_name: string; readonly sql: string | null };
type ForeignKeyRow = { readonly table: string };
type ModuleRow = { readonly revision: number };
type Grant = "none" | "host" | { readonly prefix: string; readonly write: boolean; readonly migration: boolean; readonly schema: boolean };
type ValidatedSchema = { readonly revision: number; readonly identity: string };

const HostTable = "__niceeval_state_modules";
const NamespaceToken = "{{namespace}}";
const MAX_RESULT_ROWS = 10_000;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_ROW_BYTES = 512 * 1024;

function namespacePrefix(serviceId: string): string {
  // Kept in the worker so a caller can never turn a service id into SQL.
  return `__niceeval_state_${createHash("sha256").update(serviceId).digest("hex").slice(0, 24)}_`;
}

function compileSql(sql: string, prefix: string): string { return sql.split(NamespaceToken).join(prefix); }
function exactSql(sql: string): string { return sql.trim().replace(/;+$/u, "").trim(); }
function quoteIdentifier(identifier: string): string { return `"${identifier.replaceAll('"', '""')}"`; }
function schemaKey(row: SchemaRow): string { return `${row.type}\u0000${row.name}`; }
function sameSchemaRow(left: SchemaRow, right: SchemaRow): boolean {
  return left.type === right.type && left.name === right.name && left.tbl_name === right.tbl_name && exactSql(left.sql ?? "") === exactSql(right.sql ?? "");
}

function schemaFor(db: DatabaseSync, prefix: string): readonly SchemaRow[] {
  return (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name LIKE ? ESCAPE '\\' ORDER BY type, name").all(`${prefix.replace(/[_%\\]/gu, "\\$&")}%`) as SchemaRow[]).map((row) => Object.freeze({ ...row }));
}
function completeSchemaFor(db: DatabaseSync): readonly SchemaRow[] {
  return (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all() as SchemaRow[]).map((row) => Object.freeze({ ...row }));
}
function isNamespacedSchemaRow(row: SchemaRow, prefix: string): boolean {
  return (row.name.startsWith(prefix) && row.tbl_name.startsWith(prefix)) || (row.type === "index" && row.sql === null && row.name.startsWith("sqlite_autoindex_") && row.tbl_name.startsWith(prefix));
}
function assertNamespaceSchemaDelta(before: readonly SchemaRow[], after: readonly SchemaRow[], prefix: string, serviceId: string): void {
  const previous = new Map(before.map((row) => [schemaKey(row), row]));
  const next = new Map(after.map((row) => [schemaKey(row), row]));
  const changed = [...previous].flatMap(([key, row]) => {
    const replacement = next.get(key);
    return replacement === undefined || !sameSchemaRow(row, replacement) ? [row] : [];
  }).concat([...next].flatMap(([key, row]) => {
    const prior = previous.get(key);
    return prior === undefined || !sameSchemaRow(prior, row) ? [row] : [];
  }));
  if (changed.some((row) => !isNamespacedSchemaRow(row, prefix))) throw invalid(serviceId, "migration sqlite_schema delta escapes its namespace");
}
function expectedSchema(prefix: string, objects: readonly StateSchemaObject[]): readonly SchemaRow[] {
  return objects.map((object) => Object.freeze({ type: object.type, name: `${prefix}${object.logicalName}`, tbl_name: `${prefix}${object.type === "table" ? object.logicalName : object.tableLogicalName!}`, sql: exactSql(compileSql(object.sql, prefix)) })).sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
}
function sameSchema(actual: readonly SchemaRow[], expected: readonly SchemaRow[]): boolean { return actual.length === expected.length && actual.every((row, index) => sameSchemaRow(row, expected[index]!)); }
function schemaIdentity(schema: readonly SchemaRow[]): string { return JSON.stringify(schema.map((row) => [row.type, row.name, row.tbl_name, exactSql(row.sql ?? "")])); }
function hostSchemaFor(db: DatabaseSync): readonly SchemaRow[] { return (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE tbl_name = ? ORDER BY type, name").all(HostTable) as SchemaRow[]).map((row) => Object.freeze({ ...row })); }
function expectedHostSchema(): readonly SchemaRow[] {
  return Object.freeze([
    Object.freeze({ type: "index", name: `sqlite_autoindex_${HostTable}_1`, tbl_name: HostTable, sql: null }),
    Object.freeze({ type: "table", name: HostTable, tbl_name: HostTable, sql: exactSql(USER_STATE_HOST_MIGRATION_0_TO_1.sql[0]!) }),
  ]);
}
function assertHostSchema(db: DatabaseSync): void { if (!sameSchema(hostSchemaFor(db), expectedHostSchema())) throw new Error("User State Host schema does not match its checked-in revision"); }
function invalid(serviceId: string, reason: string): ServiceStateInvalid { return new ServiceStateInvalid({ code: "service-state-invalid", serviceId, reason }); }

function isDdl(actionCode: number): boolean {
  return new Set([constants.SQLITE_CREATE_INDEX, constants.SQLITE_CREATE_TABLE, constants.SQLITE_CREATE_TEMP_INDEX, constants.SQLITE_CREATE_TEMP_TABLE, constants.SQLITE_CREATE_TEMP_TRIGGER, constants.SQLITE_CREATE_TEMP_VIEW, constants.SQLITE_CREATE_TRIGGER, constants.SQLITE_CREATE_VIEW, constants.SQLITE_DROP_INDEX, constants.SQLITE_DROP_TABLE, constants.SQLITE_DROP_TEMP_INDEX, constants.SQLITE_DROP_TEMP_TABLE, constants.SQLITE_DROP_TEMP_TRIGGER, constants.SQLITE_DROP_TEMP_VIEW, constants.SQLITE_DROP_TRIGGER, constants.SQLITE_DROP_VIEW, constants.SQLITE_CREATE_VTABLE, constants.SQLITE_DROP_VTABLE, constants.SQLITE_ALTER_TABLE, constants.SQLITE_REINDEX, constants.SQLITE_ANALYZE]).has(actionCode);
}
function hasPrefix(value: string | null, prefix: string): boolean { return value !== null && value.startsWith(prefix); }
function automaticIndex(index: string | null, table: string | null, prefix: string): boolean { return table !== null && table.startsWith(prefix) && index?.startsWith(`sqlite_autoindex_${table}_`) === true; }
function allowsNamespacedDdl(actionCode: number, arg1: string | null, arg2: string | null, prefix: string): boolean {
  switch (actionCode) {
    case constants.SQLITE_CREATE_TABLE:
    case constants.SQLITE_DROP_TABLE: return hasPrefix(arg1, prefix) && arg2 === null;
    case constants.SQLITE_CREATE_INDEX: return hasPrefix(arg2, prefix) && (hasPrefix(arg1, prefix) || automaticIndex(arg1, arg2, prefix));
    case constants.SQLITE_DROP_INDEX: return hasPrefix(arg1, prefix) && hasPrefix(arg2, prefix);
    case constants.SQLITE_ALTER_TABLE: return arg1 === "main" && hasPrefix(arg2, prefix);
    case constants.SQLITE_REINDEX: return hasPrefix(arg1, prefix) && arg2 === null;
    default: return false;
  }
}

function resultSize(value: unknown, seen = new Set<object>()): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return Buffer.byteLength(value);
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return 16;
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value !== "object" || seen.has(value)) return MAX_RESULT_BYTES + 1;
  seen.add(value);
  if (Array.isArray(value)) return value.reduce((total, item) => total + resultSize(item, seen), 0);
  return Object.values(value).reduce((total, item) => total + resultSize(item, seen), 0);
}
function boundedRow(serviceId: string, row: unknown): unknown {
  if (typeof row !== "object" || row === null || Array.isArray(row) || resultSize(row) > MAX_RESULT_ROW_BYTES) throw invalid(serviceId, "fixed operation returned an invalid or oversized row");
  return row;
}
function boundedRows(serviceId: string, statement: StatementSync, values: readonly StateSqlValue[]): readonly unknown[] {
  const rows: unknown[] = [];
  let bytes = 0;
  for (const row of statement.iterate(...values)) {
    const bounded = boundedRow(serviceId, row);
    bytes += resultSize(bounded);
    if (rows.length >= MAX_RESULT_ROWS || bytes > MAX_RESULT_BYTES) throw invalid(serviceId, "fixed operation exceeded the State worker response bound");
    rows.push(bounded);
  }
  return Object.freeze(rows);
}

class StateStorage {
  #grant: Grant = "none";
  readonly #prepared = new Map<string, StatementSync>();
  readonly #validated = new Map<string, ValidatedSchema>();
  readonly #modules = new Map<string, StateWorkerCatalogModule>();

  private constructor(private readonly db: DatabaseSync, modules: readonly StateWorkerCatalogModule[], private readonly automaticMigrations: boolean) {
    for (const module of modules) this.#modules.set(module.serviceId, module);
    this.installAuthorizer();
  }

  static async open(input: StateWorkerData): Promise<StateStorage> {
    await mkdir(dirname(input.path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(input.path, { allowExtension: false, defensive: true, enableForeignKeyConstraints: true, timeout: input.busyTimeoutMs });
    try {
      initializeHost(db);
      return new StateStorage(db, input.catalog, input.automaticMigrations);
    } catch (cause) {
      db.close();
      throw cause;
    }
  }

  close(): void {
    this.#prepared.clear();
    this.#validated.clear();
    if (this.db.isOpen) this.db.close();
  }

  migrateAll(): void { for (const module of this.#modules.values()) this.ensureCurrent(module, true); }

  execute(serviceId: string, operationName: string, values: readonly StateSqlValue[]): StateWorkerResult {
    const module = this.#modules.get(serviceId);
    if (module === undefined) throw invalid(serviceId, "service is not composed by this Store Host");
    const operation = module.operations.find((candidate) => candidate.name === operationName);
    if (operation === undefined) throw invalid(serviceId, "operation is not declared by this module");
    this.ensureCurrent(module, this.automaticMigrations);
    const prefix = namespacePrefix(module.serviceId);
    const statement = this.withGrant({ prefix, write: operation.kind === "run", migration: false, schema: false }, () => {
      const key = `${module.serviceId}:${operation.name}`;
      const known = this.#prepared.get(key);
      if (known !== undefined) return known;
      const prepared = this.db.prepare(compileSql(operation.sql, prefix));
      this.#prepared.set(key, prepared);
      return prepared;
    });
    return this.withGrant({ prefix, write: operation.kind === "run", migration: false, schema: false }, () => {
      if (operation.kind === "run") {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const result = statement.run(...values);
          const changes = Number(result.changes);
          if (!Number.isSafeInteger(changes)) throw invalid(serviceId, "fixed operation returned an unsafe change count");
          if ((typeof result.lastInsertRowid !== "number" || !Number.isSafeInteger(result.lastInsertRowid)) && typeof result.lastInsertRowid !== "bigint") {
            throw invalid(serviceId, "fixed operation returned an invalid last insert rowid");
          }
          this.db.exec("COMMIT");
          return Object.freeze({ kind: "run" as const, changes, lastInsertRowid: result.lastInsertRowid });
        } catch (cause) {
          if (this.db.isTransaction) this.db.exec("ROLLBACK");
          throw cause;
        }
      }
      if (operation.kind === "one") {
        const raw = statement.get(...values);
        const row = raw === undefined ? null : boundedRow(serviceId, raw);
        return Object.freeze({ kind: "one" as const, row });
      }
      return Object.freeze({ kind: "many" as const, rows: boundedRows(serviceId, statement, values) });
    });
  }

  private installAuthorizer(): void {
    this.db.setAuthorizer((actionCode, arg1, arg2, databaseName, triggerOrView) => {
      if (databaseName !== null && databaseName !== "main") return constants.SQLITE_DENY;
      if (triggerOrView !== null || actionCode === constants.SQLITE_ATTACH || actionCode === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
      if (actionCode === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
      if (isDdl(actionCode)) return typeof this.#grant === "object" && this.#grant.migration && allowsNamespacedDdl(actionCode, arg1, arg2, this.#grant.prefix) ? constants.SQLITE_OK : constants.SQLITE_DENY;
      if (actionCode === constants.SQLITE_PRAGMA) return typeof this.#grant === "object" && this.#grant.schema && arg1?.toLowerCase() === "foreign_key_list" && hasPrefix(arg2, this.#grant.prefix) ? constants.SQLITE_OK : constants.SQLITE_DENY;
      if (actionCode === constants.SQLITE_READ || actionCode === constants.SQLITE_INSERT || actionCode === constants.SQLITE_UPDATE || actionCode === constants.SQLITE_DELETE) {
        const isWrite = actionCode !== constants.SQLITE_READ;
        if (this.#grant === "host") return arg1 === HostTable ? constants.SQLITE_OK : constants.SQLITE_DENY;
        if (typeof this.#grant === "object" && this.#grant.schema && (arg1 === "sqlite_master" || arg1 === "sqlite_schema")) return constants.SQLITE_OK;
        return typeof this.#grant === "object" && arg1?.startsWith(this.#grant.prefix) && (!isWrite || this.#grant.write) ? constants.SQLITE_OK : constants.SQLITE_DENY;
      }
      return constants.SQLITE_OK;
    });
  }

  private withGrant<Value>(grant: Grant, work: () => Value): Value { const prior = this.#grant; this.#grant = grant; try { return work(); } finally { this.#grant = prior; } }
  private readRevision(serviceId: string): number { return this.withGrant("host", () => (this.db.prepare(`SELECT revision FROM ${HostTable} WHERE service_id = ?`).get(serviceId) as ModuleRow | undefined)?.revision ?? 0); }

  private ensureCurrent(module: StateWorkerCatalogModule, allowMigration: boolean): void {
    const prefix = namespacePrefix(module.serviceId);
    const revision = this.readRevision(module.serviceId);
    if (!Number.isSafeInteger(revision) || revision < 0) throw invalid(module.serviceId, "module revision row is invalid");
    if (revision > module.currentRevision) throw new ServiceStateUnsupported({ code: "service-state-unsupported", serviceId: module.serviceId, databaseRevision: revision, supportedRevision: module.currentRevision });
    if (revision === module.currentRevision) {
      const identity = this.currentSchemaIdentity(module, prefix);
      const validated = this.#validated.get(module.serviceId);
      if (validated?.revision !== revision || validated.identity !== identity) {
        this.withGrant({ prefix, write: false, migration: false, schema: true }, () => this.assertCurrentSchema(module, prefix));
        this.#validated.set(module.serviceId, { revision, identity });
      }
      return;
    }
    if (!allowMigration) throw new ServiceStateMigrationRequired({ code: "service-state-migration-required", serviceId: module.serviceId, currentRevision: revision, requiredRevision: module.currentRevision });
    this.migrateToCurrent(module, prefix);
  }

  private migrateToCurrent(module: StateWorkerCatalogModule, prefix: string): void {
    this.withGrant({ prefix, write: true, migration: true, schema: true }, () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        let current = this.readRevision(module.serviceId);
        if (!Number.isSafeInteger(current) || current < 0) throw invalid(module.serviceId, "module revision row is invalid");
        if (current > module.currentRevision) throw new ServiceStateUnsupported({ code: "service-state-unsupported", serviceId: module.serviceId, databaseRevision: current, supportedRevision: module.currentRevision });
        while (current < module.currentRevision) {
          const migration = module.migrations.find((candidate) => candidate.from === current && candidate.to === current + 1);
          if (migration === undefined) throw new ServiceStateUnsupported({ code: "service-state-unsupported", serviceId: module.serviceId, databaseRevision: current, supportedRevision: module.currentRevision });
          this.applyAdjacentMigration(module.serviceId, prefix, migration);
          current = migration.to;
        }
        this.assertCurrentSchema(module, prefix);
        const identity = this.currentSchemaIdentity(module, prefix);
        this.db.exec("COMMIT");
        this.#prepared.clear();
        this.#validated.clear();
        this.#validated.set(module.serviceId, { revision: module.currentRevision, identity });
      } catch (cause) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        throw cause;
      }
    });
  }

  private applyAdjacentMigration(serviceId: string, prefix: string, migration: StateMigration): void {
    const before = completeSchemaFor(this.db);
    for (const sql of migration.sql) this.db.exec(compileSql(sql, prefix));
    const after = completeSchemaFor(this.db);
    assertNamespaceSchemaDelta(before, after, prefix, serviceId);
    if (!sameSchema(schemaFor(this.db, prefix), expectedSchema(prefix, migration.schema))) throw invalid(serviceId, "migration namespace schema does not exactly match its checked-in schema");
    for (const table of schemaFor(this.db, prefix).filter((row) => row.type === "table")) {
      const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`).all() as ForeignKeyRow[];
      if (foreignKeys.some((foreignKey) => !foreignKey.table.startsWith(prefix))) throw invalid(serviceId, "cross-namespace foreign key is forbidden");
    }
    const update = this.withGrant("host", () => this.db.prepare(`INSERT INTO ${HostTable}(service_id, revision) VALUES (?, ?) ON CONFLICT(service_id) DO UPDATE SET revision = excluded.revision WHERE revision = ?`).run(serviceId, migration.to, migration.from));
    if (update.changes !== 1) throw invalid(serviceId, "module revision changed before its migration could commit");
  }

  private assertCurrentSchema(module: StateWorkerCatalogModule, prefix: string): void {
    const schema = module.currentRevision === 0 ? [] : module.migrations[module.currentRevision - 1]!.schema;
    if (!sameSchema(schemaFor(this.db, prefix), expectedSchema(prefix, schema))) throw invalid(module.serviceId, "module revision does not match its checked-in schema");
    for (const table of schemaFor(this.db, prefix).filter((row) => row.type === "table")) {
      const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`).all() as ForeignKeyRow[];
      if (foreignKeys.some((foreignKey) => !foreignKey.table.startsWith(prefix))) throw invalid(module.serviceId, "cross-namespace foreign key is forbidden");
    }
  }

  private currentSchemaIdentity(module: StateWorkerCatalogModule, prefix: string): string {
    const schema = module.currentRevision === 0 ? [] : module.migrations[module.currentRevision - 1]!.schema;
    return schemaIdentity(expectedSchema(prefix, schema));
  }
}

function initializeHost(db: DatabaseSync): void {
  db.enableLoadExtension(false);
  db.enableDefensive(true);
  db.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  if (USER_STATE_HOST_CURRENT_REVISION !== 1) throw new Error("User State Host migration chain is incomplete");
  // A normal reader must not take the writer lock merely to re-check a stable
  // Host schema. Only the empty-store first opener needs the CAS-style lock.
  const observed = hostSchemaFor(db);
  if (sameSchema(observed, expectedHostSchema())) return;
  if (observed.length !== 0) throw new Error("User State Host schema does not match its checked-in revision");
  db.exec("BEGIN IMMEDIATE");
  try {
    // The second observation happens under the lock so two first openers
    // cannot both replay the initial migration.
    if (hostSchemaFor(db).length === 0) for (const sql of USER_STATE_HOST_MIGRATION_0_TO_1.sql) db.exec(sql);
    assertHostSchema(db);
    db.exec("COMMIT");
  } catch (cause) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw cause;
  }
}

function serializeFailure(cause: unknown, serviceId?: string): StateWorkerFailure {
  const object = typeof cause === "object" && cause !== null ? cause : undefined;
  const code = object === undefined ? undefined : Reflect.get(object, "code");
  const message = cause instanceof Error ? cause.message : String(cause);
  if (code === "service-state-migration-required") return Object.freeze({ code, message, serviceId: String(Reflect.get(object!, "serviceId")), currentRevision: Number(Reflect.get(object!, "currentRevision")), requiredRevision: Number(Reflect.get(object!, "requiredRevision")) });
  if (code === "service-state-unsupported") return Object.freeze({ code, message, serviceId: String(Reflect.get(object!, "serviceId")), databaseRevision: Number(Reflect.get(object!, "databaseRevision")), supportedRevision: Number(Reflect.get(object!, "supportedRevision")) });
  if (code === "service-state-busy" || /SQLITE_BUSY|database is locked/iu.test(message)) return Object.freeze({ code: "service-state-busy", message, serviceId });
  return Object.freeze({ code: "service-state-invalid", message, serviceId: typeof Reflect.get(object ?? {}, "serviceId") === "string" ? String(Reflect.get(object!, "serviceId")) : serviceId });
}

function validRequest(value: unknown): value is StateWorkerRequest {
  return typeof value === "object" && value !== null && Number.isSafeInteger(Reflect.get(value, "id")) && ["execute", "migrate-all", "close"].includes(String(Reflect.get(value, "operation")));
}

if (!isMainThread && parentPort !== null) {
  const data = workerData as StateWorkerData;
  void StateStorage.open(data).then((storage) => {
    parentPort!.postMessage(Object.freeze({ state: "ready" }));
    let queue = Promise.resolve();
    parentPort!.on("message", (incoming: unknown) => {
      if (!validRequest(incoming)) return;
      queue = queue.then(() => {
        let response: StateWorkerResponse;
        try {
          const result = incoming.operation === "execute" ? storage.execute(incoming.serviceId, incoming.operationName, incoming.values)
            : incoming.operation === "migrate-all" ? (storage.migrateAll(), Object.freeze({ kind: "void" as const }))
            : (storage.close(), Object.freeze({ kind: "void" as const }));
          response = Object.freeze({ id: incoming.id, state: "success" as const, result });
        } catch (cause) {
          response = Object.freeze({ id: incoming.id, state: "failure" as const, error: serializeFailure(cause, incoming.operation === "execute" ? incoming.serviceId : undefined) });
        }
        parentPort!.postMessage(response);
        if (incoming.operation === "close") parentPort!.close();
      });
    });
  }, (cause) => {
    parentPort!.postMessage(Object.freeze({ state: "startup-failure", error: serializeFailure(cause) }));
    parentPort!.close();
  });
}
