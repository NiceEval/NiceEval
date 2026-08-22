import { Effect, Layer } from "effect";
import {
  CacheAdministrationRegistry,
  type CacheAdministrationAdapter,
  type CacheDomainDescriptor,
} from "./cache-administration.ts";
import {
  liveTaskBuildCacheAdminService,
  listDockerCacheDomains,
  observeDockerBuildKitCapacity,
} from "./docker-task-build-cache.ts";

const dockerAdapter: CacheAdministrationAdapter = Object.freeze({
  providerFamily: "docker",
  listDomains: () => Effect.tryPromise({
    try: () => listDockerCacheDomains(),
    catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
  }),
  observeProviderCapacity: () => Effect.tryPromise({
    try: async () => [await observeDockerBuildKitCapacity()],
    catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
  }),
  openDomain: (descriptor: CacheDomainDescriptor) => Effect.succeed({
    descriptor,
    inventory: () => Effect.tryPromise({
      try: () => liveTaskBuildCacheAdminService.inventory(),
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
    }),
    planGc: () => Effect.tryPromise({
      try: () => liveTaskBuildCacheAdminService.planGc(descriptor.domainId),
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
    }),
    applyGc: (planId: string) => Effect.tryPromise({
      try: () => liveTaskBuildCacheAdminService.applyGc(descriptor.domainId, planId),
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
    }),
  }),
});

export const CacheAdministrationLive = Layer.succeed(CacheAdministrationRegistry, {
  adapters: [dockerAdapter],
});
