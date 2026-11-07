import { randomUUID } from "node:crypto";
import { INCUS_METADATA, IncusControl } from "./control.ts";
import { incusError } from "./errors.ts";
import {
  listArtifactIntents,
  readArtifactIntent,
  requireCommittedArtifact,
  reserveArtifactIntent,
  transitionArtifactIntent,
  type ArtifactIntent,
} from "./artifact-ledger.ts";
import { acquireDomainAdmissionLock, currentOwner } from "./ledger.ts";
import type { IncusRuntimePlan } from "./plan.ts";
import type { IncusArtifactLocator, IncusArtifactConsumerHold, IncusRepository } from "./repository.ts";
import { loadIncusDescriptor, matchDomain } from "./descriptor.ts";
import { artifactByteEstimate, reserveArtifactStorage, unknownArtifactCaptureSample } from "./storage.ts";

export type { IncusArtifactLocator } from "./repository.ts";

export async function acquireCommittedIncusArtifactHold(repository: IncusRepository, artifact: ArtifactIntent): Promise<IncusArtifactLocator> {
  const hold = await repository.acquireArtifactHold({ holdId: randomUUID(), artifactId: artifact.artifactId, generation: artifact.generation, owner: currentOwner(), acquiredAt: new Date().toISOString() });
  return Object.freeze({ artifactId: artifact.artifactId, generation: artifact.generation, project: artifact.project, instance: artifact.instance, dockerDataVolume: artifact.dockerDataVolume, beforeCacheKey: artifact.beforeCacheKey, manifestDigest: artifact.manifestDigest, consumerHoldId: hold.holdId });
}

export interface ArtifactIdentity {
  readonly executionDomainId: string; readonly artifactProject: string; readonly runtimeProject: string; readonly pool: string;
  readonly artifactMaxInstances: number;
  readonly artifactStorageReserveBytes: number;
  readonly artifactEstimatedBytes?: number;
  readonly network: string; readonly baseFingerprint: string; readonly beforeCacheKey: string; readonly manifestDigest: string;
  readonly providerRevision: string; readonly guestInitRevision: string; readonly captureRevision: string;
  readonly coverage: string; readonly resourcesDigest: string;
  readonly replacementScopeDigest: string;
}

export interface ArtifactPreparationIdentityInput {
  readonly beforeCacheKey: string; readonly manifestDigest: string; readonly providerRevision: string;
  readonly guestInitRevision: string; readonly captureRevision: string; readonly coverage: string; readonly resourcesDigest: string;
  readonly replacementScopeDigest: string;
}

const ARTIFACT_PUBLICATION_LOCK_WAIT_MS = 15 * 60 * 1_000;

function samePreparationIdentity(intent: ArtifactIntent, identity: ArtifactIdentity): boolean {
  return intent.executionDomainId === identity.executionDomainId
    && intent.project === identity.artifactProject
    && intent.runtimeProject === identity.runtimeProject
    && intent.pool === identity.pool
    && intent.baseFingerprint === identity.baseFingerprint
    && intent.beforeCacheKey === identity.beforeCacheKey
    && intent.manifestDigest === identity.manifestDigest
    && intent.providerRevision === identity.providerRevision
    && intent.guestInitRevision === identity.guestInitRevision
    && intent.captureRevision === identity.captureRevision
    && intent.coverage === identity.coverage
    && intent.resourcesDigest === identity.resourcesDigest
    && intent.replacementScopeDigest === identity.replacementScopeDigest;
}

function replacementScopeLockId(identity: ArtifactIdentity): string {
  return `${identity.executionDomainId}:artifact-scope:${identity.replacementScopeDigest}`;
}

