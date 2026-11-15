import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { isExternalCause } from "../shared/external-cause.ts";
import type {
  DockerCacheRepositoryRequest,
  DockerCacheRepositoryResult,
  DockerCacheResultFor,
} from "../sandbox/docker-cache-repository.ts";
import type {
  IncusRepositoryRequest,
  IncusRepositoryResult,
  IncusRepositoryResultFor,
} from "../sandbox/incus/repository.ts";
import type {
  BeforeCacheSnapshotRepositoryRequest,
  BeforeCacheSnapshotRepositoryResult,
} from "../sandbox/remote-snapshot/ledger.ts";

export const DURABLE_STATE_REPOSITORY = "durable-state" as const;

export interface DurableStateEntry {
  readonly key: string;
  readonly value: string;
}

export type DurableStateRequest =
  | {
      readonly repository: typeof DURABLE_STATE_REPOSITORY;
      readonly operation: "put";
      readonly key: string;
      readonly value: string;
    }
  | { readonly repository: typeof DURABLE_STATE_REPOSITORY; readonly operation: "get"; readonly key: string }
  | { readonly repository: typeof DURABLE_STATE_REPOSITORY; readonly operation: "list" };

/**
 * Closed, first-party transport vocabulary. Adding Docker, E2B, or Incus state
 * means adding a concrete request family and a statically composed handler.
 * There is deliberately no runtime registration or SQL-bearing request.
 */
export type UserDatabaseRepositoryRequest =
  | DurableStateRequest
  | DockerCacheRepositoryRequest
  | IncusRepositoryRequest
  | BeforeCacheSnapshotRepositoryRequest;

export type UserDatabaseRepositoryResult =
  | { readonly repository: typeof DURABLE_STATE_REPOSITORY; readonly operation: "put"; readonly changes: number }
  | {
      readonly repository: typeof DURABLE_STATE_REPOSITORY;
      readonly operation: "get";
      readonly entry: DurableStateEntry | null;
    }
  | {
      readonly repository: typeof DURABLE_STATE_REPOSITORY;
      readonly operation: "list";
      readonly entries: readonly DurableStateEntry[];
    }
  | DockerCacheRepositoryResult
  | IncusRepositoryResult
  | BeforeCacheSnapshotRepositoryResult;

export type UserDatabaseResultFor<Request extends UserDatabaseRepositoryRequest> = Request extends DurableStateRequest
  ? Extract<
      UserDatabaseRepositoryResult,
      {
        readonly repository: typeof DURABLE_STATE_REPOSITORY;
        readonly operation: Request["operation"];
      }
    >
  : Request extends DockerCacheRepositoryRequest
    ? DockerCacheResultFor<Request>
    : Request extends IncusRepositoryRequest
      ? IncusRepositoryResultFor<Request>
      : Request extends BeforeCacheSnapshotRepositoryRequest
        ? BeforeCacheSnapshotRepositoryResult
        : never;

export type UserDatabaseWorkerRequest =
  | { readonly id: number; readonly kind: "repository"; readonly request: UserDatabaseRepositoryRequest }
  | { readonly id: number; readonly kind: "close" };

export type UserDatabaseWorkerRequestWithoutId = UserDatabaseWorkerRequest extends infer Request
  ? Request extends UserDatabaseWorkerRequest
    ? Omit<Request, "id">
    : never
  : never;

export interface UserDatabaseWorkerData {
  readonly databasePath: string;
  readonly legacyPath: string;
  readonly busyTimeoutMs: number;
}

const ExternalCauseSchema = Schema.declare(isExternalCause);
const FailureCauseSchema = Schema.UndefinedOr(ExternalCauseSchema);
const RepositoryFailureFields = {
  scope: Schema.Literal("repository"),
  repository: Schema.String,
  message: Schema.String,
  cause: FailureCauseSchema,
};
const HostFailureFields = {
  scope: Schema.Literal("host"),
  message: Schema.String,
  cause: FailureCauseSchema,
};

/** Host failures have no repository fact; repository failures always carry the real owner. */
export const UserDatabaseWorkerFailureSchema = Schema.Union([
  Schema.Struct({ ...RepositoryFailureFields, code: Schema.Literal("user-database-invalid") }),
  Schema.Struct({ ...RepositoryFailureFields, code: Schema.Literal("user-database-busy") }),
  Schema.Struct({ ...HostFailureFields, code: Schema.Literal("user-database-invalid") }),
  Schema.Struct({ ...HostFailureFields, code: Schema.Literal("user-database-busy") }),
  Schema.Struct({
    code: Schema.Literal("user-database-unsupported"),
    message: Schema.String,
    repository: Schema.String,
    databasePath: Schema.String,
    cause: FailureCauseSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("user-database-legacy-found"),
    message: Schema.String,
    legacyPath: Schema.String,
    databasePath: Schema.String,
  }),
]);

export type UserDatabaseWorkerFailure = typeof UserDatabaseWorkerFailureSchema.Type;
const decodeUserDatabaseWorkerFailure = Schema.decodeUnknownOption(UserDatabaseWorkerFailureSchema, {
  onExcessProperty: "error",
});
export function isUserDatabaseWorkerFailure(value: unknown): value is UserDatabaseWorkerFailure {
  return Option.isSome(decodeUserDatabaseWorkerFailure(value));
}

export type UserDatabaseWorkerStartup =
  | { readonly state: "ready" }
  | { readonly state: "startup-failure"; readonly error: UserDatabaseWorkerFailure };

export type UserDatabaseWorkerResponse =
  | {
      readonly id: number;
      readonly state: "success";
      readonly result: UserDatabaseRepositoryResult | { readonly kind: "void" };
    }
  | { readonly id: number; readonly state: "failure"; readonly error: UserDatabaseWorkerFailure };
