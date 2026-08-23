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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
