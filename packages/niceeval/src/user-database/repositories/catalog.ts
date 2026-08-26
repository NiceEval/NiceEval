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

export interface UserDatabaseRepositoryMigration {
  readonly id: string;
  readonly currentRevision: number;
  readonly migrateAdjacent: (database: DatabaseSync, fromRevision: number) => number;
  readonly assertCurrentSchema: (database: DatabaseSync) => void;
}

export const userDatabaseRepositoryCatalog = Object.freeze([
  durableStateRepositoryHandler,
  dockerCacheRepositoryHandler,
  e2bCacheRepositoryHandler,
  incusRepositoryHandler,
]) satisfies readonly UserDatabaseRepositoryMigration[];

export function repositoryMigrationFor(request: UserDatabaseRepositoryRequest): UserDatabaseRepositoryMigration {
  switch (request.repository) {
    case DURABLE_STATE_REPOSITORY:
      return durableStateRepositoryHandler;
    case DOCKER_CACHE_REPOSITORY:
      return dockerCacheRepositoryHandler;
    case E2B_CACHE_REPOSITORY:
      return e2bCacheRepositoryHandler;
    case INCUS_REPOSITORY:
      return incusRepositoryHandler;
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
    case INCUS_REPOSITORY:
      return incusRepositoryHandler.dispatch(database, request);
  }
}
import type { DatabaseSync } from "node:sqlite";
