import { Data, type Effect } from "effect";

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

export type RunState = "active" | "completed" | "interrupted" | "failed";

export type RunSlot = Readonly<{
  slotId: string;
  evalId: string;
  attemptOrdinal: number;
  executionIdentityDigest: string;
  publication:
    | { readonly state: "pending" }
    | {
        readonly state: "published";
        readonly action: "executed" | "carried" | "accepted";
        readonly attemptId: string;
        readonly attemptLocator: string;
        readonly originRunId: string;
        readonly originSlotId: string;
      }
    | {
        readonly state: "absent";
        readonly reason:
          | "early-exit-satisfied"
          | "budget-exhausted"
          | "stopped-by-failure"
          | "interrupted-before-publication"
          | "dispatch-failed";
      };
}>;

export interface RunSummary {
  readonly runId: string;
  readonly invocationId: string;
  readonly experimentId: string;
  readonly state: RunState;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly coverage: {
    readonly published: number;
    readonly expected: number;
    readonly missing: number;
  };
}

export interface RunDetail extends RunSummary {
  readonly slots: readonly RunSlot[];
}

export interface RunListResult {
  readonly operation: "run.list";
  readonly publicationCutoff: {
    readonly identity: string;
    readonly revision: number;
  };
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
