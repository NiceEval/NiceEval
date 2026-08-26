import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  DockerCapacityObservation as ProviderCapacityObservation,
  DockerCacheDomainDescriptor as CacheDomainDescriptor,
} from "../docker/cache-administration.ts";
import {
  DOCKER_CACHE_REPOSITORY_REVISION,
  type DockerHolderIdentity,
  type DockerImageGcLockRow,
  type DockerTaskBuildEntryRow,
} from "./docker-cache-repository.ts";
import { dockerCacheRepository } from "./docker-cache-repository-live.ts";

const execFileAsync = promisify(execFile);
export const DOCKER_CACHE_REGISTRY_SCHEMA_VERSION = DOCKER_CACHE_REPOSITORY_REVISION;
const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TASK_BUILD_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PLAN_TTL_MS = 15 * 60 * 1000;
const PROVIDER_OPERATION_TIMEOUT_MS = 30 * 1000;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return false;
    throw cause;
  }
}

/**
 * v0.13 Docker cache registries remain hostile legacy bytes. This deliberately
 * only probes their presence: it must run before either UserDatabase or Docker
 * is opened and must never inspect, migrate, or delete the old SQLite files.
 */
async function assertNoLegacyDockerCache(): Promise<void> {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const root = join(stateHome, "niceeval", "cache", "v2");
  const locations = [join(root, "domains"), join(root, "catalog.sqlite")];
  const found: string[] = [];
  for (const location of locations) {
    if (await pathExists(location)) found.push(location);
  }
  if (found.length !== 0) {
    throw new Error(`Legacy Docker cache bytes found at ${found.join(", ")}; remove them through authorized maintenance before using Docker cache`);
  }
}

export interface TaskBuildInventoryEntry {
  readonly buildKey: string;
  readonly tag: string;
  readonly imageId: string;
  readonly createdAt: string;
  readonly lastSuccessfulUseAt: string | null;
  readonly protectedUntil: string;
  readonly state: "active-leased" | "cold-reusable" | "unverified";
}

export interface TaskBuildDomainInventory {
  readonly domainId: string;
  readonly providerFamily: "docker";
  readonly backendKind: "docker-images";
  readonly state: "verified-managed";
  readonly entries: readonly TaskBuildInventoryEntry[];
}

export interface TaskBuildCacheService {
  lookup(buildKey: string, tag: string, manifestDigest: string, dockerSocketPath?: string): Promise<boolean>;
  publish(buildKey: string, tag: string, manifestDigest: string, operationId: string, dockerSocketPath?: string): Promise<void>;
  acquireUse(buildKey: string, tag: string, manifestDigest: string, dockerSocketPath?: string): Promise<{ release(): Promise<void> }>;
}

export interface TaskBuildCacheAdminService {
  inventory(): Promise<TaskBuildDomainInventory>;
  planGc(domainId: string): Promise<TaskBuildGcPlan>;
  applyGc(domainId: string, planId: string): Promise<TaskBuildGcOutcome>;
}

export interface TaskBuildGcPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly domainId: string;
  readonly ownerId: string;
  readonly backendIdentity: string;
  readonly authorityEpoch: string;
  readonly policyVersion: 1;
  readonly registrySafetyRevision: number;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly planDigest: string;
  readonly candidates: ReadonlyArray<{
    readonly buildKey: string;
    readonly tag: string;
    readonly imageId: string;
    readonly manifestDigest: string;
    readonly generation: number;
    readonly evidenceDigest: string;
    readonly ruleId: "max-age/task-build";
  }>;
}

export interface DockerCacheDomainHandle {
  readonly domainId: string;
  readonly ownerId: string;
  readonly authorityEpoch: string;
  readonly backendIdentity: string;
}

export interface TaskBuildGcOutcome {
  readonly planId: string;
  readonly domainId: string;
  readonly outcomes: ReadonlyArray<{
    readonly buildKey: string;
    readonly status: "deleted" | "already-absent" | "skipped" | "failed";
    readonly reason: string;
  }>;
}

