import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

export interface SqliteMigration {
  readonly version: number;
  readonly digest: string;
  readonly apply: (database: DatabaseSync) => void;
}

export type SqliteMigrationStatus = "bootstrapped" | "migrated" | "current";

export interface SqliteMigrationKernelResult {
  readonly status: SqliteMigrationStatus;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly receipts: readonly { readonly version: number; readonly digest: string }[];
}

export type SqliteMigrationFailureReason =
  | "active-transaction"
  | "ledger-schema-invalid"
  | "receipt-version-ahead"
  | "receipt-discontinuous"
  | "receipt-digest-mismatch"
  | "admission-changed"
  | "begin-failure"
  | "apply-failure"
  | "commit-failure"
  | "rollback-failure";

export class SqliteMigrationKernelFailure extends Error {
  readonly name = "SqliteMigrationKernelFailure";
  constructor(
    readonly reason: SqliteMigrationFailureReason,
    message: string,
    readonly cause?: unknown,
    readonly rollbackCause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

const DigestPattern = /^[a-f0-9]{64}$/u;
const IdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function quotedIdentifier(identifier: string): string {
  if (!IdentifierPattern.test(identifier)) {
    throw new TypeError("SQLite migration ledger table must be a validated identifier");
  }
  return `"${identifier}"`;
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+$/u, "").replace(/\s+/gu, " ");
}

export function sqliteMigrationLedgerSql(tableName: string): string {
  const table = quotedIdentifier(tableName);
  return `CREATE TABLE ${table} (version INTEGER PRIMARY KEY CHECK (version > 0), applied_at TEXT NOT NULL, migration_digest TEXT NOT NULL CHECK (length(migration_digest) = 64)) STRICT`;
}

export function defineSqliteMigrationCatalog(
  migrations: readonly SqliteMigration[],
  currentVersion: number,
): readonly SqliteMigration[] {
  if (migrations.length !== currentVersion) {
    throw new TypeError("SQLite migration catalog does not end at the current version");
  }
  const digests = new Set<string>();
  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) throw new TypeError("SQLite migration catalog versions must be continuous from 1");
    if (!DigestPattern.test(migration.digest)) throw new TypeError("SQLite migration digest must be a lowercase sha256");
    if (digests.has(migration.digest)) throw new TypeError("SQLite migration digests must be unique");
    digests.add(migration.digest);
  }
  return Object.freeze([...migrations]);
}

function ledgerExists(database: DatabaseSync, tableName: string): boolean {
  const row = database.prepare("SELECT type, sql FROM sqlite_schema WHERE name = ?").get(tableName) as
    | Record<string, SQLOutputValue>
    | undefined;
  return row !== undefined;
}

export function inspectSqliteMigrationLedger(
  database: DatabaseSync,
  tableName: string,
  catalog: readonly SqliteMigration[],
): number {
  const table = quotedIdentifier(tableName);
  const rows = database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name = ? OR tbl_name = ? ORDER BY type, name")
    .all(tableName, tableName) as unknown as readonly Record<string, SQLOutputValue>[];
  const schema = rows.length === 1 ? rows[0] : undefined;
  if (schema === undefined || schema.type !== "table" || schema.name !== tableName || schema.tbl_name !== tableName ||
    typeof schema.sql !== "string" || normalizeSql(schema.sql) !== normalizeSql(sqliteMigrationLedgerSql(tableName))) {
    throw new SqliteMigrationKernelFailure("ledger-schema-invalid", "SQLite migration ledger schema is invalid");
  }
  const receipts = database.prepare(`SELECT version, migration_digest FROM ${table} ORDER BY version`).all() as unknown as readonly Record<string, SQLOutputValue>[];
  const versions = receipts.map((receipt) => typeof receipt.version === "bigint" ? Number(receipt.version) : receipt.version);
  if (versions.some((version) => typeof version === "number" && version > catalog.length)) {
    throw new SqliteMigrationKernelFailure("receipt-version-ahead", "SQLite migration receipts are ahead of this catalog");
  }
  for (const [index, receipt] of receipts.entries()) {
    const version = versions[index];
    if (version !== index + 1) {
      throw new SqliteMigrationKernelFailure("receipt-discontinuous", "SQLite migration receipts are discontinuous");
    }
    if (receipt.migration_digest !== catalog[index]?.digest) {
      throw new SqliteMigrationKernelFailure("receipt-digest-mismatch", "SQLite migration receipt digest does not match the catalog");
    }
  }
  return receipts.length;
}

