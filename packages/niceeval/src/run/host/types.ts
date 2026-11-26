import { Data, type Effect } from "effect";
import type { RunStorageCommandError } from "../storage/sqlite.ts";
import type { PublicationCutoff, RunDetail, RunState, RunSummary } from "../protocol.ts";

export type { RunDetail, RunSlot, RunState, RunSummary } from "../protocol.ts";

/** Selects a project Run listing with optional Invocation filter and continuation; preserve the returned continuation rather than deriving one from IDs. */
export interface RunListRequest {
  readonly cwd: string;
  /** Select exactly one Invocation, as with `run list --invocation`. */
  readonly invocationId?: string | undefined;
  /** Include any selected state; provide at least one when filtering. */
  readonly states?: readonly [RunState, ...RunState[]] | undefined;
  /** Match an Experiment ID path prefix, as with `run list --experiment`. */
  readonly experimentIdPrefix?: string | undefined;
  /** Keep the newest n matching Runs; must be a positive safe integer. */
  readonly limit?: number | undefined;
  readonly continuation?: string | undefined;
}

/** Selects an exact Run ID in the project at cwd; this is not an Experiment prefix or Attempt locator. */
export interface RunGetRequest {
  readonly cwd: string;
  readonly runId: string;
}

/** Selects an exact Run to delete in the project at cwd; deletion is subject to lifecycle and reference checks. */
export interface RunDeleteRequest extends RunGetRequest {}

/** Selects an exact Run for abandoned-owner recovery; selecting it does not itself prove the owner has terminated. */
export interface RunRecoverRequest extends RunGetRequest {}

/** Returns one Run page at a publication cutoff with an optional next-page continuation; active Runs may already contain readable published Attempts. */
export interface RunListResult {
  readonly operation: "run.list";
  readonly publicationCutoff: PublicationCutoff;
  readonly runs: readonly RunSummary[];
  /** Count matching Runs excluded by limit at this publication cutoff. */
  readonly omitted: number;
  readonly continuation: string | undefined;
}

/** Returns exact Run detail at a publication cutoff; Run completion state is separate from individual Attempt Verdicts. */
export interface RunResult {
  readonly operation: "run.get";
  readonly publicationCutoff: RunListResult["publicationCutoff"];
  readonly run: RunDetail;
}

/** Confirms deletion of the selected Run; it is distinct from interrupting or recovering an active owner. */
export interface RunDeleteReceipt {
  readonly runId: string;
  readonly state: "deleted";
}

/** Confirms the terminal Run state after recovery; repairing abandoned terminal work preserves its existing state and published Attempts. */
export interface RunRecoverReceipt {
  readonly runId: string;
  readonly state: "completed" | "interrupted" | "failed";
}

/** Reports a refused or failed Run read with a domain code; missing Runs are errors rather than fabricated empty results. */
export class RunReadError extends Data.TaggedError("RunReadError")<{
  readonly operation: "list" | "get";
  readonly code:
    | "run-id-invalid"
    | "run-not-found"
    | "run-continuation-invalid"
    | "run-invocation-filter-unavailable"
    | "run-filter-invalid"
    | "run-read-failed";
  readonly message: string;
  readonly cause: RunStorageCommandError | undefined;
}> {}

/** Reports a refused or failed Run deletion. */
export class RunDeleteError extends Data.TaggedError("RunDeleteError")<{
  readonly operation: "delete";
  readonly code:
    | "run-id-invalid"
    | "run-not-found"
    | "run-active"
    | "run-referenced"
    | "run-lease-recovery-required"
    | "run-session-recovery-required"
    | "run-lifecycle-adapter-unavailable"
    | "run-delete-failed";
  readonly message: string;
  readonly cause: RunStorageCommandError | undefined;
}> {}

/** Reports refused or failed recovery; owner termination must be established before an abandoned Run can be recovered. */
export class RunRecoverError extends Data.TaggedError("RunRecoverError")<{
  readonly operation: "recover";
  readonly code:
    | "run-id-invalid"
    | "run-not-found"
    | "run-terminal"
    | "run-owner-active"
    | "run-owner-termination-unproven"
    | "run-lifecycle-adapter-unavailable"
    | "run-recover-failed";
  readonly message: string;
  readonly cause: RunStorageCommandError | undefined;
}> {}

/** Provides lazy Node Host operations for listing, reading, deleting and recovering Runs; each execution owns and closes its resources. */
export interface RunHost {
  readonly list: (request: RunListRequest) => Effect.Effect<RunListResult, RunReadError>;
  readonly get: (request: RunGetRequest) => Effect.Effect<RunResult, RunReadError>;
  readonly delete: (request: RunDeleteRequest) => Effect.Effect<RunDeleteReceipt, RunDeleteError>;
  readonly recover: (request: RunRecoverRequest) => Effect.Effect<RunRecoverReceipt, RunRecoverError>;
}