function domainIdFor(ownerId: string, daemonId: string, storageDriver: string, sentinelId: string): string {
  return createHash("sha256")
    .update(`docker-images\0${ownerId}\0${daemonId}\0${storageDriver}\0${sentinelId}`)
    .digest("hex").slice(0, 24);
}

function inventoryState(actual: string | undefined, expected: string, leases: number): TaskBuildInventoryEntry["state"] {
  return actual !== expected ? "unverified" : leases > 0 ? "active-leased" : "cold-reusable";
}

function passesGcAgePolicy(row: DockerTaskBuildEntryRow, now: number): boolean {
  const lastUse = Date.parse(row.lastSuccessfulUseAt ?? row.createdAt);
  return Date.parse(row.protectedUntil) <= now && now - lastUse >= MAX_TASK_BUILD_AGE_MS;
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestPlan(plan: Omit<TaskBuildGcPlan, "planDigest">): string {
  return canonicalDigest(plan);
}

function entryEvidence(row: DockerTaskBuildEntryRow): Record<string, unknown> {
  return {
    buildKey: row.buildKey,
    imageId: row.imageId,
    manifestDigest: row.manifestDigest,
    generation: row.generation,
    createdAt: row.createdAt,
    lastSuccessfulUseAt: row.lastSuccessfulUseAt,
    protectedUntil: row.protectedUntil,
  };
}

async function docker(args: readonly string[], dockerSocketPath?: string): Promise<string> {
  const connection = dockerSocketPath === undefined ? [] : ["--host", `unix://${dockerSocketPath}`];
  const result = await execFileAsync("docker", [...connection, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: PROVIDER_OPERATION_TIMEOUT_MS,
  });
  return result.stdout.trim();
}

function dockerConfirmedImageAbsent(cause: unknown): boolean {
  const detail = [
    (cause as { readonly stderr?: unknown })?.stderr,
    (cause as { readonly stdout?: unknown })?.stdout,
    cause instanceof Error ? cause.message : undefined,
  ].filter((value): value is string | Buffer => typeof value === "string" || Buffer.isBuffer(value))
    .map((value) => value.toString()).join("\n");
  return /no such (?:image|object)|image .* not found/iu.test(detail);
}

async function imageId(tag: string, dockerSocketPath?: string): Promise<string | undefined> {
  try {
    return await docker(["image", "inspect", "--format", "{{.Id}}", tag], dockerSocketPath);
  } catch (cause) {
    if (dockerConfirmedImageAbsent(cause)) return undefined;
    throw cause;
  }
}

async function hasContainerReference(image: string, dockerSocketPath?: string): Promise<boolean> {
  return (await docker(["ps", "-a", "--filter", `ancestor=${image}`, "--quiet"], dockerSocketPath)).length > 0;
}

function holderIdentity(pid = process.pid): DockerHolderIdentity {
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8").trim();
  const processStart = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u)[19];
  if (bootId.length === 0 || processStart === undefined) throw new Error("cannot verify local process identity");
  return { hostId: "local", bootId, pid, processStart };
}

function processIdentityIsLive(pid: number, bootId: string, processStart: string): boolean {
  try {
    const actual = holderIdentity(pid);
    return actual.bootId === bootId && actual.processStart === processStart;
  } catch {
    return false;
  }
}

function taskBuildKeyFromLock(lock: DockerImageGcLockRow): string | undefined {
  const prefix = "task-build:";
  return lock.entryId.startsWith(prefix) ? lock.entryId.slice(prefix.length) : undefined;
}

function isTaskBuildGcPlan(value: unknown): value is TaskBuildGcPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const plan = value as Partial<TaskBuildGcPlan>;
  return plan.schemaVersion === 1 && plan.policyVersion === 1 && typeof plan.planId === "string" &&
    typeof plan.domainId === "string" && typeof plan.ownerId === "string" && typeof plan.backendIdentity === "string" &&
    typeof plan.authorityEpoch === "string" && typeof plan.planDigest === "string" && typeof plan.expiresAt === "string" &&
    Array.isArray(plan.candidates);
}

