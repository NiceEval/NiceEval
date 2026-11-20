import { Data } from "effect";
import type { RunReferenceDependency } from "./types.ts";

export const RUN_STORAGE_ERROR_CODES = [
  "run-id-collision",
  "run-not-found",
  "run-not-active",
  "writer-generation-mismatch",
  "slot-not-found",
  "slot-already-bound",
  "attempt-already-published",
  "attempt-not-published",
  "source-run-deleted",
  "absence-coverage-invalid",
  "run-state-mismatch",
  "run-delete-reference-conflict",
  "recovery-evidence-required",
  "publication-cutoff-restart-required",
  "run-storage-invalid",
] as const;

export type RunStorageErrorCode = (typeof RUN_STORAGE_ERROR_CODES)[number];

export type RunStorageFailure = {
  readonly [Code in RunStorageErrorCode]: { readonly _tag: Code };
}[RunStorageErrorCode];

export class RunStorageError extends Data.TaggedError("RunStorageError")<{
  readonly reason: RunStorageFailure;
}> {
  readonly name = "RunStorageError";

  readonly code: RunStorageErrorCode;
  readonly dependencies: readonly RunReferenceDependency[];
  constructor(code: RunStorageErrorCode, message: string, dependencies: readonly RunReferenceDependency[] = []) {
    super({ reason: { _tag: code } });
    this.code = code;
    this.dependencies = dependencies;
    this.message = message;
  }
}
