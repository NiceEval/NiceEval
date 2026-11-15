import { Data } from "effect";
import type { RunReferenceDependency } from "./types.ts";

export type RunStorageErrorCode =
  | "run-id-collision"
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

export type RunStorageFailure = {
  readonly [Code in RunStorageErrorCode]: { readonly _tag: Code };
}[RunStorageErrorCode];

export class RunStorageError extends Data.TaggedError("RunStorageError")<{
  readonly reason: RunStorageFailure;
}> {
  readonly name = "RunStorageError";

  constructor(
    readonly code: RunStorageErrorCode,
    message: string,
    readonly dependencies: readonly RunReferenceDependency[] = [],
  ) {
    super({ reason: { _tag: code } });
    this.message = message;
  }
}