async function taskBuildDeleteLockMatchesPlan(
  domain: DockerCacheDomainHandle,
  lock: DockerImageGcLockRow,
  row: DockerTaskBuildEntryRow,
): Promise<boolean> {
  const saved = await dockerCacheRepository.request({
    repository: "docker-cache", operation: "task-get-plan", domainId: domain.domainId, planId: lock.planId,
  });
  if (saved.plan === null || saved.plan.outcome !== null) return false;
  try {
    const value: unknown = JSON.parse(saved.plan.payload);
    if (!isTaskBuildGcPlan(value)) return false;
    const plan = value;
    const { planDigest, ...unsigned } = plan;
    if (saved.plan.digest !== planDigest || digestPlan(unsigned) !== planDigest || plan.domainId !== domain.domainId ||
      plan.ownerId !== domain.ownerId || plan.backendIdentity !== domain.backendIdentity ||
      plan.authorityEpoch !== domain.authorityEpoch || plan.policyVersion !== 1) return false;
    const candidate = plan.candidates.find((item) => item.buildKey === row.buildKey && item.imageId === lock.imageId && item.generation === lock.entryGeneration);
    return candidate !== undefined && candidate.tag === row.tag && candidate.manifestDigest === row.manifestDigest &&
      candidate.evidenceDigest === canonicalDigest(entryEvidence(row));
  } catch {
    return false;
  }
}

async function pruneTaskOwners(domainId: string, buildKey?: string): Promise<number> {
  const owners = await dockerCacheRepository.request({
    repository: "docker-cache", operation: "task-list-owners", domainId,
    ...(buildKey === undefined ? {} : { buildKey }),
  });
  const leaseIds = owners.leases.filter((row) =>
    !processIdentityIsLive(row.holderPid, row.holderBootId, row.holderProcessStart)).map((row) => row.leaseId);
  const rootIds = owners.roots.filter((row) =>
    !processIdentityIsLive(row.holderPid, row.holderBootId, row.holderProcessStart)).map((row) => row.rootId);
  if (leaseIds.length > 0 || rootIds.length > 0) {
    await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-prune-owners", domainId, leaseIds, rootIds });
  }
  return owners.leases.length + owners.roots.length - leaseIds.length - rootIds.length;
}

async function setupPrefixClaimsImage(domainId: string, exactImageId: string): Promise<boolean> {
  const claims = await dockerCacheRepository.request({
    repository: "docker-cache", operation: "setup-image-claims", domainId, imageId: exactImageId, exceptEntryId: "",
  });
  return claims.siblingSetupPrefixClaim;
}

const domainStartupReconciliations = new Map<string, Promise<void>>();

async function reconcileCrashedTaskBuildDeletes(domain: DockerCacheDomainHandle, dockerSocketPath?: string): Promise<void> {
  const listed = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-list-delete-locks", domainId: domain.domainId });
  const allEntries = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-list-entries", domainId: domain.domainId, includeTombstoned: true });
  for (const lock of listed.locks) {
    if (processIdentityIsLive(lock.holderPid, lock.holderBootId, lock.holderProcessStart)) continue;
    const buildKey = taskBuildKeyFromLock(lock);
    const row = buildKey === undefined ? undefined : allEntries.entries.find((entry) =>
      entry.buildKey === buildKey && entry.generation === lock.entryGeneration && entry.imageId === lock.imageId && entry.state === "deleting");
    const settle = async (state: "tombstoned" | "unverified"): Promise<void> => {
      await dockerCacheRepository.request({
        repository: "docker-cache", operation: "task-recover-delete", domainId: domain.domainId,
        lock, buildKey: buildKey ?? "", state,
      });
    };
    if (row === undefined || !await taskBuildDeleteLockMatchesPlan(domain, lock, row)) {
      await settle("unverified");
      continue;
    }
    try {
      const exact = await imageId(lock.imageId, dockerSocketPath);
      if (exact === undefined) {
        await settle("tombstoned");
        continue;
      }
      const locator = await imageId(row.tag, dockerSocketPath);
      const protectedByReference = await pruneTaskOwners(domain.domainId, row.buildKey) > 0 ||
        await setupPrefixClaimsImage(domain.domainId, lock.imageId) || await hasContainerReference(lock.imageId, dockerSocketPath);
      if (exact !== lock.imageId || locator !== lock.imageId || protectedByReference) {
        await settle("unverified");
        continue;
      }
      try {
        await docker(["image", "rm", lock.imageId], dockerSocketPath);
      } catch (cause) {
        if (!dockerConfirmedImageAbsent(cause)) throw cause;
      }
      await settle(await imageId(lock.imageId, dockerSocketPath) === undefined ? "tombstoned" : "unverified");
    } catch {
      await settle("unverified");
    }
  }
}

