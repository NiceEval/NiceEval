import { Data } from "effect";

export class RepoToolError extends Data.TaggedError("RepoToolError")<{
  readonly operation: string;
  readonly message: string;
  readonly path?: string;
}> {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderRepoToolError(error: RepoToolError): string {
  const target = error.path ? ` ${error.path}` : "";
  return `repo-tools: ${error.operation}${target}: ${error.message}\n`;
}
