import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { UserDatabase } from "../user-database/client.ts";
import { userDatabaseHost } from "../user-database/client.ts";
import { UserDatabaseInvalid, type UserDatabaseFailure } from "../user-database/errors.ts";
import {
  DOCKER_CACHE_REPOSITORY,
  isDockerCacheRepositoryResult,
  type DockerCacheRepositoryRequest,
  type DockerCacheResultFor,
} from "./docker-cache-repository.ts";

type DockerCacheDispatch = <Request extends DockerCacheRepositoryRequest>(
  request: Request,
) => Effect.Effect<DockerCacheResultFor<Request>, UserDatabaseFailure>;

function dispatchFrom(database: UserDatabase): DockerCacheDispatch {
  return database.dispatch as unknown as DockerCacheDispatch;
}

function wrongResult(operation: DockerCacheRepositoryRequest["operation"]): UserDatabaseInvalid {
  return new UserDatabaseInvalid({
    code: "user-database-invalid",
    message: `docker-cache worker returned the wrong result for ${operation}`,
    repository: DOCKER_CACHE_REPOSITORY,
  });
}

export const requestDockerCacheRepositoryEffect = <Request extends DockerCacheRepositoryRequest>(
  request: Request,
): Effect.Effect<DockerCacheResultFor<Request>, UserDatabaseFailure, import("effect").Scope.Scope> =>
  Effect.flatMap(userDatabaseHost.open(), (database) =>
    dispatchFrom(database)(request).pipe(
      Effect.flatMap((value) => isDockerCacheRepositoryResult(value) && value.operation === request.operation
        ? Effect.succeed(value as DockerCacheResultFor<Request>)
        : Effect.fail(wrongResult(request.operation))),
    ));

/** Main-thread facade. It exposes only the Docker feature vocabulary; SQL and connections stay in UserDatabase. */
export const dockerCacheRepository = Object.freeze({
  requestEffect: requestDockerCacheRepositoryEffect,
  request: <Request extends DockerCacheRepositoryRequest>(request: Request): Promise<DockerCacheResultFor<Request>> =>
    Effect.runPromise(Effect.scoped(requestDockerCacheRepositoryEffect(request))),
  newOwnerCandidate: (): string => randomUUID(),
});