async function openDomain(dockerSocketPath?: string): Promise<DockerCacheDomainHandle> {
  if (dockerSocketPath !== undefined) throw new Error("managed Docker cache requires the default local Unix socket");
  await assertNoLegacyDockerCache();
  const owner = await dockerCacheRepository.request({
    repository: "docker-cache", operation: "ensure-owner", candidateOwnerId: dockerCacheRepository.newOwnerCandidate(),
  });
  const sentinelName = `niceeval-cache-${createHash("sha256").update(owner.ownerId).digest("hex").slice(0, 16)}`;
  const sentinelLabel = "io.niceeval.cache-domain";
  let sentinelId: string;
  try {
    sentinelId = await docker(["volume", "inspect", "--format", `{{index .Labels \"${sentinelLabel}\"}}`, sentinelName]);
  } catch {
    const candidate = randomUUID();
    await docker(["volume", "create", "--label", `${sentinelLabel}=${candidate}`, sentinelName]);
    sentinelId = await docker(["volume", "inspect", "--format", `{{index .Labels \"${sentinelLabel}\"}}`, sentinelName]);
  }
  if (sentinelId.length === 0 || sentinelId === "<no value>") throw new Error(`Docker cache sentinel ${sentinelName} has no managed identity`);
  const daemonId = await docker(["info", "--format", "{{.ID}}"]);
  const storageDriver = await docker(["info", "--format", "{{.Driver}}"]);
  const domainId = domainIdFor(owner.ownerId, daemonId, storageDriver, sentinelId);
  const backendIdentity = createHash("sha256").update(`${daemonId}\0${storageDriver}\0${sentinelId}`).digest("hex");
  const verified = await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "verify-domain",
    domain: {
      domainId, ownerId: owner.ownerId, daemonId, storageDriver, sentinelId, backendIdentity,
      providerFamily: "docker", adminProtocolVersion: 1, backendKind: "docker-images",
    },
    candidateAuthorityEpoch: randomUUID(),
    verifiedAt: new Date().toISOString(),
  });
  const handle = { domainId, ownerId: owner.ownerId, authorityEpoch: verified.domain.authorityEpoch, backendIdentity };
  let reconciliation = domainStartupReconciliations.get(domainId);
  if (reconciliation === undefined) {
    reconciliation = reconcileCrashedTaskBuildDeletes(handle, dockerSocketPath).catch((cause) => {
      domainStartupReconciliations.delete(domainId);
      throw cause;
    });
    domainStartupReconciliations.set(domainId, reconciliation);
  }
  await reconciliation;
  return handle;
}

/** Shared Docker image-cache authority; persistence is owned by UserDatabase. */
export function openDockerCacheDomain(dockerSocketPath?: string): Promise<DockerCacheDomainHandle> {
  return openDomain(dockerSocketPath);
}

export async function listDockerCacheDomains(): Promise<readonly CacheDomainDescriptor[]> {
  const current = await openDomain();
  const listed = await dockerCacheRepository.request({ repository: "docker-cache", operation: "list-domains" });
  return listed.domains.map((row) => ({
    providerFamily: "docker", adminProtocolVersion: row.adminProtocolVersion, domainId: row.domainId,
    backendKind: row.backendKind, state: row.domainId === current.domainId ? "verified-managed" : "unavailable",
  }));
}

