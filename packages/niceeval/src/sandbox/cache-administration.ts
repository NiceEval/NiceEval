import { Context, Effect } from "effect";

/** Provider-neutral descriptor. Its locator is opaque and never grants ownership. */
export interface CacheDomainDescriptor {
  readonly providerFamily: string;
  readonly adminProtocolVersion: number;
  readonly domainId: string;
  readonly backendKind: string;
  readonly state: "verified-managed" | "verified-read-only" | "unverified" | "unavailable";
}

export interface ProviderCapacityObservation {
  readonly scope: "provider";
  readonly providerFamily: string;
  readonly backendKind: string;
  readonly state: "unverified";
  readonly observedAt: string;
  readonly totalBytes: number | null;
  readonly reclaimableEstimateBytes: number | null;
  readonly reason: string;
}

export interface CacheDomainAdministration {
  readonly descriptor: CacheDomainDescriptor;
  inventory(): Effect.Effect<unknown, Error>;
  planGc(): Effect.Effect<unknown, Error>;
  applyGc(planId: string): Effect.Effect<unknown, Error>;
}

/** Optional provider capability. Providers without managed cache simply do not register one. */
export interface CacheAdministrationAdapter {
  readonly providerFamily: string;
  listDomains(): Effect.Effect<readonly CacheDomainDescriptor[], Error>;
  observeProviderCapacity(): Effect.Effect<readonly ProviderCapacityObservation[], Error>;
  openDomain(descriptor: CacheDomainDescriptor): Effect.Effect<CacheDomainAdministration, Error>;
}

export interface CacheAdministrationRegistryService {
  readonly adapters: readonly CacheAdministrationAdapter[];
}

export class CacheAdministrationRegistry extends Context.Tag("niceeval/sandbox/CacheAdministrationRegistry")<
  CacheAdministrationRegistry,
  CacheAdministrationRegistryService
>() {}
