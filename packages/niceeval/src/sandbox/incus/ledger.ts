import { hostname } from "node:os";
import { classifyRunIdentity } from "../run-identity.ts";
import { INCUS_METADATA, type IncusControl, type IncusInstance, type IncusVolume } from "./control.ts";
import { incusError, type IncusProviderError } from "./errors.ts";
import {
  type AllocationIntent,
  type AllocationOwner,
  type AllocationState,
  type IncusAdmissionLease,
  type IncusRepository,
} from "./repository.ts";

export { ALLOCATION_STATES } from "./repository.ts";
export type { AllocationIntent, AllocationOwner, AllocationState } from "./repository.ts";

const RELEASED_STATES = new Set<AllocationState>(["destroyed"]);
const OCCUPYING_STATES = new Set<AllocationState>([
  "reserved",
  "creating",
  "ready",
  "handed-off",
  "destroy-requested",
  "lost",
]);
const LOCK_WAIT_MS = 15_000;
const LOCK_RETRY_MS = 50;

export function reserveAllocationIntent(
  repository: IncusRepository,
  intent: AllocationIntent,
): Promise<AllocationIntent> {
  return repository.reserveAllocation(intent);
}

export function transitionAllocationIntent(
  repository: IncusRepository,
  current: AllocationIntent,
  next: AllocationIntent,
): Promise<AllocationIntent> {
  return repository.transitionAllocation(current, next);
}

export function readAllocationIntent(
  repository: IncusRepository,
  allocationId: string,
): Promise<AllocationIntent | undefined> {
  return repository.getAllocation(allocationId);
}

export function listAllocationIntents(repository: IncusRepository): Promise<readonly AllocationIntent[]> {
  return repository.listAllocations();
}

export function instanceNameFor(allocationId: string): string {
  const compact = allocationId.replaceAll("-", "").toLowerCase();
  return `ne-${compact.slice(0, 20)}`;
}

export function volumeNameFor(allocationId: string): string {
  const compact = allocationId.replaceAll("-", "").toLowerCase();
  return `ne-${compact.slice(0, 18)}-dd`;
}

export function executionIdFor(allocationId: string): string {
  return `exec-${allocationId}`;
}