/** The Run coordinator constructs this once, before reserve. Host quota is deliberately absent. */
export function incusArtifactPreparationIdentity(
  plan: IncusRuntimePlan,
  input: ArtifactPreparationIdentityInput,
): ArtifactIdentity {
  return Object.freeze({ executionDomainId: plan.executionDomainId, artifactProject: plan.artifactProject, artifactMaxInstances: plan.artifactMaxInstances,
    artifactStorageReserveBytes: plan.artifactStorageReserveBytes, ...(plan.artifactEstimatedBytes === undefined ? {} : { artifactEstimatedBytes: plan.artifactEstimatedBytes }),
    runtimeProject: plan.project, pool: plan.storagePool, network: plan.network, baseFingerprint: plan.imageFingerprint,
    beforeCacheKey: input.beforeCacheKey, manifestDigest: input.manifestDigest, providerRevision: input.providerRevision,
    guestInitRevision: input.guestInitRevision, captureRevision: input.captureRevision, coverage: input.coverage,
    resourcesDigest: input.resourcesDigest, replacementScopeDigest: input.replacementScopeDigest });
}
const artifactConfig = (a: ArtifactIntent): Record<string, string> => ({
  [INCUS_METADATA.allocationId]: a.artifactId, [INCUS_METADATA.generation]: String(a.generation),
  [INCUS_METADATA.executionDomainId]: a.executionDomainId, [INCUS_METADATA.artifactState]: "committed",
  [INCUS_METADATA.beforeCacheKey]: a.beforeCacheKey, [INCUS_METADATA.manifestDigest]: a.manifestDigest,
  [INCUS_METADATA.runtimeProject]: a.runtimeProject, [INCUS_METADATA.pool]: a.pool,
  [INCUS_METADATA.baseFingerprint]: a.baseFingerprint, [INCUS_METADATA.captureRevision]: a.captureRevision,
  ...(a.replacementScopeDigest === undefined ? {} : { [INCUS_METADATA.replacementScopeDigest]: a.replacementScopeDigest }),
});
export function artifactMetadataMatches(config: Readonly<Record<string, string>>, a: ArtifactIntent): boolean {
  const expected = artifactConfig(a); return Object.entries(expected).every(([key, value]) => config[key] === value);
}
function devices(pool: string, volume: string, network: string): Record<string, Record<string, string>> {
  return { root: { type: "disk", path: "/", pool }, eth0: { type: "nic", name: "eth0", nictype: "bridged", parent: network }, dockerdata: { type: "disk", pool, source: volume, dependent: "true" } };
}

/** Intent-first reservation. The caller retains the returned generation as its fencing token. */
export async function reserveIncusArtifact(
  repository: IncusRepository,
  control: IncusControl,
  identity: ArtifactIdentity,
): Promise<ArtifactIntent> {
  const capacityLock = await acquireDomainAdmissionLock(repository, identity.executionDomainId);
  try {
  const intents = await listArtifactIntents(repository);
  const instances = await control.listInstances(identity.artifactProject);
  const volumes = await control.listVolumes(identity.artifactProject, identity.pool);
  const unregisteredInstance = instances.find((instance) =>
    instance.config[INCUS_METADATA.artifactState] !== undefined &&
    !intents.some((intent) => intent.project === identity.artifactProject && intent.instance === instance.name)
  );
  const unregisteredVolume = volumes.find((volume) =>
    volume.config[INCUS_METADATA.artifactState] !== undefined &&
    !intents.some((intent) => intent.project === identity.artifactProject && intent.dockerDataVolume === volume.name)
  );
  if (unregisteredInstance !== undefined || unregisteredVolume !== undefined) {
    throw incusError(
      "sandbox-artifact-unverified",
      "Incus artifact inventory contains a NiceEval tuple with no exact IncusRepository intent.",
      ["Keep the provider objects in place and restore or explicitly maintain the registry; never delete or adopt an unregistered artifact."],
    );
  }
  const occupying = intents.filter((candidate) => candidate.project === identity.artifactProject && candidate.pool === identity.pool && candidate.runtimeProject === identity.runtimeProject && candidate.state !== "released");
  if (occupying.length >= identity.artifactMaxInstances) {
    const superseded = occupying.some((candidate) => candidate.state === "committed" && candidate.replacementScopeDigest === identity.replacementScopeDigest);
    if (!superseded) throw incusError("sandbox-capacity-unavailable", "Incus prepared artifact capacity is full and every committed artifact belongs to a still-current replacement lineage.", ["Inspect niceeval sandbox provider inventory incus and preview niceeval sandbox provider gc incus --unused-for <duration>.", "Raise artifactMaxInstances or reduce the active BeforeCache working set; NiceEval will not evict a still-useful cache entry by age."]);
  }
  const artifactId = randomUUID(); const now = new Date().toISOString();
  return reserveArtifactIntent(repository, { artifactId, generation: 1, project: identity.artifactProject, instance: `nea-${artifactId.replaceAll("-", "").slice(0, 20)}`,
    dockerDataVolume: `nea-${artifactId.replaceAll("-", "").slice(0, 18)}-dd`, beforeCacheKey: identity.beforeCacheKey, manifestDigest: identity.manifestDigest,
    state: "reserved", executionDomainId: identity.executionDomainId, runtimeProject: identity.runtimeProject, pool: identity.pool, baseFingerprint: identity.baseFingerprint,
    providerRevision: identity.providerRevision, guestInitRevision: identity.guestInitRevision, captureRevision: identity.captureRevision, coverage: identity.coverage, resourcesDigest: identity.resourcesDigest, replacementScopeDigest: identity.replacementScopeDigest, createdAt: now, updatedAt: now },
    identity.artifactMaxInstances + (occupying.length >= identity.artifactMaxInstances ? 1 : 0));
  } finally { await capacityLock.release(); }
}

