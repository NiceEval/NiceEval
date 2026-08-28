import { Effect, Layer } from "effect";
import { DockerCacheAdministration, type DockerCacheDomainDescriptor } from "./cache-administration.ts";
import {
  liveTaskBuildCacheAdminService,
  listDockerCacheDomainsEffect,
  observeDockerBuildKitCapacityEffect,
} from "../sandbox/docker-task-build-cache.ts";

const failure = (cause: unknown) => new Error(cause instanceof Error ? cause.message : String(cause));

export const DockerCacheAdministrationLive = Layer.succeed(DockerCacheAdministration, {
  listDomains: () => Effect.scoped(listDockerCacheDomainsEffect()).pipe(Effect.mapError(failure)),
  observeBuildKitCapacity: () => observeDockerBuildKitCapacityEffect.pipe(
    Effect.map((capacity) => [capacity]),
    Effect.mapError(failure),
  ),
  openDomain: (descriptor: DockerCacheDomainDescriptor) => Effect.succeed({
    descriptor,
    inventory: () => Effect.tryPromise({ try: () => liveTaskBuildCacheAdminService.inventory(), catch: failure }),
    planGc: () => Effect.tryPromise({
      try: () => liveTaskBuildCacheAdminService.planGc(descriptor.domainId),
      catch: failure,
    }),
    applyGc: (planId: string) => Effect.tryPromise({
      try: () => liveTaskBuildCacheAdminService.applyGc(descriptor.domainId, planId),
      catch: failure,
    }),
  }),
});
