import type { IncusControl, IncusInstance, IncusVolume } from "./control.ts";
import type { IncusDomainDescriptor } from "./descriptor.ts";
import { artifactMetadataMatches } from "./artifact.ts";
import type { ArtifactIntent, IncusRepository } from "./repository.ts";

export type ArtifactVerification = "verified" | "dangling" | "metadata-drift";
export interface ArtifactInventoryEntry {
  readonly intent: ArtifactIntent;
  readonly verification: ArtifactVerification;
  readonly instanceAbsent: boolean;
  readonly volumeAbsent: boolean;
  readonly currentHead: boolean;
  readonly superseded: boolean;
  readonly consumerHolds: number;
}
export interface ArtifactInventory {
  readonly entries: readonly ArtifactInventoryEntry[];
  readonly orphans: readonly { readonly kind: "instance" | "custom-storage-volume"; readonly name: string }[];
  readonly pool: { readonly total: number; readonly used: number; readonly free: number } | null;
}
export function artifactBelongsToDomain(intent: ArtifactIntent, domain: IncusDomainDescriptor): boolean {
  return intent.project === domain.artifactProject && intent.pool === domain.storagePool && intent.runtimeProject === domain.project;
}
export function verifyArtifactObjects(intent: ArtifactIntent, vm: IncusInstance | undefined, volume: IncusVolume | undefined): ArtifactVerification {
  // A present drifted object never becomes eligible merely because its mate is absent.
  if ((vm !== undefined && (vm.type !== "virtual-machine" || vm.status.toLowerCase() !== "stopped" || !artifactMetadataMatches(vm.config, intent)
    || vm.expandedDevices?.dockerdata?.pool !== intent.pool || vm.expandedDevices.dockerdata.source !== intent.dockerDataVolume || vm.expandedDevices.dockerdata.dependent !== "true"))
    || (volume !== undefined && (volume.type !== "custom" || volume.contentType !== "block" || !artifactMetadataMatches(volume.config, intent)))) return "metadata-drift";
  return vm === undefined || volume === undefined ? "dangling" : "verified";
}
export async function readArtifactInventory(repository: IncusRepository, control: IncusControl, domain: IncusDomainDescriptor): Promise<ArtifactInventory> {
  const intents = (await repository.listArtifacts()).filter((intent) => artifactBelongsToDomain(intent, domain));
  const instances = await control.listInstances(domain.artifactProject);
  const volumes = await control.listVolumes(domain.artifactProject, domain.storagePool);
  const entries: ArtifactInventoryEntry[] = [];
  for (const intent of intents) {
    const vm = instances.find((item) => item.name === intent.instance);
    const volume = volumes.find((item) => item.name === intent.dockerDataVolume);
    const head = intent.replacementScopeDigest === undefined ? undefined : await repository.getArtifactHead(intent.replacementScopeDigest);
    entries.push({ intent, verification: verifyArtifactObjects(intent, vm, volume), instanceAbsent: vm === undefined, volumeAbsent: volume === undefined,
      currentHead: head?.artifactId === intent.artifactId && head.generation === intent.generation,
      superseded: head !== undefined && head.state === "committed" && head.artifactId !== intent.artifactId,
      consumerHolds: await repository.countArtifactHolds(intent.artifactId, intent.generation) });
  }
  const owned = intents.filter((intent) => intent.state !== "released");
  const orphans: ArtifactInventory["orphans"] = [
    ...instances.filter((vm) => !owned.some((intent) => intent.instance === vm.name)).map((vm) => ({ kind: "instance" as const, name: vm.name })),
    ...volumes.filter((volume) => !owned.some((intent) => intent.dockerDataVolume === volume.name)).map((volume) => ({ kind: "custom-storage-volume" as const, name: volume.name })),
  ];
  const pool = await control.getStoragePoolResources(domain.artifactProject, domain.storagePool).catch(() => null);
  return { entries, orphans, pool };
}

export function inventoryDocument(domain: IncusDomainDescriptor, inventory: ArtifactInventory) {
  return {
    scope: { kind: "domain" as const, domainId: domain.executionDomainId },
    domains: [{ domainId: domain.executionDomainId, backendKind: "incus-artifacts", project: domain.artifactProject, pool: domain.storagePool,
      entryCount: inventory.entries.length, storage: inventory.pool, estimate: "not additive" }],
    providerObservations: inventory.orphans.map((orphan) => ({ domainId: domain.executionDomainId, backendKind: "incus-artifacts", classification: "orphan", ...orphan })),
    entries: inventory.entries.map(({ intent, verification, currentHead, consumerHolds }) => ({
      entryId: intent.artifactId, keyDigest: intent.beforeCacheKey, executionDomainRevision: intent.executionDomainId, state: intent.state,
      generation: intent.generation, currentHead, consumerHolds, createdAt: intent.createdAt,
      lastSuccessfulHoldAt: intent.lastSuccessfulHoldAt ?? null, verification,
      estimatedArtifactBytes: intent.estimatedArtifactBytes ?? null, sizeKind: "estimate", additive: false,
    })),
  };
}
export function renderArtifactInventory(domain: IncusDomainDescriptor, inventory: ArtifactInventory): string {
  const lines = [`Incus artifacts · ${domain.name} · ${domain.executionDomainId}`, `${inventory.entries.length} entries · project=${domain.artifactProject} pool=${domain.storagePool}`];
  for (const entry of inventory.entries) {
    const a = entry.intent;
    lines.push(`${a.artifactId.slice(0, 12)} · revision=${a.executionDomainId} · ${a.state} · generation=${a.generation} · head=${entry.currentHead} · holds=${entry.consumerHolds} · ${entry.verification}`);
    lines.push(`  created=${a.createdAt} · lastSuccessfulHoldAt=${a.lastSuccessfulHoldAt ?? "never"}`);
    lines.push(`  ${a.estimatedArtifactBytes ?? "unknown"} bytes estimate · not additive`);
  }
  for (const orphan of inventory.orphans) lines.push(`orphan ${orphan.kind} ${orphan.name} · not eligible for GC`);
  lines.push(inventory.pool === null ? "pool bytes unknown" : `pool bytes: total=${inventory.pool.total} used=${inventory.pool.used} free=${inventory.pool.free}`);
  lines.push("Artifact size estimates are not additive; exact marginal reclaim is unknown.");
  return `${lines.join("\n")}\n`;
}
