import { createHash } from "node:crypto";
import { Either, Schema } from "effect";
import { closeSync, constants, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { classifyRunIdentity } from "../run-identity.ts";
import { INCUS_METADATA, type IncusControl, type IncusInstance, type IncusVolume } from "./control.ts";
import { incusError, type IncusProviderError } from "./errors.ts";

const ParseOptions = Object.freeze({
  errors: "all" as const,
  exact: true,
  onExcessProperty: "error" as const,
});

export const ALLOCATION_STATES = Object.freeze([
  "reserved",
  "creating",
  "ready",
  "handed-off",
  "destroy-requested",
  "destroyed",
  "lost",
] as const);

export type AllocationState = (typeof ALLOCATION_STATES)[number];

const OwnerSchema = Schema.Struct({
  host: Schema.String,
  pid: Schema.Number,
  startedAt: Schema.String,
});

const AllocationIntentSchema = Schema.Struct({
  allocationId: Schema.String,
  executionId: Schema.String,
  provider: Schema.Literal("incus"),
  generation: Schema.Number,
  requirementDigest: Schema.String,
  artifactDigest: Schema.String,
  requestedDockerDataBytes: Schema.Number,
  executionDomainId: Schema.String,
  project: Schema.String,
  storagePool: Schema.String,
  provisionToken: Schema.String,
  owner: OwnerSchema,
  providerLocator: Schema.optional(Schema.String),
  dockerDataVolume: Schema.optional(Schema.String),
  quarantined: Schema.optional(Schema.Boolean),
  acceptanceUnknown: Schema.optional(Schema.Literal("volume-create", "instance-create")),
  expectedTerminal: Schema.Literal("destroyed"),
  state: Schema.Literal(
    "reserved",
    "creating",
    "ready",
    "handed-off",
    "destroy-requested",
    "destroyed",
    "lost",
  ),
});

export interface AllocationOwner {
  readonly host: string;
  readonly pid: number;
  readonly startedAt: string;
}

export interface AllocationIntent {
  readonly allocationId: string;
  readonly executionId: string;
  readonly provider: "incus";
  readonly generation: number;
  readonly requirementDigest: string;
  readonly artifactDigest: string;
  readonly requestedDockerDataBytes: number;
  readonly executionDomainId: string;
  readonly project: string;
  readonly storagePool: string;
  readonly provisionToken: string;
  readonly owner: AllocationOwner;
  readonly providerLocator?: string;
  readonly dockerDataVolume?: string;
  readonly quarantined?: boolean;
  readonly acceptanceUnknown?: "volume-create" | "instance-create";
  readonly expectedTerminal: "destroyed";
  readonly state: AllocationState;
}

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

export function allocationsDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "niceeval", "sandbox-allocations");
}

function intentPath(allocationId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(allocationsDir(env), `${allocationId}.json`);
}

function lockPath(executionDomainId: string, env: NodeJS.ProcessEnv = process.env): string {
  const digest = createHash("sha256").update(executionDomainId).digest("hex");
  return join(allocationsDir(env), "locks", `${digest}.lock`);
}

function decodeIntent(value: unknown, path: string): AllocationIntent {
  const decoded = Schema.decodeUnknownEither(AllocationIntentSchema, ParseOptions)(value);
  if (Either.isLeft(decoded)) {
    throw incusError(
      "incus-descriptor-invalid",
      `Sandbox allocation intent ${JSON.stringify(path)} is not a valid Incus ledger record.`,
      ["Delete the corrupt intent only after Incus inventory proves the instance is absent."],
      decoded.left,
    );
  }
  return Object.freeze({
    ...decoded.right,
    owner: Object.freeze({ ...decoded.right.owner }),
    ...(decoded.right.providerLocator === undefined ? {} : { providerLocator: decoded.right.providerLocator }),
    ...(decoded.right.dockerDataVolume === undefined ? {} : { dockerDataVolume: decoded.right.dockerDataVolume }),
    ...(decoded.right.quarantined === true ? { quarantined: true } : {}),
    ...(decoded.right.acceptanceUnknown === undefined
      ? {}
      : { acceptanceUnknown: decoded.right.acceptanceUnknown }),
  });
}

export async function writeAllocationIntent(
  intent: AllocationIntent,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AllocationIntent> {
  const frozen = Object.freeze({
    ...intent,
    owner: Object.freeze({ ...intent.owner }),
  });
  const dir = allocationsDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = intentPath(intent.allocationId, env);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(frozen)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, target);
  return frozen;
}

