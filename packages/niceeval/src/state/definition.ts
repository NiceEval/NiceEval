import type { StateMigration, StateOperation, StateOperationKind, StateSchemaObject, StateServiceModule } from "./types.ts";

const ServiceIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const LogicalNamePattern = /^[a-z][a-z0-9_]*$/u;

function reject(message: string): never {
  throw new TypeError(`Invalid Service state module: ${message}`);
}

function assertTemplate(sql: string, label: string): void {
  if (sql.trim().length === 0) reject(`${label} is empty`);
  if (/\b(?:ATTACH|DETACH|TEMP(?:ORARY)?|VIEW|TRIGGER|VIRTUAL\s+TABLE)\b/iu.test(sql)) {
    reject(`${label} contains a forbidden SQLite object or ATTACH statement`);
  }
  if (/\b(?:load_extension|pragma_[a-z0-9_]+)\s*\(/iu.test(sql)) reject(`${label} invokes a forbidden SQLite function`);
}

function assertSchemaObject(object: StateSchemaObject, label: string): void {
  if (!LogicalNamePattern.test(object.logicalName)) reject(`${label} has an invalid logical name`);
  if (object.type === "index" && (object.tableLogicalName === undefined || !LogicalNamePattern.test(object.tableLogicalName))) {
    reject(`${label} index has no valid table logical name`);
  }
  assertTemplate(object.sql, label);
  if (!object.sql.includes("{{namespace}}")) reject(`${label} must use the Host namespace token`);
}

function assertMigration(migration: StateMigration, label: string): void {
  if (!Number.isSafeInteger(migration.from) || !Number.isSafeInteger(migration.to) || migration.to !== migration.from + 1 || migration.from < 0) {
    reject(`${label} is not an adjacent revision transition`);
  }
  if (migration.sql.length === 0) reject(`${label} has no checked-in SQL`);
  for (const sql of migration.sql) assertTemplate(sql, label);
  for (const object of migration.schema) assertSchemaObject(object, label);
}

function assertOperation(operation: StateOperation<string, unknown, unknown, StateOperationKind>, label: string): void {
  if (!LogicalNamePattern.test(operation.name)) reject(`${label} has an invalid operation name`);
  assertTemplate(operation.sql, label);
  if (operation.sql.includes(";")) reject(`${label} must contain one fixed prepared statement`);
  if (!operation.sql.includes("{{namespace}}")) reject(`${label} must use the Host namespace token`);
  if (operation.kind !== "run" && operation.decode === undefined) reject(`${label} has no typed row decoder`);
  if (operation.kind === "run" && operation.decode !== undefined) reject(`${label} must not decode rows`);
}

/** Freeze and validate a first-party module at application composition time. */
export function defineStateService<Operations extends readonly StateOperation<string, unknown, unknown, StateOperationKind>[]>(
  input: StateServiceModule<Operations>,
): StateServiceModule<Operations> {
  if (!ServiceIdPattern.test(input.serviceId)) reject("serviceId is not stable ASCII dotted identity");
  if (!Number.isSafeInteger(input.currentRevision) || input.currentRevision < 0) reject("currentRevision is invalid");
  const migrations = input.migrations;
  if (migrations.length !== input.currentRevision) reject("must declare one adjacent migration per revision");
  for (const [index, migration] of migrations.entries()) {
    assertMigration(migration, `migration ${migration.from}-to-${migration.to}`);
    if (migration.from !== index || migration.to !== index + 1) reject("migrations do not form a 0-to-current chain");
  }
  const names = new Set<string>();
  for (const operation of input.operations) {
    assertOperation(operation, `operation ${operation.name}`);
    if (names.has(operation.name)) reject(`operation ${operation.name} is duplicated`);
    names.add(operation.name);
  }
  // Keep the nominal module and operation identities intact: the Host uses
  // those identities to reject an operation from a different composition.
  for (const migration of migrations) {
    for (const object of migration.schema) Object.freeze(object);
    Object.freeze(migration.schema);
    Object.freeze(migration.sql);
    Object.freeze(migration);
  }
  for (const operation of input.operations) Object.freeze(operation);
  Object.freeze(input.migrations);
  Object.freeze(input.operations);
  return Object.freeze(input);
}