/** Prefix order is supplied by the coordinator from deepest to shallowest, so selection remains pure and explicit. */
export async function lookupCommittedIncusArtifactForPrefixes(
  repository: IncusRepository,
  executionDomainId: string,
  prefixesDeepestFirst: readonly {
    readonly beforeCacheKey: string;
    readonly manifestDigest: string;
  }[],
): Promise<IncusArtifactLocator | undefined> {
  const committed = (await listArtifactIntents(repository)).filter((entry) =>
    entry.state === "committed" && entry.executionDomainId === executionDomainId
  );
  for (const prefix of prefixesDeepestFirst) {
    const found = committed.find((entry) =>
      entry.beforeCacheKey === prefix.beforeCacheKey &&
      entry.manifestDigest === prefix.manifestDigest
    );
    if (found !== undefined) {
      const touched = await transitionArtifactIntent(repository, found, { ...found, updatedAt: new Date().toISOString() });
      return Object.freeze({ artifactId: touched.artifactId, generation: touched.generation, project: touched.project, instance: touched.instance, dockerDataVolume: touched.dockerDataVolume, beforeCacheKey: touched.beforeCacheKey, manifestDigest: touched.manifestDigest });
    }
  }
  return undefined;
}

/** Promote a stopped virtual-machine instance plus its dependent custom storage volume. */
async function publishIncusArtifact(repository: IncusRepository, control: IncusControl, artifact: ArtifactIntent, prepare: { readonly project: string; readonly instance: string; readonly volume: string }, identity: ArtifactIdentity, storage: Awaited<ReturnType<typeof reserveArtifactStorage>>): Promise<ArtifactIntent> {
  const current = await readArtifactIntent(repository, artifact.artifactId);
  if (current === undefined || current.generation !== artifact.generation || current.state !== "reserved" || !samePreparationIdentity(current, identity)) throw incusError("sandbox-artifact-unverified", "Artifact publication is fenced by its current reservation generation and preparation identity.", ["Re-run exact-prefix lookup or reconcile before reserving a new artifact."]);
  await quiesceIncusArtifact(control, prepare.project, prepare.instance);
  await control.stopInstance(prepare.project, prepare.instance);
  const sourceInstance = await control.getInstance(prepare.project, prepare.instance); const sourceVolume = await control.getVolume(prepare.project, identity.pool, prepare.volume);
  if (sourceInstance === undefined || sourceVolume === undefined || sourceInstance.status.toLowerCase() !== "stopped") throw incusError("sandbox-artifact-unverified", "Prepare tuple is not a stopped virtual-machine instance and dependent custom storage volume.", ["Quarantine the prepare allocation."]);
  const publishing = await transitionArtifactIntent(repository, current, { ...current, state: "publishing", capturePoolUsedBefore: storage.usedBefore, updatedAt: new Date().toISOString() });
  // Incus copies the dependent device with the instance. Pre-creating the
  // target volume makes Incus reject the instance copy as an existing volume.
  await control.copyInstance({ sourceProject: prepare.project, sourceName: prepare.instance, targetProject: artifact.project, targetName: artifact.instance, config: artifactConfig(publishing), devices: devices(identity.pool, artifact.dockerDataVolume, identity.network) });
  await control.updateVolumeConfig(artifact.project, identity.pool, artifact.dockerDataVolume, artifactConfig(publishing));
  const instance = await control.getInstance(artifact.project, artifact.instance); const volume = await control.getVolume(artifact.project, identity.pool, artifact.dockerDataVolume);
  if (instance === undefined || volume === undefined || instance.status.toLowerCase() !== "stopped" || !artifactMetadataMatches(instance.config, publishing) || !artifactMetadataMatches(volume.config, publishing)) {
    await transitionArtifactIntent(repository, publishing, { ...publishing, state: "quarantined", updatedAt: new Date().toISOString() }); throw incusError("sandbox-artifact-unverified", "Published artifact tuple failed bidirectional metadata or stopped-state verification.", ["Reconcile and quarantine this artifact."]);
  }
  const after = await control.getStoragePoolResources(identity.artifactProject, identity.pool);
  if (after.used < storage.usedBefore) throw unknownArtifactCaptureSample(identity.pool);
  return transitionArtifactIntent(repository, publishing, { ...publishing, state: "committed", capturePoolUsedAfter: after.used, estimatedArtifactBytes: after.used - storage.usedBefore, updatedAt: new Date().toISOString() });
}

