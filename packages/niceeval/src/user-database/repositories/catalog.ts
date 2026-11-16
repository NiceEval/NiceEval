import { DOCKER_CACHE_REPOSITORY, dockerCacheRepositoryHandler } from "../../sandbox/docker-cache-repository.ts";
import { INCUS_REPOSITORY, incusRepositoryHandler } from "../../sandbox/incus/repository.ts";
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
  incusRepositoryHandler,
  beforeCacheSnapshotRepositoryHandler,
]);

export function repositoryHandlerFor(request: UserDatabaseRepositoryRequest) {
  switch (request.repository) {
    case DURABLE_STATE_REPOSITORY:
      return durableStateRepositoryHandler;
    case DOCKER_CACHE_REPOSITORY:
      return dockerCacheRepositoryHandler;
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
    case INCUS_REPOSITORY:
      return incusRepositoryHandler.dispatch(database, request);
    case BEFORE_CACHE_SNAPSHOTS_REPOSITORY:
      return beforeCacheSnapshotRepositoryHandler.dispatch(database, request);
  }
}
import type { DatabaseSync } from "node:sqlite";
