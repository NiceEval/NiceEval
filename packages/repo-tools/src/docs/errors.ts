import { Data } from "effect";

export class DocsDecodeError extends Data.TaggedError("DocsDecodeError")<{
  readonly source: string;
  readonly message: string;
}> {}

export class DocsFileError extends Data.TaggedError("DocsFileError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class DocsPathError extends Data.TaggedError("DocsPathError")<{
  readonly path: string;
  readonly reason: string;
}> {}

export class DocsConflictError extends Data.TaggedError("DocsConflictError")<{
  readonly operation: string;
  readonly conflicts: readonly string[];
}> {}

export class DocsProcessError extends Data.TaggedError("DocsProcessError")<{
  readonly command: string;
  readonly exitCode?: number;
  readonly message: string;
}> {}

export class DocsWorkError extends Data.TaggedError("DocsWorkError")<{
  readonly operation: string;
  readonly runId?: string;
  readonly itemId?: string;
  readonly reasons: readonly string[];
  readonly receipt?: unknown;
}> {}

export type DocsDomainError =
  | DocsDecodeError
  | DocsFileError
  | DocsPathError
  | DocsConflictError
  | DocsProcessError
  | DocsWorkError;

export function renderDocsDomainError(error: DocsDomainError): string {
  switch (error._tag) {
    case "DocsDecodeError":
      return `${error._tag}: ${error.source}: ${error.message}`;
    case "DocsFileError":
      return `${error._tag}: ${error.operation} ${error.path}: ${error.message}`;
    case "DocsPathError":
      return `${error._tag}: ${error.path}: ${error.reason}`;
    case "DocsConflictError":
      return `${error._tag}: ${error.operation}:\n${error.conflicts.map((conflict) => `  ${conflict}`).join("\n")}`;
    case "DocsProcessError":
      return `${error._tag}: ${error.command}${error.exitCode === undefined ? "" : ` exited with status ${error.exitCode}`}: ${error.message}`;
    case "DocsWorkError": {
      const subject = [error.runId, error.itemId].filter((value) => value !== undefined).join("/");
      return `${error._tag}: ${error.operation}${subject === "" ? "" : ` ${subject}`}:\n${error.reasons.map((reason) => `  ${reason}`).join("\n")}`;
    }
  }
}

export function docsDomainErrorDocument(error: DocsDomainError): object {
  switch (error._tag) {
    case "DocsDecodeError":
      return { _tag: error._tag, source: error.source, message: error.message };
    case "DocsFileError":
      return { _tag: error._tag, operation: error.operation, path: error.path, message: error.message };
    case "DocsPathError":
      return { _tag: error._tag, path: error.path, reason: error.reason };
    case "DocsConflictError":
      return { _tag: error._tag, operation: error.operation, conflicts: error.conflicts };
    case "DocsProcessError":
      return {
        _tag: error._tag,
        command: error.command,
        ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
        message: error.message,
      };
    case "DocsWorkError":
      return {
        _tag: error._tag,
        operation: error.operation,
        ...(error.runId === undefined ? {} : { runId: error.runId }),
        ...(error.itemId === undefined ? {} : { itemId: error.itemId }),
        reasons: error.reasons,
        ...(error.receipt === undefined ? {} : { receipt: error.receipt }),
      };
  }
}

export function renderDocsDomainFailure(error: DocsDomainError, json: boolean): string {
  return json
    ? `${JSON.stringify({ ok: false, error: docsDomainErrorDocument(error) }, null, 2)}\n`
    : `${renderDocsDomainError(error)}\n`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
