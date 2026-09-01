export type SqliteRecordErrorCode =
  | "record-runtime-unsupported"
  | "record-database-invalid"
  | "record-schema-unsupported"
  | "record-schema-migration-required"
  | "record-write-busy"
  | "record-command-conflict"
  | "record-seal-incomplete"
  | "record-content-invalid"
  | "record-resource-limit-exceeded"
  | "record-sqlite-error";

export function isSqliteRecordErrorCode(value: unknown): value is SqliteRecordErrorCode {
  return value === "record-runtime-unsupported" || value === "record-database-invalid" ||
    value === "record-schema-unsupported" || value === "record-schema-migration-required" ||
    value === "record-write-busy" ||
    value === "record-command-conflict" || value === "record-seal-incomplete" ||
    value === "record-content-invalid" || value === "record-resource-limit-exceeded" ||
    value === "record-sqlite-error";
}

export class SqliteRecordError extends Error {
  readonly name = "SqliteRecordError";

  constructor(
    readonly code: SqliteRecordErrorCode,
    readonly operation: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function sqliteError(
  code: SqliteRecordErrorCode,
  operation: string,
  message: string,
  cause?: unknown,
): SqliteRecordError {
  return new SqliteRecordError(code, operation, message, cause === undefined ? undefined : { cause });
}

export function sqliteErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const code = Reflect.get(cause, "code");
  return typeof code === "string" ? code : undefined;
}

export function isSqliteBusy(cause: unknown): boolean {
  const code = sqliteErrorCode(cause);
  return code === "ERR_SQLITE_ERROR" && /(?:database is locked|database is busy)/iu.test(
    cause instanceof Error ? cause.message : "",
  );
}