async function reclaimSupersededIncusArtifacts(
  repository: IncusRepository,
  control: IncusControl,
  head: ArtifactIntent,
  previous: ArtifactIntent | undefined,
): Promise<void> {
  if (previous === undefined || previous.artifactId === head.artifactId) return;
  const lock = await acquireDomainAdmissionLock(repository, head.executionDomainId);
  try {
    const candidate = await readArtifactIntent(repository, previous.artifactId);
    if (candidate === undefined || candidate.generation !== previous.generation || (candidate.state !== "committed" && candidate.state !== "retiring") || candidate.replacementScopeDigest !== head.replacementScopeDigest) return;
    if (candidate.state === "committed" && await repository.countArtifactHolds(candidate.artifactId, candidate.generation) !== 0) return;
    const instance = await control.getInstance(candidate.project, candidate.instance);
    const volume = await control.getVolume(candidate.project, candidate.pool, candidate.dockerDataVolume);
    if ((instance !== undefined && (instance.status.toLowerCase() !== "stopped" || !artifactMetadataMatches(instance.config, candidate))) || (volume !== undefined && !artifactMetadataMatches(volume.config, candidate))) {
      throw incusError("sandbox-artifact-unverified", "A superseded Incus artifact failed exact metadata verification.", ["The new generation remains committed; do not delete or adopt the drifted old tuple."]);
    }
    const requested = await repository.requestArtifactRelease(candidate);
    if (!requested.instanceAbsent && instance !== undefined) await control.deleteInstance(candidate.project, candidate.instance);
    await control.waitAbsent(candidate.project, candidate.instance);
    const afterInstance = await repository.observeArtifactRelease(requested.intent, { instanceAbsent: true, customStorageVolumeAbsent: requested.customStorageVolumeAbsent });
    if (!afterInstance.customStorageVolumeAbsent && volume !== undefined) await control.deleteVolume(candidate.project, candidate.pool, candidate.dockerDataVolume);
    await control.waitVolumeAbsent(candidate.project, candidate.pool, candidate.dockerDataVolume);
    await repository.observeArtifactRelease(afterInstance.intent, { instanceAbsent: true, customStorageVolumeAbsent: true });
  } finally { await lock.release(); }
}

/**
 * Serialize publication for one replacement scope across control processes.
 * A loser verifies and adopts an exact-prefix winner; a dead publisher is
 * reconciled by exact intent/object only.
 */
