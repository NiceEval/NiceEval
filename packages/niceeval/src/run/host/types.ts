import { Data, type Effect } from "effect";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
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
  readonly invocationId?: string;
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
  ) => Effect.Effect<RunListResult, RunReadError, ProjectStateDatabase>;
  readonly get: (
    request: RunGetRequest,
  ) => Effect.Effect<RunResult, RunReadError, ProjectStateDatabase>;
  readonly delete: (
    request: RunDeleteRequest,
  ) => Effect.Effect<RunDeleteReceipt, RunDeleteError, ProjectStateDatabase>;
  readonly recover: (
    request: RunRecoverRequest,
  ) => Effect.Effect<RunRecoverReceipt, RunRecoverError, ProjectStateDatabase>;
}
