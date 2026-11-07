import { OPEN_SANDBOX_CACHE_REPOSITORY, openSandboxCacheRepositoryHandler } from "../../sandbox/opensandbox/repository.ts";
import {
  DOCKER_CACHE_REPOSITORY,
  dockerCacheRepositoryHandler,
} from "../../sandbox/docker-cache-repository.ts";
import {
  E2B_CACHE_REPOSITORY,
  e2bCacheRepositoryHandler,
} from "../../sandbox/e2b-cache-repository.ts";
import {
  INCUS_REPOSITORY,
  incusRepositoryHandler,
} from "../../sandbox/incus/repository.ts";
import {
  DURABLE_STATE_REPOSITORY,
  type UserDatabaseRepositoryRequest,
  type UserDatabaseRepositoryResult,
} from "../protocol.ts";
import { durableStateRepositoryHandler } from "./durable-state.ts";
import { BEFORE_CACHE_SNAPSHOTS_REPOSITORY } from "../../sandbox/remote-snapshot/ledger.ts";
import { beforeCacheSnapshotRepositoryHandler } from "../../sandbox/remote-snapshot/ledger-storage.ts";

export const userDatabaseRepositoryCatalog = Object.freeze([
  durableStateRepositoryHandler,
  dockerCacheRepositoryHandler,
  e2bCacheRepositoryHandler,
  incusRepositoryHandler,
  openSandboxCacheRepositoryHandler,
  beforeCacheSnapshotRepositoryHandler,
]);

export function repositoryHandlerFor(request: UserDatabaseRepositoryRequest) {
  switch (request.repository) {
    case DURABLE_STATE_REPOSITORY:
      return durableStateRepositoryHandler;
    case DOCKER_CACHE_REPOSITORY:
      return dockerCacheRepositoryHandler;
    case E2B_CACHE_REPOSITORY:
      return e2bCacheRepositoryHandler;
    case OPEN_SANDBOX_CACHE_REPOSITORY:
      return openSandboxCacheRepositoryHandler;
    case INCUS_REPOSITORY:
      return incusRepositoryHandler;
    case BEFORE_CACHE_SNAPSHOTS_REPOSITORY:
      return beforeCacheSnapshotRepositoryHandler;
  }
}

export function dispatchUserDatabaseRepository(
  database: DatabaseSync,
  request: UserDatabaseRepositoryRequest,
): UserDatabaseRepositoryResult {
  switch (request.repository) {
    case DURABLE_STATE_REPOSITORY:
      return durableStateRepositoryHandler.dispatch(database, request);
    case DOCKER_CACHE_REPOSITORY:
      return dockerCacheRepositoryHandler.dispatch(database, request);
    case E2B_CACHE_REPOSITORY:
      return e2bCacheRepositoryHandler.dispatch(database, request);
    case OPEN_SANDBOX_CACHE_REPOSITORY:
      return openSandboxCacheRepositoryHandler.dispatch(database, request);
    case INCUS_REPOSITORY:
      return incusRepositoryHandler.dispatch(database, request);
    case BEFORE_CACHE_SNAPSHOTS_REPOSITORY:
      return beforeCacheSnapshotRepositoryHandler.dispatch(database, request);
  }
}
import type { DatabaseSync } from "node:sqlite";