export async function publishOrReuseIncusArtifact(
  repository: IncusRepository,
  control: IncusControl,
  prepare: { readonly project: string; readonly instance: string; readonly volume: string },
  identity: ArtifactIdentity,
): Promise<ArtifactIntent> {
  const lock = await acquireDomainAdmissionLock(
    repository,
    replacementScopeLockId(identity),
    { waitMs: ARTIFACT_PUBLICATION_LOCK_WAIT_MS },
  );
  try {
    const candidates = (await listArtifactIntents(repository)).filter((candidate) =>
      samePreparationIdentity(candidate, identity)
    );
    const committed = candidates.filter((candidate) => candidate.state === "committed");
    if (committed.length > 1) {
      throw incusError("sandbox-artifact-unverified", "Multiple committed Incus artifacts claim the exact same before cache identity.", ["Quarantine duplicate committed artifacts before reuse."]);
    }
    if (committed[0] !== undefined) {
      const verified = await reconcileIncusArtifact(repository, control, committed[0]);
      if (verified.state !== "committed") {
        throw incusError("sandbox-artifact-unverified", "The committed Incus artifact failed exact tuple verification.", ["Keep the drifted artifact quarantined and rebuild from a verified ancestor."]);
      }
      return verified;
    }

    const inFlight = candidates.filter((candidate) =>
      candidate.state === "reserved" || candidate.state === "preparing" || candidate.state === "publishing"
    );
    if (inFlight.length > 1) {
      throw incusError("sandbox-artifact-unverified", "Multiple in-flight Incus artifacts claim the exact same before cache identity.", ["Reconcile every exact intent before publishing another artifact."]);
    }
    if (inFlight[0] !== undefined) {
      const reconciled = await reconcileIncusArtifact(repository, control, inFlight[0]);
      if (reconciled.state === "committed") {
        if (reconciled.replacementScopeDigest !== undefined) {
          const headed = await repository.replaceArtifactHead(reconciled);
          await reclaimSupersededIncusArtifacts(repository, control, headed.intent, headed.previous);
        }
        return reconciled;
      }
      if (reconciled.state === "quarantined") {
        throw incusError("sandbox-artifact-unverified", "The previous exact-prefix publication was quarantined during reconcile.", ["Retry from a verified ancestor after reviewing the quarantined exact object."]);
      }
    }

    const estimate = artifactByteEstimate((await repository.listArtifacts()).filter((entry) => entry.project === identity.artifactProject && entry.pool === identity.pool && entry.baseFingerprint === identity.baseFingerprint), identity.artifactEstimatedBytes);
    const storage = await reserveArtifactStorage(control, identity.artifactProject, identity.pool, identity.artifactStorageReserveBytes, estimate);
    try {
      const reserved = await reserveIncusArtifact(repository, control, identity);
      const published = await publishIncusArtifact(repository, control, reserved, prepare, identity, storage);
      const headed = await repository.replaceArtifactHead(published);
      await reclaimSupersededIncusArtifacts(repository, control, headed.intent, headed.previous);
      return published;
    } finally { await storage.release(); }
  } finally {
    await lock.release();
  }
}

/** Guest-side barrier before the provider stop: no Docker workload may be captured live. */
export async function quiesceIncusArtifact(control: IncusControl, project: string, instance: string): Promise<void> {
  const result = await control.exec(project, instance, ["/bin/sh", "-lc", "systemctl stop docker.service docker.socket containerd.service || exit 1; ! systemctl is-active --quiet docker.service; ! systemctl is-active --quiet containerd.service; sync"]);
  if (result.exitCode !== 0) throw incusError("sandbox-artifact-unverified", `Artifact prepare VM ${JSON.stringify(instance)} did not pass the Docker/containerd quiesce barrier.`, ["Do not publish a live Docker daemon or its containers."]);
}

export async function lookupCommittedIncusArtifact(repository: IncusRepository, artifactId: string, generation: number): Promise<ArtifactIntent> {
  return requireCommittedArtifact(repository, artifactId, generation);
}

