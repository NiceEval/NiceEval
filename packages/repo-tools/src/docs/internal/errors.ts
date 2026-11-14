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

/** Retain the existing CLI failure envelope and single-line human feedback. */
export function renderDocsDomainFailure(error: DocsDomainError, json: boolean): string {
  const failure = {
    ok: false,
    error: error._tag,
    message: error.message === "" ? error._tag : error.message,
    ...("path" in error ? { details: { path: error.path } } : {}),
  };
  return json
    ? `${JSON.stringify(failure)}\n`
    : `${`${failure.error}: ${failure.message}`.replace(/\s*\n\s*/gu, " ")}\n`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