export async function readAllocationIntent(
  allocationId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AllocationIntent | undefined> {
  const path = intentPath(allocationId, env);
  try {
    const text = await readFile(path, "utf8");
    return decodeIntent(JSON.parse(text), path);
  } catch (cause) {
    const code = cause !== null && typeof cause === "object" && "code" in cause
      ? String((cause as { readonly code?: unknown }).code)
      : "";
    if (code === "ENOENT") return undefined;
    throw cause;
  }
}

export async function listAllocationIntents(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly AllocationIntent[]> {
  const dir = allocationsDir(env);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (cause) {
    const code = cause !== null && typeof cause === "object" && "code" in cause
      ? String((cause as { readonly code?: unknown }).code)
      : "";
    if (code === "ENOENT") return Object.freeze([]);
    throw cause;
  }
  const intents: AllocationIntent[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    const text = await readFile(path, "utf8");
    intents.push(decodeIntent(JSON.parse(text), path));
  }
  return Object.freeze(intents);
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

export async function reconcileDomain(
  control: IncusControl,
  scope: { readonly executionDomainId: string; readonly project: string; readonly storagePool: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  readonly intents: readonly AllocationIntent[];
  readonly instances: readonly IncusInstance[];
}> {
  const intents = await listAllocationIntents(env);
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
      next.push(await writeAllocationIntent({
        ...intent,
        state: "destroyed",
        providerLocator: undefined,
        dockerDataVolume: undefined,
        quarantined: undefined,
      }, env));
      continue;
    }
    if (intent.state === "destroy-requested") {
      const awaitedObject = intent.acceptanceUnknown === "volume-create" ? volume : instance;
      if (intent.quarantined === true && awaitedObject === undefined) {
        next.push(intent);
        continue;
      }
      next.push(await destroyAllocation(control, intent, scope.project, env));
      continue;
    }
    if (ownerProvenDead(intent.owner)) {
      next.push(await destroyAllocation(control, intent, scope.project, env));
      continue;
    }
    next.push(intent);
  }
  for (const instance of instances) {
    const meta = metadataOf(instance);
    if (meta.executionDomainId !== scope.executionDomainId) continue;
    if (
      meta.allocationId === undefined
      || meta.generation === undefined
      || meta.artifactDigest === undefined
      || meta.provisionToken === undefined
      || meta.host === undefined
      || meta.pid === undefined
      || meta.startedAt === undefined
    ) {
      continue;
    }
    const owned = intents.some((intent) =>
      intent.executionDomainId === scope.executionDomainId
      && intent.project === scope.project
      && metadataMatchesIntent(instance, intent)
    );
    if (owned) continue;
    if (!ownerProvenDead({ host: meta.host, pid: meta.pid, startedAt: meta.startedAt })) continue;
    await destroyMatchingOrphan(control, instance, volumes, scope);
  }
  return Object.freeze({
    intents: Object.freeze(next),
    instances: await control.listInstances(scope.project),
  });
}

async function destroyMatchingOrphan(
  control: IncusControl,
  instance: IncusInstance,
  volumes: readonly IncusVolume[],
  scope: { readonly project: string; readonly storagePool: string },
): Promise<void> {
  await control.deleteInstance(scope.project, instance.name);
  await control.waitAbsent(scope.project, instance.name);
  const meta = metadataOf(instance);
  const volume = volumes.find((candidate) =>
    candidate.config[INCUS_METADATA.allocationId] === meta.allocationId
    && candidate.config[INCUS_METADATA.generation] === String(meta.generation)
    && candidate.config[INCUS_METADATA.executionDomainId] === meta.executionDomainId
    && candidate.config[INCUS_METADATA.artifactDigest] === meta.artifactDigest
    && candidate.config[INCUS_METADATA.provisionToken] === meta.provisionToken
  );
  if (volume !== undefined) {
    await control.deleteVolume(scope.project, scope.storagePool, volume.name);
    await control.waitVolumeAbsent(scope.project, scope.storagePool, volume.name);
  }
}

export async function destroyAllocation(
  control: IncusControl,
  intent: AllocationIntent,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AllocationIntent> {
  const current = await readAllocationIntent(intent.allocationId, env);
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
    : await writeAllocationIntent({ ...current, state: "destroy-requested" }, env);
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
  if (namedVolume !== undefined && !volumeMetadataMatchesIntent(namedVolume, requested)) {
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
  return writeAllocationIntent({
    ...requested,
    state: "destroyed",
    providerLocator: undefined,
    dockerDataVolume: undefined,
    quarantined: undefined,
    acceptanceUnknown: undefined,
  }, env);
}

export function nextGeneration(existing: AllocationIntent | undefined): number {
  return existing === undefined ? 1 : existing.generation + 1;
}

export function isActiveIntent(intent: AllocationIntent): boolean {
  return OCCUPYING_STATES.has(intent.state);
}

export interface AdmissionLock {
  readonly executionDomainId: string;
  release(): void;
}

function readLockOwner(path: string): AllocationOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const decoded = Schema.decodeUnknownEither(OwnerSchema, ParseOptions)(parsed);
    if (Either.isLeft(decoded)) return undefined;
    return decoded.right;
  } catch {
    return undefined;
  }
}

export async function acquireDomainAdmissionLock(
  executionDomainId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdmissionLock> {
  const dir = join(allocationsDir(env), "locks");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = lockPath(executionDomainId, env);
  const owner = currentOwner();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try {
        writeSync(fd, `${JSON.stringify(owner)}\n`);
      } finally {
        closeSync(fd);
      }
      let released = false;
      return {
        executionDomainId,
        release: () => {
          if (released) return;
          released = true;
          try {
            unlinkSync(path);
          } catch (cause) {
            const code = cause !== null && typeof cause === "object" && "code" in cause
              ? String((cause as { readonly code?: unknown }).code)
              : "";
            if (code !== "ENOENT") throw cause;
          }
        },
      };
    } catch (cause) {
      const code = cause !== null && typeof cause === "object" && "code" in cause
        ? String((cause as { readonly code?: unknown }).code)
        : "";
      if (code !== "EEXIST") throw cause;
      const existing = readLockOwner(path);
      if (existing !== undefined && ownerProvenDead(existing)) {
        try {
          unlinkSync(path);
        } catch {
          // Another waiter may have claimed the stale lock.
        }
      } else if (Date.now() >= deadline) {
        throw incusError(
          "sandbox-capacity-unavailable",
          `Timed out waiting for the Incus admission lock for domain ${JSON.stringify(executionDomainId)}.`,
          ["Retry after the owning control process exits; do not break a live admission lock."],
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  }
}

export function lostAllocationError(allocationId: string): IncusProviderError {
  return incusError(
    "sandbox-allocation-lost",
    `Sandbox allocation ${JSON.stringify(allocationId)} is active in the ledger but has no Incus instance.`,
    ["Reconcile again after Incus inventory is available; do not recreate from a guessed locator."],
  );
}