/** Decode only the committed locator projection supplied by the Run coordinator. */
export async function decodeCommittedIncusArtifact(repository: IncusRepository, value: unknown, expectedProject: string): Promise<IncusArtifactLocator | undefined> {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw incusError("sandbox-artifact-unverified", "beforeCacheArtifact must be a committed Incus artifact locator object.", ["Pass the coordinator lookup result unchanged."]);
  const record = value as Record<string, unknown>;
  const keys = ["artifactId", "generation", "project", "instance", "dockerDataVolume", "beforeCacheKey", "manifestDigest"] as const;
  if (Object.keys(record).length !== keys.length || !keys.every((key) => key in record) || typeof record.artifactId !== "string" || typeof record.generation !== "number" || !Number.isSafeInteger(record.generation) || record.generation < 1 || !["project", "instance", "dockerDataVolume", "beforeCacheKey", "manifestDigest"].every((key) => typeof record[key] === "string")) throw incusError("sandbox-artifact-unverified", "beforeCacheArtifact has an invalid Incus locator shape.", ["Pass only the exact locator returned by lookupCommittedIncusArtifactForPrefixes."]);
  const artifact = await lookupCommittedIncusArtifact(repository, record.artifactId, record.generation);
  const persistedKeys = ["artifactId", "generation", "project", "instance", "dockerDataVolume", "beforeCacheKey", "manifestDigest"] as const;
  if (artifact.project !== expectedProject || !persistedKeys.every((key) => artifact[key] === record[key])) throw incusError("sandbox-artifact-unverified", "beforeCacheArtifact does not match the committed artifact ledger record or planned artifact project.", ["Re-run committed artifact lookup; do not synthesize a locator."]);
  return acquireCommittedIncusArtifactHold(repository, artifact);
}

export interface IncusPrepareAllocation {
  readonly project: string; readonly pool: string; readonly network: string; readonly instance: string; readonly volume: string;
  readonly dockerDataBytes: number; readonly config: Readonly<Record<string, string>>;
}

/** The trusted prepare worker calls this from a base only; it creates a normal runtime-project VM plus dependent volume. */
export async function createIncusPrepareFromBase(control: IncusControl, plan: IncusRuntimePlan, prepare: IncusPrepareAllocation): Promise<void> {
  await control.createVolume({ project: prepare.project, pool: prepare.pool, name: prepare.volume, contentType: "block", sizeBytes: prepare.dockerDataBytes, config: prepare.config });
  await control.createInstance({ name: prepare.instance, project: prepare.project, fingerprint: plan.imageFingerprint, storagePool: prepare.pool, network: prepare.network, config: prepare.config, dockerDataVolume: prepare.volume, dockerDataContentType: "block" });
}

/** A parent artifact uses the same explicit cross-project clone path as a consumer. */
export async function createIncusPrepareFromArtifact(repository: IncusRepository, control: IncusControl, parent: IncusArtifactLocator, prepare: IncusPrepareAllocation): Promise<void> {
  await cloneIncusArtifactConsumer(repository, control, parent, { project: prepare.project, pool: prepare.pool, network: prepare.network, instance: prepare.instance, volume: prepare.volume, config: prepare.config });
}

/** Cross-project consumer clone. New volume source/name is explicit and never reuses the artifact source name. */
export async function cloneIncusArtifactConsumer(repository: IncusRepository, control: IncusControl, artifact: IncusArtifactLocator, target: { readonly project: string; readonly pool: string; readonly network: string; readonly instance: string; readonly volume: string; readonly config: Readonly<Record<string, string>> }): Promise<void> {
  if (artifact.consumerHoldId === undefined) throw incusError("sandbox-artifact-unverified", "Incus artifact clone requires a durable consumer hold.", ["Use only a locator returned by committed artifact lookup."]);
  try {
  const source = await requireCommittedArtifact(repository, artifact.artifactId, artifact.generation);
  const policy = matchDomain(await loadIncusDescriptor(), target.project, target.pool);
  if (policy === undefined || policy.executionDomainId !== source.executionDomainId) throw incusError("incus-domain-mismatch", "Artifact copy has no current descriptor storage policy.", ["Check the Incus descriptor and execution domain."]);
  const vm = await control.getInstance(artifact.project, artifact.instance); const volume = await control.getVolume(artifact.project, target.pool, artifact.dockerDataVolume);
  if (vm === undefined || volume === undefined || vm.type !== "virtual-machine" || volume.contentType !== "block" || vm.status.toLowerCase() !== "stopped" || !artifactMetadataMatches(vm.config, source) || !artifactMetadataMatches(volume.config, source) || vm.expandedDevices?.dockerdata?.pool !== source.pool || vm.expandedDevices.dockerdata.source !== source.dockerDataVolume || vm.expandedDevices.dockerdata.dependent !== "true") throw incusError("sandbox-artifact-unverified", "Committed artifact drifted or is missing; it is not consumable.", ["Invalidate and quarantine the artifact before retrying."]);
  const storage = await reserveArtifactStorage(control, target.project, target.pool, policy.artifactStorageReserveBytes, source.estimatedArtifactBytes);
  try {
  // Incus owns the dependent-volume copy as part of the instance operation.
  await control.copyInstance({ sourceProject: artifact.project, sourceName: artifact.instance, targetProject: target.project, targetName: target.instance, config: target.config, devices: devices(target.pool, target.volume, target.network) });
  await control.updateVolumeConfig(target.project, target.pool, target.volume, target.config);
  } finally { await storage.release(); }
  } finally {
    await releaseIncusArtifactHold(repository, { holdId: artifact.consumerHoldId, artifactId: artifact.artifactId, generation: artifact.generation, owner: currentOwner(), acquiredAt: "" }, control);
  }
}

