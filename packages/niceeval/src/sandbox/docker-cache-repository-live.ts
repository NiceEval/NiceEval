import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { UserDatabase } from "../user-database/client.ts";
import { userDatabaseHost } from "../user-database/client.ts";
import { UserDatabaseInvalid, type UserDatabaseFailure } from "../user-database/errors.ts";
import {
  DOCKER_CACHE_REPOSITORY,
  DOCKER_DELETE_LOCK_PAGE_SIZE,
  isDockerCacheRepositoryResult,
  type DockerCacheRepositoryRequest,
  type DockerCacheResultFor,
  type DockerImageGcLockRow,
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
    cause: undefined,
  });
}

export const requestDockerCacheRepositoryEffect = <Request extends DockerCacheRepositoryRequest>(
  request: Request,
): Effect.Effect<DockerCacheResultFor<Request>, UserDatabaseFailure, import("effect").Scope.Scope> =>
  Effect.flatMap(userDatabaseHost.open(), (database) =>
    dispatchFrom(database)(request).pipe(
      Effect.flatMap((value) =>
        isDockerCacheRepositoryResult(value) && value.operation === request.operation
          ? Effect.succeed(value as DockerCacheResultFor<Request>)
          : Effect.fail(wrongResult(request.operation)),
      ),
    ),
  );

/** Main-thread facade. It exposes only the Docker feature vocabulary; SQL and connections stay in UserDatabase. */
export const dockerCacheRepository = Object.freeze({
  requestEffect: requestDockerCacheRepositoryEffect,
  request: <Request extends DockerCacheRepositoryRequest>(request: Request): Promise<DockerCacheResultFor<Request>> =>
    Effect.runPromise(Effect.scoped(requestDockerCacheRepositoryEffect(request))),
  newOwnerCandidate: (): string => randomUUID(),
});

export async function* iterateDockerDeleteLocks(domainId: string, cacheKind: DockerImageGcLockRow["cacheKind"]) {
  let afterImageId: string | undefined;
  while (true) {
    const { locks } = await dockerCacheRepository.request({
      repository: DOCKER_CACHE_REPOSITORY,
      operation: "list-delete-locks",
      domainId,
      cacheKind,
      ...(afterImageId === undefined ? {} : { afterImageId }),
    });
    yield* locks;
    if (locks.length < DOCKER_DELETE_LOCK_PAGE_SIZE) return;
    afterImageId = locks.at(-1)!.imageId;
  }
}
