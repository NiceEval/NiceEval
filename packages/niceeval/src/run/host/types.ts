import { Data, type Effect } from "effect";
import type {
  PublicationCutoff,
  RunDetail,
  RunSlot,
  RunState,
  RunSummary,
} from "../protocol.ts";

export type { RunDetail, RunSlot, RunState, RunSummary } from "../protocol.ts";

export interface RunListRequest {
  readonly cwd: string;
  /** Select exactly one Invocation, as with `run list --invocation`. */
  readonly invocationId?: string;
  /** Include any selected state; provide at least one when filtering. */
  readonly states?: readonly [RunState, ...RunState[]];
  /** Match an Experiment ID path prefix, as with `run list --experiment`. */
  readonly experimentIdPrefix?: string;
  /** Keep the newest n matching Runs; must be a positive safe integer. */
  readonly limit?: number;
  readonly continuation?: string;
}

export interface RunGetRequest {
  readonly cwd: string;
  readonly runId: string;
}

export interface RunDeleteRequest extends RunGetRequest {}

export interface RunRecoverRequest extends RunGetRequest {}

export interface RunListResult {
  readonly operation: "run.list";
  readonly publicationCutoff: PublicationCutoff;
  readonly runs: readonly RunSummary[];
  /** Count matching Runs excluded by limit at this publication cutoff. */
  readonly omitted: number;
  readonly continuation?: string;
}

export interface RunResult {
  readonly operation: "run.get";
  readonly publicationCutoff: RunListResult["publicationCutoff"];
  readonly run: RunDetail;
}

export interface RunDeleteReceipt {
  readonly runId: string;
  readonly state: "deleted";
}

export interface RunRecoverReceipt {
  readonly runId: string;
  readonly state: "interrupted";
}

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
  readonly cause?: unknown;
}> {}

export class RunDeleteError extends Data.TaggedError("RunDeleteError")<{
  readonly operation: "delete";
  readonly code:
    | "run-id-invalid"
    | "run-not-found"
    | "run-active"
    | "run-referenced"
    | "run-lifecycle-adapter-unavailable"
    | "run-delete-failed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

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
  readonly cause?: unknown;
}> {}

export interface RunHost {
  readonly list: (
    request: RunListRequest,
  ) => Effect.Effect<RunListResult, RunReadError>;
  readonly get: (
    request: RunGetRequest,
  ) => Effect.Effect<RunResult, RunReadError>;
  readonly delete: (
    request: RunDeleteRequest,
  ) => Effect.Effect<RunDeleteReceipt, RunDeleteError>;
  readonly recover: (
    request: RunRecoverRequest,
  ) => Effect.Effect<RunRecoverReceipt, RunRecoverError>;
}
