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

export interface DockerTaskBuildInventoryEntry {
  readonly kind: "task-build";
  readonly state: "active-leased" | "cold-reusable" | "unverified";
  readonly identity: { readonly buildKey: string; readonly tag: string; readonly imageId: string };
  readonly leaseCount: number;
  readonly rootCount: number;
  readonly createdAt: string;
  readonly lastSuccessfulUseAt: string | null;
  readonly protectedUntil: string;
}

export interface DockerSetupPrefixInventoryEntry {
  readonly kind: "sandbox-setup-prefix";
  readonly state: "reserved" | "building" | "published" | "indexed" | "invalidated" | "deleting" | "tombstoned" | "unverified";
  readonly identity: { readonly entryId: string; readonly setupPrefixKey: string; readonly imageId: string | null; readonly baseImageId: string };
  readonly leaseCount: number;
  readonly rootCount: number;
  readonly createdAt: string;
  readonly lastSuccessfulUseAt: string | null;
  readonly protectedUntil: string;
}

export type DockerCacheInventoryEntry = DockerTaskBuildInventoryEntry | DockerSetupPrefixInventoryEntry;

export interface DockerCacheDomainInventory {
  readonly domainId: string;
  readonly providerFamily: "docker";
  readonly backendKind: "docker-images";
  readonly state: "verified-managed";
  readonly entries: readonly DockerCacheInventoryEntry[];
}

export interface DockerCacheDomainAdministration {
  readonly descriptor: DockerCacheDomainDescriptor;
  inventory(): Effect.Effect<DockerCacheDomainInventory, Error>;
  planGc(): Effect.Effect<unknown, Error>;
  applyGc(planId: string): Effect.Effect<unknown, Error>;
}

export interface DockerCacheAdministrationService {
  listDomains(): Effect.Effect<readonly DockerCacheDomainDescriptor[], Error>;
  observeBuildKitCapacity(): Effect.Effect<readonly DockerCapacityObservation[], Error>;
  openDomain(descriptor: DockerCacheDomainDescriptor): Effect.Effect<DockerCacheDomainAdministration, Error>;
}

export class DockerCacheAdministration extends Context.Service<DockerCacheAdministration, DockerCacheAdministrationService>()(
  "niceeval/docker/DockerCacheAdministration",
) {}
