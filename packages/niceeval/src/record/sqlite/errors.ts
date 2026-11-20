import { Data } from "effect";

export type SqliteRecordErrorCode =
  | "record-runtime-unsupported"
  | "record-database-invalid"
  | "record-schema-unsupported"
  | "record-write-busy"
  | "record-command-conflict"
  | "record-seal-incomplete"
  | "record-content-invalid"
  | "record-resource-limit-exceeded"
  | "record-sqlite-error";

export function isSqliteRecordErrorCode(value: unknown): value is SqliteRecordErrorCode {
  return (
    value === "record-runtime-unsupported" ||
    value === "record-database-invalid" ||
    value === "record-schema-unsupported" ||
    value === "record-write-busy" ||
    value === "record-command-conflict" ||
    value === "record-seal-incomplete" ||
    value === "record-content-invalid" ||
    value === "record-resource-limit-exceeded" ||
    value === "record-sqlite-error"
  );
}

export type SqliteRecordFailure = {
  readonly [Code in SqliteRecordErrorCode]: { readonly _tag: Code };
}[SqliteRecordErrorCode];

export class SqliteRecordError extends Data.TaggedError("SqliteRecordError")<{
  readonly reason: SqliteRecordFailure;
}> {
  readonly name = "SqliteRecordError";

  readonly code: SqliteRecordErrorCode;
  readonly operation: string;
  constructor(code: SqliteRecordErrorCode, operation: string, message: string, options?: ErrorOptions) {
    super({ reason: { _tag: code } });
    this.code = code;
    this.operation = operation;
    this.message = message;
    if (options !== undefined && "cause" in options) {
      Object.defineProperty(this, "cause", { value: options.cause, configurable: true, writable: true });
    }
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
  return (
    code === "ERR_SQLITE_ERROR" &&
    /(?:database is locked|database is busy)/iu.test(cause instanceof Error ? cause.message : "")
  );
}
