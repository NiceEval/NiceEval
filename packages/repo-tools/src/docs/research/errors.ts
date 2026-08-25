import { Data } from "effect";

export class ResearchInputError extends Data.TaggedError("ResearchInputError")<{
  readonly message: string;
}> {}

export class ResearchPathError extends Data.TaggedError("ResearchPathError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class ResearchConflictError extends Data.TaggedError("ResearchConflictError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class ResearchFileError extends Data.TaggedError("ResearchFileError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class ResearchFormatError extends Data.TaggedError("ResearchFormatError")<{
  readonly path: string;
  readonly message: string;
}> {}

export type ResearchError =
  | ResearchInputError
  | ResearchPathError
  | ResearchConflictError
  | ResearchFileError
  | ResearchFormatError;

export function researchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
