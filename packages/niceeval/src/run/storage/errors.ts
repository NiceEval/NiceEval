import type { RunReferenceDependency } from "./types.ts";

export type RunStorageErrorCode =
  | "run-not-found"
  | "run-not-active"
  | "writer-generation-mismatch"
  | "slot-not-found"
  | "slot-already-bound"
  | "attempt-already-published"
  | "attempt-not-published"
  | "source-run-deleted"
  | "absence-coverage-invalid"
  | "run-state-mismatch"
  | "run-delete-reference-conflict"
  | "recovery-evidence-required"
  | "publication-cutoff-restart-required"
  | "run-storage-invalid";

export class RunStorageError extends Error {
  readonly name = "RunStorageError";

  constructor(
    readonly code: RunStorageErrorCode,
    message: string,
    readonly dependencies: readonly RunReferenceDependency[] = Object.freeze([]),
  ) {
    super(message);
  }
}