function rollback(database: DatabaseSync, original: unknown): never {
  if (!database.isTransaction) throw original;
  try {
    database.exec("ROLLBACK");
  } catch (rollbackCause) {
    throw new SqliteMigrationKernelFailure(
      "rollback-failure",
      "SQLite migration failed and rollback also failed",
      original,
      rollbackCause,
    );
  }
  throw original;
}

export function migrateSqliteDatabase(input: {
  readonly database: DatabaseSync;
  readonly ledgerTable: string;
  readonly catalog: readonly SqliteMigration[];
  readonly expectedFromVersion: number;
  readonly bootstrapping: boolean;
  readonly acceptConcurrentBootstrapCurrent?: boolean;
  readonly appliedAt: () => string;
  readonly validateCurrent: () => void;
}): SqliteMigrationKernelResult {
  const { database, ledgerTable, catalog, expectedFromVersion } = input;
  const table = quotedIdentifier(ledgerTable);
  if (database.isTransaction) {
    throw new SqliteMigrationKernelFailure("active-transaction", "SQLite migration cannot start inside an active transaction");
  }

  if (!input.bootstrapping) {
    const currentVersion = inspectSqliteMigrationLedger(database, ledgerTable, catalog);
    if (currentVersion === catalog.length) {
      input.validateCurrent();
      return Object.freeze({ status: "current", fromVersion: currentVersion, toVersion: currentVersion, receipts: catalogReceipts(catalog) });
    }
  }

  try {
    database.exec("BEGIN IMMEDIATE");
  } catch (cause) {
    throw new SqliteMigrationKernelFailure("begin-failure", "SQLite migration could not begin", cause);
  }
  try {
    if (input.bootstrapping && !ledgerExists(database, ledgerTable)) database.exec(sqliteMigrationLedgerSql(ledgerTable));
    const admittedVersion = inspectSqliteMigrationLedger(database, ledgerTable, catalog);
    if (admittedVersion !== expectedFromVersion) {
      if (input.acceptConcurrentBootstrapCurrent === true && input.bootstrapping && expectedFromVersion === 0 &&
        admittedVersion === catalog.length) {
        input.validateCurrent();
        try {
          database.exec("COMMIT");
        } catch (cause) {
          throw new SqliteMigrationKernelFailure("commit-failure", "SQLite migration commit failed", cause);
        }
        return Object.freeze({
          status: "current",
          fromVersion: admittedVersion,
          toVersion: admittedVersion,
          receipts: catalogReceipts(catalog),
        });
      }
      throw new SqliteMigrationKernelFailure("admission-changed", "SQLite migration admission changed after the write lock was acquired");
    }
    for (const migration of catalog) {
      if (migration.version <= admittedVersion) continue;
      try {
        migration.apply(database);
        database.prepare(`INSERT INTO ${table}(version, applied_at, migration_digest) VALUES (?, ?, ?)`)
          .run(migration.version, input.appliedAt(), migration.digest);
      } catch (cause) {
        throw cause instanceof SqliteMigrationKernelFailure
          ? cause
          : new SqliteMigrationKernelFailure("apply-failure", `SQLite migration ${migration.version} failed`, cause);
      }
    }
    input.validateCurrent();
    try {
      database.exec("COMMIT");
    } catch (cause) {
      throw new SqliteMigrationKernelFailure("commit-failure", "SQLite migration commit failed", cause);
    }
  } catch (cause) {
    return rollback(database, cause);
  }
  return Object.freeze({
    status: input.bootstrapping ? "bootstrapped" : "migrated",
    fromVersion: expectedFromVersion,
    toVersion: catalog.length,
    receipts: catalogReceipts(catalog),
  });
}

function catalogReceipts(catalog: readonly SqliteMigration[]): readonly { readonly version: number; readonly digest: string }[] {
  return Object.freeze(catalog.map(({ version, digest }) => Object.freeze({ version, digest })));
}
