import { Effect, Layer } from "effect";
import { DockerCacheAdministration, type DockerCacheDomainDescriptor } from "./cache-administration.ts";
import {
  liveTaskBuildCacheAdminService,
  listDockerCacheDomains,
  observeDockerBuildKitCapacity,
} from "../sandbox/docker-task-build-cache.ts";

const failure = (cause: unknown) => new Error(cause instanceof Error ? cause.message : String(cause));

export const DockerCacheAdministrationLive = Layer.succeed(DockerCacheAdministration, {
  listDomains: () => Effect.tryPromise({ try: () => listDockerCacheDomains(), catch: failure }),
  observeBuildKitCapacity: () => Effect.tryPromise({
    try: async () => [await observeDockerBuildKitCapacity()],
    catch: failure,
  }),
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