export async function dockerTaskBuildAuthorityFingerprint(): Promise<string> {
  return (await openDomain()).domainId;
}

function decimalBytes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?b)$/iu.exec(value.trim());
  if (match === null) return null;
  const power = ["b", "kb", "mb", "gb", "tb", "pb"].indexOf(match[2]!.toLowerCase());
  return power < 0 ? null : Math.round(Number(match[1]) * 1000 ** power);
}

export async function observeDockerBuildKitCapacity(): Promise<ProviderCapacityObservation> {
  await assertNoLegacyDockerCache();
  const output = await docker(["system", "df", "--format", "json"]);
  const rows = output.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const build = rows.find((row) => row.Type === "Build Cache");
  const reclaimable = typeof build?.Reclaimable === "string" ? build.Reclaimable.trim().split(/\s+/u)[0] : undefined;
  return Object.freeze({
    scope: "provider", providerFamily: "docker", backendKind: "buildkit", state: "unverified",
    observedAt: new Date().toISOString(), totalBytes: decimalBytes(build?.Size),
    reclaimableEstimateBytes: decimalBytes(reclaimable), reason: "shared-builder-unattributed",
  });
}

class LiveTaskBuildCacheSession implements TaskBuildCacheService {
  async lookup(buildKey: string, tag: string, manifestDigest: string, dockerSocketPath?: string): Promise<boolean> {
    const domain = await openDomain(dockerSocketPath);
    const found = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-get-indexed", domainId: domain.domainId, buildKey });
    const row = found.entry;
    if (row === null || row.tag !== tag || row.manifestDigest !== manifestDigest) return false;
    const actual = await imageId(tag, dockerSocketPath);
    if (actual === undefined || actual !== row.imageId) {
      await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-mark-unverified", domainId: domain.domainId, buildKey, generation: row.generation });
      return false;
    }
    return true;
  }

  async publish(buildKey: string, tag: string, manifestDigest: string, operationId: string, dockerSocketPath?: string): Promise<void> {
    await assertNoLegacyDockerCache();
    const actual = await imageId(tag, dockerSocketPath);
    if (actual === undefined) throw new Error(`built image ${tag} is absent after build`);
    const domain = await openDomain(dockerSocketPath);
    const now = new Date();
    await dockerCacheRepository.request({
      repository: "docker-cache", operation: "task-publish", domainId: domain.domainId, buildKey, tag,
      imageId: actual, manifestDigest, operationId, now: now.toISOString(),
      protectedUntil: new Date(now.getTime() + MINIMUM_AGE_MS).toISOString(),
    });
  }

  async acquireUse(buildKey: string, tag: string, manifestDigest: string, dockerSocketPath?: string): Promise<{ release(): Promise<void> }> {
    const domain = await openDomain(dockerSocketPath);
    const found = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-get-indexed", domainId: domain.domainId, buildKey });
    const row = found.entry;
    if (row === null || row.tag !== tag || row.manifestDigest !== manifestDigest || await imageId(tag, dockerSocketPath) !== row.imageId) {
      throw new Error(`Docker task-build artifact ${buildKey.slice(0, 12)} is no longer available`);
    }
    const leaseId = randomUUID();
    const rootId = randomUUID();
    const reserved = await dockerCacheRepository.request({
      repository: "docker-cache", operation: "task-acquire-use", domainId: domain.domainId, buildKey, tag,
      imageId: row.imageId, manifestDigest, leaseId, rootId, holder: holderIdentity(), now: new Date().toISOString(),
    });
    if (!reserved.reserved) throw new Error(`Docker task-build artifact ${buildKey.slice(0, 12)} changed before use`);
    let released = false;
    let heartbeatFailure: unknown;
    const heartbeat = setInterval(() => {
      if (released || heartbeatFailure !== undefined) return;
      void dockerCacheRepository.request({
        repository: "docker-cache", operation: "task-heartbeat", domainId: domain.domainId,
        leaseId, heartbeatAt: new Date().toISOString(),
      }).then((receipt) => {
        if (receipt.changes !== 1) heartbeatFailure = new Error("the durable task-build lease disappeared during use");
      }, (cause) => { heartbeatFailure = cause; });
    }, 30_000);
    heartbeat.unref();
    return {
      async release() {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-release-use", domainId: domain.domainId, leaseId, rootId });
        if (heartbeatFailure !== undefined) throw heartbeatFailure;
      },
    };
  }
}