export function currentOwner(): AllocationOwner {
  return Object.freeze({
    host: hostname(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
}

export function metadataOf(instance: IncusInstance): {
  readonly allocationId?: string;
  readonly executionId?: string;
  readonly generation?: number;
  readonly artifactDigest?: string;
  readonly executionDomainId?: string;
  readonly provisionToken?: string;
  readonly host?: string;
  readonly pid?: number;
  readonly startedAt?: string;
} {
  const generationRaw = instance.config[INCUS_METADATA.generation];
  const generation = generationRaw === undefined ? undefined : Number(generationRaw);
  const pidRaw = instance.config[INCUS_METADATA.pid];
  const pid = pidRaw === undefined ? undefined : Number(pidRaw);
  return {
    ...(instance.config[INCUS_METADATA.allocationId] === undefined
      ? {}
      : { allocationId: instance.config[INCUS_METADATA.allocationId] }),
    ...(instance.config[INCUS_METADATA.executionId] === undefined
      ? {}
      : { executionId: instance.config[INCUS_METADATA.executionId] }),
    ...(generation !== undefined && Number.isSafeInteger(generation) ? { generation } : {}),
    ...(instance.config[INCUS_METADATA.artifactDigest] === undefined
      ? {}
      : { artifactDigest: instance.config[INCUS_METADATA.artifactDigest] }),
    ...(instance.config[INCUS_METADATA.executionDomainId] === undefined
      ? {}
      : { executionDomainId: instance.config[INCUS_METADATA.executionDomainId] }),
    ...(instance.config[INCUS_METADATA.provisionToken] === undefined
      ? {}
      : { provisionToken: instance.config[INCUS_METADATA.provisionToken] }),
    ...(instance.config[INCUS_METADATA.host] === undefined ? {} : { host: instance.config[INCUS_METADATA.host] }),
    ...(pid !== undefined && Number.isSafeInteger(pid) ? { pid } : {}),
    ...(instance.config[INCUS_METADATA.startedAt] === undefined
      ? {}
      : { startedAt: instance.config[INCUS_METADATA.startedAt] }),
  };
}

export function metadataMatchesIntent(instance: IncusInstance, intent: AllocationIntent): boolean {
  const meta = metadataOf(instance);
  return meta.allocationId === intent.allocationId
    && meta.generation === intent.generation
    && meta.executionDomainId === intent.executionDomainId
    && meta.artifactDigest === intent.artifactDigest
    && meta.provisionToken === intent.provisionToken
    && meta.executionId === intent.executionId;
}

function ownerProvenDead(owner: AllocationOwner): boolean {
  return classifyRunIdentity(owner) === "orphan";
}

export function unionActiveAllocationIds(
  intents: readonly AllocationIntent[],
  instances: readonly IncusInstance[],
  scope: { readonly executionDomainId: string; readonly project: string },
  volumes: readonly IncusVolume[] = [],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const intent of intents) {
    if (
      OCCUPYING_STATES.has(intent.state)
      && intent.executionDomainId === scope.executionDomainId
      && intent.project === scope.project
    ) {
      ids.add(intent.allocationId);
    }
  }
  for (const instance of instances) {
    const meta = metadataOf(instance);
    if (
      meta.allocationId !== undefined
      && meta.generation !== undefined
      && meta.executionDomainId === scope.executionDomainId
      && meta.artifactDigest !== undefined
      && meta.provisionToken !== undefined
      && meta.executionId !== undefined
    ) {
      ids.add(meta.allocationId);
    }
  }
  for (const volume of volumes) {
    const allocationId = volume.config[INCUS_METADATA.allocationId];
    const executionDomainId = volume.config[INCUS_METADATA.executionDomainId];
    if (allocationId !== undefined && executionDomainId === scope.executionDomainId) {
      ids.add(allocationId);
    }
  }
  return ids;
}

export function countActiveAllocations(
  intents: readonly AllocationIntent[],
  instances: readonly IncusInstance[],
  executionDomainId: string,
  project: string,
  volumes: readonly IncusVolume[] = [],
): number {
  return unionActiveAllocationIds(intents, instances, {
    executionDomainId,
    project,
  }, volumes).size;
}

export function volumeMetadataMatchesIntent(volume: IncusVolume, intent: AllocationIntent): boolean {
  const allocationId = volume.config[INCUS_METADATA.allocationId];
  const generation = volume.config[INCUS_METADATA.generation];
  const executionDomainId = volume.config[INCUS_METADATA.executionDomainId];
  const artifactDigest = volume.config[INCUS_METADATA.artifactDigest];
  const provisionToken = volume.config[INCUS_METADATA.provisionToken];
  const executionId = volume.config[INCUS_METADATA.executionId];
  return allocationId === intent.allocationId
    && generation === String(intent.generation)
    && executionDomainId === intent.executionDomainId
    && artifactDigest === intent.artifactDigest
    && provisionToken === intent.provisionToken
    && executionId === intent.executionId;
}

/**
 * Incus creates a cross-project copy's dependent volume atomically with its
 * VM. There is a narrow acceptance window before the follow-up volume PATCH
 * can replace the source artifact metadata. During that window, the VM is
 * still the durable allocation's exact object, and its expanded `dockerdata`
 * device is the only evidence that permits deleting the copied volume.
 */
function volumeIsDependentOnExactInstance(
  instance: IncusInstance,
  volume: IncusVolume,
  intent: AllocationIntent,
): boolean {
  if (!metadataMatchesIntent(instance, intent)) return false;
  const dockerData = instance.expandedDevices?.dockerdata;
  return volume.type === "custom"
    && volume.contentType === "block"
    && dockerData?.type === "disk"
    && dockerData.pool === intent.storagePool
    && dockerData.source === volume.name
    && dockerData.dependent === "true";
}

export async function reconcileDomain(
  repository: IncusRepository,
  control: IncusControl,
  scope: { readonly executionDomainId: string; readonly project: string; readonly storagePool: string },
): Promise<{
  readonly intents: readonly AllocationIntent[];
  readonly instances: readonly IncusInstance[];
}> {
  const intents = await listAllocationIntents(repository);
  const instances = await control.listInstances(scope.project);
  const volumes = await control.listVolumes(scope.project, scope.storagePool);
  const next: AllocationIntent[] = [];
  for (const intent of intents) {
    if (intent.executionDomainId !== scope.executionDomainId || intent.project !== scope.project) {
      next.push(intent);
      continue;
    }
    if (RELEASED_STATES.has(intent.state)) {
      next.push(intent);
      continue;
    }
    const instance = instances.find((candidate) => metadataMatchesIntent(candidate, intent));
    const volume = volumes.find((candidate) => volumeMetadataMatchesIntent(candidate, intent));
    const ownerAlive = !ownerProvenDead(intent.owner);
    if (instance === undefined && volume === undefined) {
      if (intent.quarantined === true) {
        next.push(intent);
        continue;
      }
      if (ownerAlive && (intent.state === "reserved" || intent.state === "creating")) {
        next.push(intent);
        continue;
      }
      if (ownerAlive) {
        next.push(intent);
        continue;
      }
      // Even an absent allocation must cross the repository's fenced
      // destroy-requested state.  In particular, a process can die after the
      // allocation became ready while an operator independently removes the
      // exact VM and volume; skipping the destroy protocol would attempt the
      // invalid ready -> destroyed transition.
      next.push(await destroyAllocation(repository, control, intent, scope.project));
      continue;
    }
    if (intent.state === "destroy-requested") {
      const awaitedObject = intent.acceptanceUnknown === "volume-create" ? volume : instance;
      if (intent.quarantined === true && awaitedObject === undefined) {
        next.push(intent);
        continue;
      }
      next.push(await destroyAllocation(repository, control, intent, scope.project));
      continue;
    }
    if (ownerProvenDead(intent.owner)) {
      next.push(await destroyAllocation(repository, control, intent, scope.project));
      continue;
    }
    next.push(intent);
  }
  // Re-read after detached destroy. The initial inventory can contain an
  // accepted clone whose dependent volume still has the source artifact's
  // metadata; classifying that already-destroyed snapshot as unregistered
  // would turn successful reconciliation into a false lost-allocation error.
  const reconciledInstances = await control.listInstances(scope.project);
  const reconciledVolumes = await control.listVolumes(scope.project, scope.storagePool);
  for (const instance of reconciledInstances) {
    const meta = metadataOf(instance);
    if (meta.executionDomainId !== scope.executionDomainId) continue;
    const owned = next.some((intent) =>
      isActiveIntent(intent)
      && intent.executionDomainId === scope.executionDomainId
      && intent.project === scope.project
      && metadataMatchesIntent(instance, intent)
    );
    if (owned) continue;
    throw incusError(
      "sandbox-allocation-lost",
      `Incus instance ${JSON.stringify(instance.name)} claims execution domain ${JSON.stringify(scope.executionDomainId)} but has no exact IncusRepository allocation intent.`,
      ["Keep the instance in place and restore or explicitly maintain the durable registry; never infer ownership from a name or delete an unregistered object."],
    );
  }
  for (const volume of reconciledVolumes) {
    if (volume.config[INCUS_METADATA.executionDomainId] !== scope.executionDomainId) continue;
    const owned = next.some((intent) => isActiveIntent(intent) && volumeMetadataMatchesIntent(volume, intent));
    if (owned) continue;
    throw incusError(
      "sandbox-allocation-lost",
      `Incus volume ${JSON.stringify(volume.name)} claims execution domain ${JSON.stringify(scope.executionDomainId)} but has no exact IncusRepository allocation intent.`,
      ["Keep the volume in place and restore or explicitly maintain the durable registry; never infer ownership from a name or delete an unregistered object."],
    );
  }
  return Object.freeze({
    intents: Object.freeze(next),
    instances: reconciledInstances,
  });
}

export async function destroyAllocation(
  repository: IncusRepository,
  control: IncusControl,
  intent: AllocationIntent,
  project: string,
): Promise<AllocationIntent> {
  const current = await readAllocationIntent(repository, intent.allocationId);
  if (current === undefined) {
    throw incusError(
      "sandbox-allocation-lost",
      `Sandbox allocation ${JSON.stringify(intent.allocationId)} disappeared from the ledger before destroy.`,
      ["Reconcile the ledger against Incus inventory."],
    );
  }
  if (current.generation !== intent.generation) {
    throw incusError(
      "sandbox-destroy-incomplete",
      `Destroy fenced: ledger generation ${current.generation} does not match caller generation ${intent.generation}.`,
      ["Retry destroy from the current generation only."],
    );
  }
  if (current.executionDomainId !== intent.executionDomainId || current.project !== project) {
    throw incusError(
      "sandbox-destroy-incomplete",
      "Destroy fenced: execution domain or project does not match the caller.",
      ["Destroy only from the owning execution domain and project."],
    );
  }
  const requested = current.state === "destroy-requested"
    ? current
    : await transitionAllocationIntent(repository, current, { ...current, state: "destroy-requested" });
  const instances = await control.listInstances(project);
  const volumes = await control.listVolumes(project, requested.storagePool);
  const matchingInstance = instances.find((candidate) => metadataMatchesIntent(candidate, requested));
  const matchingVolume = volumes.find((candidate) => volumeMetadataMatchesIntent(candidate, requested));
  const instanceName = matchingInstance?.name ?? requested.providerLocator ?? instanceNameFor(requested.allocationId);
  const volumeName = matchingVolume?.name ?? requested.dockerDataVolume ?? volumeNameFor(requested.allocationId);
  const namedInstance = matchingInstance ?? instances.find((candidate) => candidate.name === instanceName);
  const namedVolume = matchingVolume ?? volumes.find((candidate) => candidate.name === volumeName);
  if (namedInstance !== undefined && !metadataMatchesIntent(namedInstance, requested)) {
    throw incusError(
      "sandbox-destroy-incomplete",
      `Refusing to destroy Incus instance ${JSON.stringify(instanceName)} with mismatched allocation metadata.`,
      ["Inspect the instance identity; NiceEval only destroys the exact allocation generation it owns."],
    );
  }
  const inheritedCloneVolume = namedInstance !== undefined
    && namedVolume !== undefined
    && volumeIsDependentOnExactInstance(namedInstance, namedVolume, requested);
  if (
    namedVolume !== undefined
    && !volumeMetadataMatchesIntent(namedVolume, requested)
    && !inheritedCloneVolume
  ) {
    throw incusError(
      "sandbox-destroy-incomplete",
      `Refusing to destroy Incus volume ${JSON.stringify(volumeName)} with mismatched allocation metadata.`,
      ["Inspect the volume identity; NiceEval only destroys the exact allocation generation it owns."],
    );
  }
  if (requested.quarantined === true) {
    const awaitedObject = requested.acceptanceUnknown === "volume-create" ? namedVolume : namedInstance;
    if (awaitedObject === undefined) {
      throw incusError(
        "sandbox-destroy-incomplete",
        `Incus allocation ${JSON.stringify(requested.allocationId)} still has an acceptance-unknown create operation.`,
        ["Keep the allocation quarantined until the expected Incus object appears and can be destroyed by exact metadata."],
      );
    }
  }
  try {
    if (namedInstance !== undefined) await control.deleteInstance(project, namedInstance.name);
    if (namedVolume !== undefined) await control.deleteVolume(project, requested.storagePool, namedVolume.name);
    await control.waitAbsent(project, instanceName);
    await control.waitVolumeAbsent(project, requested.storagePool, volumeName);
    const confirmAbsent = async (): Promise<void> => {
      const leftoverInstance = await control.getInstance(project, instanceName);
      const leftoverVolume = await control.getVolume(project, requested.storagePool, volumeName);
      if (leftoverInstance !== undefined || leftoverVolume !== undefined) {
        throw incusError(
          "sandbox-destroy-incomplete",
          `Incus allocation ${JSON.stringify(requested.allocationId)} still has a VM or custom volume.`,
          ["Retry destroy; do not mark destroyed without absent receipts for both the VM and volume."],
        );
      }
    };
    await confirmAbsent();
  } catch (cause) {
    throw incusError(
      "sandbox-destroy-incomplete",
      `Failed to prove Incus allocation ${JSON.stringify(requested.allocationId)} is absent.`,
      ["Retry destroy from the Incus control plane; NiceEval will not mark the allocation destroyed without absent receipts for the VM and volume."],
      cause,
    );
  }
  return transitionAllocationIntent(repository, requested, {
    ...requested,
    state: "destroyed",
    providerLocator: undefined,
    dockerDataVolume: undefined,
    quarantined: undefined,
    acceptanceUnknown: undefined,
  });
}

export function nextGeneration(existing: AllocationIntent | undefined): number {
  return existing === undefined ? 1 : existing.generation + 1;
}

export function isActiveIntent(intent: AllocationIntent): boolean {
  return OCCUPYING_STATES.has(intent.state);
}

export interface AdmissionLock {
  readonly executionDomainId: string;
  readonly fencingToken: number;
  release(): Promise<void>;
}

export async function acquireDomainAdmissionLock(
  repository: IncusRepository,
  executionDomainId: string,
  options: { readonly waitMs?: number } = {},
): Promise<AdmissionLock> {
  const owner = currentOwner();
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new TypeError("Incus admission lock waitMs must be a finite non-negative number.");
  }
  const deadline = Date.now() + waitMs;
  let expected: IncusAdmissionLease | undefined;
  for (;;) {
    const acquired = await repository.acquireAdmission(executionDomainId, owner, expected);
    if (acquired.acquired) {
      let released = false;
      return {
        executionDomainId,
        fencingToken: acquired.lease.fencingToken,
        release: async () => {
          if (released) return;
          released = true;
          if (!(await repository.releaseAdmission(acquired.lease))) {
            throw incusError(
              "sandbox-capacity-unavailable",
              `Incus admission lock ${JSON.stringify(executionDomainId)} lost its fencing token before release.`,
              ["Stop new admission and reconcile the current IncusRepository lease owner."],
            );
          }
        },
      };
    }
    expected = ownerProvenDead(acquired.lease.owner) ? acquired.lease : undefined;
    if (Date.now() >= deadline) {
      throw incusError(
        "sandbox-capacity-unavailable",
        `Timed out waiting for the Incus admission lock for domain ${JSON.stringify(executionDomainId)}.`,
        ["Retry after the owning control process exits; do not break a live admission lock."],
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
}

export function lostAllocationError(allocationId: string): IncusProviderError {
  return incusError(
    "sandbox-allocation-lost",
    `Sandbox allocation ${JSON.stringify(allocationId)} is active in the ledger but has no Incus instance.`,
    ["Reconcile again after Incus inventory is available; do not recreate from a guessed locator."],
  );
}
