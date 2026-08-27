import type {
  DockerCacheRepositoryRequest,
  DockerCacheRepositoryResult,
  DockerCacheResultFor,
} from "../sandbox/docker-cache-repository.ts";
import type {
  E2BCacheRequest,
  E2BCacheResult,
  E2BCacheResultFor,
} from "../sandbox/e2b-cache-repository.ts";
import type {
  IncusRepositoryRequest,
  IncusRepositoryResult,
  IncusRepositoryResultFor,
} from "../sandbox/incus/repository.ts";

export const DURABLE_STATE_REPOSITORY = "durable-state" as const;

export interface DurableStateEntry {
  readonly key: string;
  readonly value: string;
}

export type DurableStateRequest =
  | { readonly repository: typeof DURABLE_STATE_REPOSITORY; readonly operation: "put"; readonly key: string; readonly value: string }
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
  | E2BCacheRequest
  | IncusRepositoryRequest;

export type UserDatabaseRepositoryResult =
  | { readonly repository: typeof DURABLE_STATE_REPOSITORY; readonly operation: "put"; readonly changes: number }
  | { readonly repository: typeof DURABLE_STATE_REPOSITORY; readonly operation: "get"; readonly entry: DurableStateEntry | null }
  | { readonly repository: typeof DURABLE_STATE_REPOSITORY; readonly operation: "list"; readonly entries: readonly DurableStateEntry[] }
  | DockerCacheRepositoryResult
  | E2BCacheResult
  | IncusRepositoryResult;

export type UserDatabaseResultFor<Request extends UserDatabaseRepositoryRequest> =
  Request extends DurableStateRequest
    ? Extract<UserDatabaseRepositoryResult, {
        readonly repository: typeof DURABLE_STATE_REPOSITORY;
        readonly operation: Request["operation"];
      }>
    : Request extends DockerCacheRepositoryRequest
      ? DockerCacheResultFor<Request>
      : Request extends E2BCacheRequest
        ? E2BCacheResultFor<Request>
        : Request extends IncusRepositoryRequest
          ? IncusRepositoryResultFor<Request>
          : never;

export type UserDatabaseWorkerRequest =
  | { readonly id: number; readonly kind: "repository"; readonly request: UserDatabaseRepositoryRequest }
  | { readonly id: number; readonly kind: "maintenance"; readonly operation: "migrate-all" }
  | { readonly id: number; readonly kind: "close" };

export type UserDatabaseWorkerRequestWithoutId = UserDatabaseWorkerRequest extends infer Request
  ? Request extends UserDatabaseWorkerRequest ? Omit<Request, "id"> : never
  : never;

export interface UserDatabaseWorkerData {
  readonly databasePath: string;
  readonly legacyPath: string;
  readonly busyTimeoutMs: number;
}

export interface UserDatabaseWorkerFailure {
  readonly code: "user-database-invalid" | "user-database-busy" | "user-database-unsupported" | "user-database-legacy-found";
  readonly message: string;
  readonly repository?: string;
  readonly databaseRevision?: number;
  readonly supportedRevision?: number;
  readonly legacyPath?: string;
  readonly databasePath?: string;
}

export type UserDatabaseWorkerStartup =
  | { readonly state: "ready" }
  | { readonly state: "startup-failure"; readonly error: UserDatabaseWorkerFailure };

export type UserDatabaseWorkerResponse =
  | { readonly id: number; readonly state: "success"; readonly result: UserDatabaseRepositoryResult | { readonly kind: "void" } }
  | { readonly id: number; readonly state: "failure"; readonly error: UserDatabaseWorkerFailure };