export function makeTaskBuildCacheService(): TaskBuildCacheService {
  return new LiveTaskBuildCacheSession();
}

export async function inventoryTaskBuildDomain(dockerSocketPath?: string): Promise<TaskBuildDomainInventory> {
  const domain = await openDomain(dockerSocketPath);
  const listed = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-list-entries", domainId: domain.domainId });
  const entries: TaskBuildInventoryEntry[] = [];
  for (const row of listed.entries) {
    const leases = await pruneTaskOwners(domain.domainId, row.buildKey);
    const actual = await imageId(row.tag, dockerSocketPath);
    entries.push({
      buildKey: row.buildKey, tag: row.tag, imageId: row.imageId, createdAt: row.createdAt,
      lastSuccessfulUseAt: row.lastSuccessfulUseAt, protectedUntil: row.protectedUntil,
      state: inventoryState(actual, row.imageId, leases),
    });
  }
  return { domainId: domain.domainId, providerFamily: "docker", backendKind: "docker-images", state: "verified-managed", entries };
}

export async function planTaskBuildGc(domainId: string): Promise<TaskBuildGcPlan> {
  const domain = await openDomain();
  if (domain.domainId !== domainId) throw new Error(`unknown Docker image cache domain ${domainId}`);
  const now = new Date();
  const candidates: TaskBuildGcPlan["candidates"][number][] = [];
  const listed = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-list-entries", domainId });
  for (const row of listed.entries) {
    if (row.state !== "indexed" || !passesGcAgePolicy(row, now.getTime())) continue;
    if (await pruneTaskOwners(domainId, row.buildKey) > 0 || await setupPrefixClaimsImage(domainId, row.imageId)) continue;
    if (await imageId(row.tag) !== row.imageId || await hasContainerReference(row.imageId)) continue;
    candidates.push({
      buildKey: row.buildKey, tag: row.tag, imageId: row.imageId, manifestDigest: row.manifestDigest,
      generation: row.generation, evidenceDigest: canonicalDigest(entryEvidence(row)), ruleId: "max-age/task-build",
    });
  }
  const revision = (await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-read-safety-revision", domainId })).revision;
  const unsigned: Omit<TaskBuildGcPlan, "planDigest"> = {
    schemaVersion: 1, planId: randomUUID(), domainId, ownerId: domain.ownerId,
    backendIdentity: domain.backendIdentity, authorityEpoch: domain.authorityEpoch, policyVersion: 1,
    registrySafetyRevision: revision, observedAt: now.toISOString(), expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(), candidates,
  };
  const plan: TaskBuildGcPlan = { ...unsigned, planDigest: digestPlan(unsigned) };
  await dockerCacheRepository.request({
    repository: "docker-cache", operation: "task-save-plan", domainId, planId: plan.planId,
    createdAt: plan.observedAt, expiresAt: plan.expiresAt, payload: JSON.stringify(plan), digest: plan.planDigest,
  });
  return plan;
}

export async function applyTaskBuildGc(domainId: string, planId: string): Promise<TaskBuildGcOutcome> {
  const domain = await openDomain();
  if (domain.domainId !== domainId) throw new Error(`unknown Docker image cache domain ${domainId}`);
  const saved = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-get-plan", domainId, planId });
  if (saved.plan === null) throw new Error(`unknown GC plan ${planId}`);
  if (saved.plan.outcome !== null) return JSON.parse(saved.plan.outcome) as TaskBuildGcOutcome;
  if (Date.parse(saved.plan.expiresAt) < Date.now()) throw new Error(`GC plan ${planId} expired`);
  const value: unknown = JSON.parse(saved.plan.payload);
  if (!isTaskBuildGcPlan(value)) throw new Error(`GC plan ${planId} is invalid`);
  const plan = value;
  const { planDigest, ...unsigned } = plan;
  if (saved.plan.digest !== planDigest || digestPlan(unsigned) !== planDigest) throw new Error(`GC plan ${planId} is corrupt`);
  if (plan.domainId !== domain.domainId || plan.ownerId !== domain.ownerId || plan.backendIdentity !== domain.backendIdentity ||
    plan.authorityEpoch !== domain.authorityEpoch || plan.policyVersion !== 1) throw new Error(`GC plan ${planId} authority changed`);
  const outcomes: TaskBuildGcOutcome["outcomes"][number][] = [];
  const deleteHolder = holderIdentity();
  for (const candidate of plan.candidates) {
    const listed = await dockerCacheRepository.request({ repository: "docker-cache", operation: "task-list-entries", domainId, includeTombstoned: true });
    const row = listed.entries.find((entry) => entry.buildKey === candidate.buildKey);
    if (row === undefined || row.state !== "indexed" || row.imageId !== candidate.imageId ||
      row.manifestDigest !== candidate.manifestDigest || row.generation !== candidate.generation ||
      canonicalDigest(entryEvidence(row)) !== candidate.evidenceDigest) {
      outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: "entry-or-generation-changed" });
      continue;
    }
    await pruneTaskOwners(domainId, candidate.buildKey);
    const reserved = await dockerCacheRepository.request({
      repository: "docker-cache", operation: "task-reserve-delete", domainId, planId, entry: row,
      evidenceDigest: candidate.evidenceDigest, holder: deleteHolder, createdAt: new Date().toISOString(),
    });
    if (!reserved.reserved) {
      outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: reserved.reason ?? "delete-not-reserved" });
      continue;
    }
    const settle = async (state: "indexed" | "tombstoned" | "unverified"): Promise<void> => {
      await dockerCacheRepository.request({
        repository: "docker-cache", operation: "task-settle-delete", domainId, planId,
        buildKey: candidate.buildKey, imageId: candidate.imageId, generation: candidate.generation, state,
      });
    };
    let actual: string | undefined;
    try {
      actual = await imageId(row.tag);
    } catch (cause) {
      await settle("unverified");
      outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
      continue;
    }
    if (actual === undefined) {
      try {
        const exact = await imageId(candidate.imageId);
        if (exact === undefined) {
          await settle("tombstoned");
          outcomes.push({ buildKey: candidate.buildKey, status: "already-absent", reason: "provider-confirmed-absent" });
        } else {
          await settle("unverified");
          outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: "locator-no-longer-verifies-exact-image" });
        }
      } catch (cause) {
        await settle("unverified");
        outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
      }
      continue;
    }
    if (actual !== candidate.imageId || await setupPrefixClaimsImage(domainId, candidate.imageId) || await hasContainerReference(candidate.imageId)) {
      await settle("unverified");
      outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: "resource-or-reference-changed" });
      continue;
    }
    try {
      await docker(["image", "rm", candidate.imageId]);
      if (await imageId(candidate.imageId) !== undefined || await hasContainerReference(candidate.imageId)) {
        await settle("unverified");
        outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: "image-still-present" });
        continue;
      }
      await settle("tombstoned");
      outcomes.push({ buildKey: candidate.buildKey, status: "deleted", reason: "max-age/task-build" });
    } catch (cause) {
      await settle("unverified");
      outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  const outcome: TaskBuildGcOutcome = { planId, domainId, outcomes };
  await dockerCacheRepository.request({
    repository: "docker-cache", operation: "task-save-plan-outcome", domainId, planId, outcome: JSON.stringify(outcome),
  });
  return outcome;
}

export const liveTaskBuildCacheAdminService: TaskBuildCacheAdminService = Object.freeze({
  inventory: inventoryTaskBuildDomain,
  planGc: planTaskBuildGc,
  applyGc: applyTaskBuildGc,
});