/** Both Run and clone holds retry superseded-artifact reclamation when released. */
export async function releaseIncusArtifactHold(
  repository: IncusRepository,
  hold: IncusArtifactConsumerHold,
  control?: IncusControl,
): Promise<void> {
  if (!await repository.releaseArtifactHold(hold)) return;
  const released = await repository.getArtifact(hold.artifactId);
  if (released?.replacementScopeDigest === undefined) return;
  const head = await repository.getArtifactHead(released.replacementScopeDigest);
  if (head !== undefined && head.artifactId !== released.artifactId) {
    await reclaimSupersededIncusArtifacts(repository, control ?? await IncusControl.connectMutation(), head, released);
  }
}

/** Reconcile is exact-object only. It never adopts similarly named objects or makes a drifted artifact warm. */
export async function reconcileIncusArtifact(repository: IncusRepository, control: IncusControl, artifact: ArtifactIntent): Promise<ArtifactIntent> {
  const vm = await control.getInstance(artifact.project, artifact.instance);
  const volume = await control.getVolume(artifact.project, artifact.pool, artifact.dockerDataVolume);
  const exactVm = vm !== undefined && artifactMetadataMatches(vm.config, artifact);
  const exactVolume = volume !== undefined && artifactMetadataMatches(volume.config, artifact);
  if (artifact.state === "committed") {
    if (exactVm && exactVolume && vm.status.toLowerCase() === "stopped") return artifact;
    return transitionArtifactIntent(repository, artifact, { ...artifact, state: "quarantined", updatedAt: new Date().toISOString() });
  }
  if (artifact.state === "publishing" && exactVm && exactVolume && vm.status.toLowerCase() === "stopped") {
    const observation = await control.getStoragePoolResources(artifact.project, artifact.pool);
    if (artifact.capturePoolUsedBefore === undefined || observation.used < artifact.capturePoolUsedBefore) throw unknownArtifactCaptureSample(artifact.pool);
    return transitionArtifactIntent(repository, artifact, { ...artifact, state: "committed", capturePoolUsedAfter: observation.used, estimatedArtifactBytes: observation.used - artifact.capturePoolUsedBefore, updatedAt: new Date().toISOString() });
  }
  if ((vm !== undefined && !exactVm) || (volume !== undefined && !exactVolume)) {
    return transitionArtifactIntent(repository, artifact, { ...artifact, state: "quarantined", updatedAt: new Date().toISOString() });
  }
  if (exactVm) await control.deleteInstance(artifact.project, artifact.instance);
  if (exactVolume) await control.deleteVolume(artifact.project, artifact.pool, artifact.dockerDataVolume);
  if (exactVm) await control.waitAbsent(artifact.project, artifact.instance);
  if (exactVolume) await control.waitVolumeAbsent(artifact.project, artifact.pool, artifact.dockerDataVolume);
  return transitionArtifactIntent(repository, artifact, { ...artifact, state: "released", updatedAt: new Date().toISOString() });
}

export async function releaseIncusArtifact(repository: IncusRepository, control: IncusControl, artifact: ArtifactIntent): Promise<ArtifactIntent> {
  if (artifact.state === "committed") throw incusError("sandbox-artifact-unverified", "Committed artifacts must be invalidated/quarantined by reconcile before release.", ["Do not delete a committed artifact without detecting drift or an explicit invalidation decision."]);
  return reconcileIncusArtifact(repository, control, artifact);
}
