import { Context, Effect } from "effect";

export interface DockerCacheDomainDescriptor {
  readonly providerFamily: "docker";
  readonly adminProtocolVersion: number;
  readonly domainId: string;
  readonly backendKind: string;
  readonly state: "verified-managed" | "verified-read-only" | "unverified" | "unavailable";
}

export interface DockerCapacityObservation {
  readonly scope: "provider";
  readonly providerFamily: "docker";
  readonly backendKind: string;
  readonly state: "unverified";
  readonly observedAt: string;
  readonly totalBytes: number | null;
  readonly reclaimableEstimateBytes: number | null;
  readonly reason: string;
}

export interface DockerCacheDomainAdministration {
  readonly descriptor: DockerCacheDomainDescriptor;
  inventory(): Effect.Effect<unknown, Error>;
  planGc(): Effect.Effect<unknown, Error>;
  applyGc(planId: string): Effect.Effect<unknown, Error>;
}

export interface DockerCacheAdministrationService {
  listDomains(): Effect.Effect<readonly DockerCacheDomainDescriptor[], Error>;
  observeBuildKitCapacity(): Effect.Effect<readonly DockerCapacityObservation[], Error>;
  openDomain(descriptor: DockerCacheDomainDescriptor): Effect.Effect<DockerCacheDomainAdministration, Error>;
}

export class DockerCacheAdministration extends Context.Tag("niceeval/docker/DockerCacheAdministration")<
  DockerCacheAdministration,
  DockerCacheAdministrationService
>() {}
