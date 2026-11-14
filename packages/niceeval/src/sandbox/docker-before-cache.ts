import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import Docker from "dockerode";
import { Effect } from "effect";
import { beforeCacheReplacementScope } from "./before-cache-replacement.ts";
import { sandboxActionStateCovers, sandboxState } from "./action.ts";
import {
  BeforeCacheCaptureError,
  BeforeCacheCleanupError,
  BeforeCacheLookupError,
  BeforeCacheRegistryError,
  BeforeCacheRestoreError,
  BeforeCacheValidationError,
  type AttemptBeforeCache,
  type AttemptBeforeCacheCapture,
  type BeforeCacheEligibility,
  type BeforeCacheError,
  type AttemptBeforeCacheLookup,
  type BeforeCacheDeclaration,
  type BeforeCacheStep,
} from "./backend.ts";
import {
  openDockerCacheDomain,
  type DockerCacheDomainHandle,
} from "./docker-task-build-cache.ts";
import {
  type DockerHolderIdentity,
  type DockerBeforeCacheEntryRow as RepositoryBeforeCacheEntryRow,
  type DockerBeforeCacheManifestFields,
  type DockerBeforeCacheHoldRow,
} from "./docker-cache-repository.ts";
import { dockerCacheRepository } from "./docker-cache-repository-live.ts";

const CACHE_KIND = "sandbox-before-cache";
const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const LEASE_HEARTBEAT_MS = 10 * 1000;
const LEASE_TTL_MS = 60 * 1000;
const LEASE_RECONCILE_GRACE_MS = 30 * 1000;
const PROVIDER_CLEANUP_TIMEOUT_MS = 30 * 1000;

const LABEL = Object.freeze({
  kind: "io.niceeval.cache.kind",
  domainId: "io.niceeval.cache.domain-id",
  entryId: "io.niceeval.cache.before-cache.entry-id",
  operationId: "io.niceeval.cache.before-cache.operation-id",
  generation: "io.niceeval.cache.before-cache.generation",
  beforeCacheKey: "io.niceeval.cache.before-cache.key",
  baseIdentity: "io.niceeval.cache.before-cache.base-identity",
  declarationDigest: "io.niceeval.cache.before-cache.declaration-digest",
  metadataDigest: "io.niceeval.cache.before-cache.metadata-digest",
  cacheFormat: "io.niceeval.cache.before-cache.format",
  dependency: "io.niceeval.cache.before-cache.dependency",
});

type BeforeCacheEntryState =
  | "reserved"
  | "building"
  | "published"
  | "indexed"
  | "invalidated"
  | "deleting"
  | "tombstoned"
  | "unverified";

interface BeforeCacheEntryRow {
  readonly entry_id: string;
  readonly before_cache_key: string;
  readonly base_identity: string;
  readonly image_id: string | null;
  readonly declaration_json: string;
  readonly metadata_digest: string;
  readonly declaration_digest: string;
  readonly cache_format: string;
  readonly dependency: "parent-backed";
  readonly change_frequency: number;
  readonly generation: number;
  readonly operation_id: string;
  readonly created_at: string;
  readonly last_successful_use_at: string | null;
  readonly protected_until: string;
  readonly state: BeforeCacheEntryState;
}

interface ValidatedManifest {
  readonly value: BeforeCacheDeclaration;
  readonly declarationJson: string;
  readonly metadataDigest: string;
}

function replacementScope(input: BeforeCacheStep, executionDomainId: string, baseReference: string): string {
  return beforeCacheReplacementScope({ provider: "docker", executionDomainId, baseReference }, input);
}

interface HolderIdentity {
  readonly hostId: string;
  readonly bootId: string;
  readonly pid: number;
  readonly processStart: string;
}

function repositoryHolder(holder: HolderIdentity): DockerHolderIdentity {
  return { hostId: holder.hostId, bootId: holder.bootId, pid: holder.pid, processStart: holder.processStart };
}

function repositoryManifest(manifest: ValidatedManifest): DockerBeforeCacheManifestFields {
  return {
    beforeCacheKey: manifest.value.beforeCacheKey,
    baseIdentity: manifest.value.baseIdentity,
    declarationJson: manifest.declarationJson,
    metadataDigest: manifest.metadataDigest,
    declarationDigest: manifest.value.declarationDigest,
    cacheFormat: manifest.value.cacheFormat,
    changeFrequency: manifest.value.changeFrequency,
  };
}

function localEntry(row: RepositoryBeforeCacheEntryRow): BeforeCacheEntryRow {
  return {
    entry_id: row.entryId,
    before_cache_key: row.beforeCacheKey,
    base_identity: row.baseIdentity,
    image_id: row.imageId,
    declaration_json: row.declarationJson,
    metadata_digest: row.metadataDigest,
    declaration_digest: row.declarationDigest,
    cache_format: row.cacheFormat,
    dependency: row.dependency,
    change_frequency: row.changeFrequency,
    generation: row.generation,
    operation_id: row.operationId,
    created_at: row.createdAt,
    last_successful_use_at: row.lastSuccessfulUseAt,
    protected_until: row.protectedUntil,
    state: row.state,
  };
}

export interface DockerBeforeCacheHoldOwnership {
  readonly containerId: string;
  readonly release: () => Promise<void>;
}

/** Narrow Docker target. Registry code never reaches into DockerSandbox implementation fields. */
export interface DockerBeforeCacheTarget {
  readonly baseReference: string;
  readonly eligibility: () => BeforeCacheEligibility;
  readonly captureExactImage: (
    labels: Readonly<Record<string, string>>,
    knownSensitiveValues: readonly string[],
    signal: AbortSignal,
  ) => Promise<string>;
  /** Must DestroyOnly-retire the old/current instance before creating the exact-image private clone. */
  readonly rebaseToExactImage: (
    imageId: string,
    plannedContainerName: string,
    signal: AbortSignal,
  ) => Promise<{ readonly containerId: string; readonly imageId: string }>;
  /** Used only when a restore/rebase failed after creating a partial provider reference. */
  readonly destroyCurrentForCacheRecovery: () => Promise<void>;
  readonly adoptBeforeCacheHold: (hold: DockerBeforeCacheHoldOwnership) => void;
  /** Exact pristine Base recovery on the same stable backend object. */
  readonly fallBackToBase: (
    signal: AbortSignal,
  ) => Promise<{ readonly baseIdentity: string; readonly sandboxId: string }>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function safeFailureClass(cause: unknown): string {
  const message = errorMessage(cause);
  if (/cannot start a transaction within a transaction/iu.test(message)) return "transaction-already-active";
  if (/database is locked|SQLITE_BUSY/iu.test(message)) return "registry-busy";
  if (/schema|missing columns|no such table/iu.test(message)) return "registry-schema";
  if (/Docker|daemon|volume|image/iu.test(message)) return "provider-inventory";
  if (/lease/iu.test(message)) return "lease";
  return "registry-operation";
}

function isBeforeCacheError(cause: unknown): cause is BeforeCacheError {
  if (typeof cause !== "object" || cause === null || !("_tag" in cause)) return false;
  return new Set([
    "BeforeCacheRegistryError",
    "BeforeCacheLookupError",
    "BeforeCacheCaptureError",
    "BeforeCacheRestoreError",
    "BeforeCacheValidationError",
    "BeforeCacheCleanupError",
  ]).has(String((cause as { readonly _tag: unknown })._tag));
}

function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, path: string): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError(`${path} contains a non-finite number`);
      return Object.is(item, -0) ? 0 : item;
    }
    if (Array.isArray(item)) {
      if (seen.has(item)) throw new TypeError(`${path} contains a cycle`);
      seen.add(item);
      const result = item.map((entry, index) => visit(entry, `${path}[${index}]`));
      seen.delete(item);
      return result;
    }
    if (typeof item === "object") {
      if (seen.has(item)) throw new TypeError(`${path} contains a cycle`);
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must contain only JSON records and arrays`);
      }
      seen.add(item);
      // A null-prototype record keeps JSON keys such as `__proto__` and
      // `constructor` as ordinary own data properties. Assigning either key to
      // `{}` must not invoke an inherited setter or change canonical output.
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(item as Record<string, unknown>).sort()) {
        const entry = (item as Record<string, unknown>)[key];
        if (entry === undefined) throw new TypeError(`${path}.${key} is undefined`);
        result[key] = visit(entry, `${path}.${key}`);
      }
      seen.delete(item);
      return result;
    }
    throw new TypeError(`${path} contains unsupported ${typeof item}`);
  };
  return JSON.stringify(visit(value, "declarationMetadata"));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateIdentity(value: string, field: string): void {
  if (value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${field} must be a non-empty bounded identity without control characters`);
  }
}

function validateOperation(input: BeforeCacheStep): ValidatedManifest {
  validateIdentity(input.operationId, "operationId");
  validateIdentity(input.declaration.baseIdentity, "baseIdentity");
  if (!exactImageId(input.declaration.baseIdentity)) {
    throw new TypeError("baseIdentity must be an exact Docker image id");
  }
  validateIdentity(input.declaration.beforeCacheKey, "beforeCacheKey");
  validateIdentity(input.declaration.declarationDigest, "declarationDigest");
  if (
    input.declaration.requiredState !== sandboxState.all &&
    input.declaration.requiredState !== sandboxState.dockerData
  ) {
    throw new TypeError("requiredState must be sandboxState.all or sandboxState.dockerData");
  }
  validateIdentity(input.declaration.cacheFormat, "cacheFormat");
  if (!Number.isFinite(input.declaration.changeFrequency) || input.declaration.changeFrequency < 0) {
    throw new TypeError("changeFrequency must be a finite non-negative number");
  }
  const declarationJson = canonicalJson(input.declaration.declarationMetadata);
  const metadataDigest = digest(declarationJson);
  if (
    input.declaration.beforeCacheKey !== `prefix:${metadataDigest}` ||
    input.declaration.declarationDigest !== `sha256:${metadataDigest}`
  ) {
    throw new TypeError("before-cache key and manifest digest must match the complete canonical declaration metadata");
  }
  return {
    value: input.declaration,
    declarationJson,
    metadataDigest,
  };
}

const domainStartupReconciliations = new Map<string, Promise<void>>();

async function reconcileBeforeCacheDomainAtStartup(domain: DockerCacheDomainHandle): Promise<void> {
  // Startup reconciliation is shared by callers, so it owns a bounded signal
  // instead of borrowing one caller's cancellation. A cache-operation
  // finalizer may join this promise, but never indefinitely.
  const signal = AbortSignal.timeout(PROVIDER_CLEANUP_TIMEOUT_MS);
  const snapshot = await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-startup-snapshot",
    domainId: domain.domainId,
  });
  for (const lock of snapshot.locks) {
    if (processIdentityIsLive(lock.holderPid, lock.holderBootId, lock.holderProcessStart)) continue;
    const entry = snapshot.entries.find((candidate) =>
      candidate.entryId === lock.entryId && candidate.generation === lock.entryGeneration &&
      candidate.imageId === lock.imageId && candidate.state === "deleting");
    let state: "indexed" | "tombstoned" | "unverified" = "unverified";
    if (entry !== undefined) {
      try {
        state = await inspectExactImageOrAbsent(lock.imageId, signal) === undefined ? "tombstoned" : "indexed";
      } catch {
        // Provider uncertainty cannot authorize deletion or a reusable hit.
      }
    }
    await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-settle-delete",
      domainId: domain.domainId,
      entryId: lock.entryId,
      imageId: lock.imageId,
      generation: lock.entryGeneration,
      state,
    });
  }
  const now = Date.now();
  const deleteLeaseIds: string[] = [];
  const unverifiableLeaseIds: string[] = [];
  for (const lease of snapshot.leases) {
    if (Date.parse(lease.expiresAt) + LEASE_RECONCILE_GRACE_MS >= now) continue;
    if (lease.holderHostId !== hostname() || processIdentityIsLive(lease.holderPid, lease.holderBootId, lease.holderProcessStart)) {
      unverifiableLeaseIds.push(lease.leaseId);
    } else {
      deleteLeaseIds.push(lease.leaseId);
    }
  }
  if (deleteLeaseIds.length > 0 || unverifiableLeaseIds.length > 0) {
    await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-prune-leases",
      domainId: domain.domainId,
      deleteLeaseIds,
      unverifiableLeaseIds,
    });
  }
  const removed = new Set(deleteLeaseIds);
  const ownedEntryIds = new Set(snapshot.leases.filter((lease) => !removed.has(lease.leaseId)).map((lease) => lease.entryId));
  const incomplete = snapshot.entries.filter((row) => row.state === "reserved" || row.state === "building").map(localEntry);
  for (const row of incomplete) {
    // A live or not-yet-verifiably-expired build lease owns this promotion. A
    // dead writer is isolated; any image it produced remains an unverified
    // registry/provider claim and is never auto-adopted or auto-deleted.
    if (ownedEntryIds.has(row.entry_id)) continue;
    const images = await new Docker().listImages({
      all: true,
      abortSignal: signal,
      filters: {
        label: [
          `${LABEL.kind}=${CACHE_KIND}`,
          `${LABEL.domainId}=${domain.domainId}`,
          `${LABEL.entryId}=${row.entry_id}`,
        ],
      },
    });
    const verifiedClaims: string[] = [];
    for (const image of images) {
      if (!exactImageId(image.Id)) continue;
      try {
        const inspection = await inspectExactImage(image.Id, signal);
        validateImageLabels(inspection, image.Id, labelsFor(domain, row));
        verifiedClaims.push(image.Id);
      } catch {
        // A label-only or mismatched object is not enough to select an identity.
      }
    }
    await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-startup-isolate",
      domainId: domain.domainId,
      entryId: row.entry_id,
      imageId: verifiedClaims.length === 1 ? verifiedClaims[0]! : null,
    });
  }

  const rows = snapshot.entries.filter((row) => row.state === "published" || row.state === "indexed").map(localEntry);
  for (const row of rows) {
    let valid = row.image_id !== null && exactImageId(row.image_id);
    if (valid) {
      const inspection = await inspectExactImageOrAbsent(row.image_id!, signal);
      if (inspection === undefined) valid = false;
      else {
        try {
          validateImageLabels(inspection, row.image_id!, labelsFor(domain, row));
        } catch {
          valid = false;
        }
      }
    }
    await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-startup-validate",
      domainId: domain.domainId,
      entryId: row.entry_id,
      valid,
    });
  }
}

async function openBeforeCacheDomain(): Promise<DockerCacheDomainHandle> {
  const domain = await openDockerCacheDomain();
  let reconciliation = domainStartupReconciliations.get(domain.domainId);
  if (reconciliation === undefined) {
    reconciliation = reconcileBeforeCacheDomainAtStartup(domain).catch((cause) => {
      domainStartupReconciliations.delete(domain.domainId);
      throw cause;
    });
    domainStartupReconciliations.set(domain.domainId, reconciliation);
  }
  await reconciliation;
  return domain;
}

function holderIdentity(pid = process.pid): HolderIdentity {
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8").trim();
  const processStart = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u)[19];
  if (bootId.length === 0 || processStart === undefined) throw new Error("cannot verify local process identity");
  return { hostId: hostname(), bootId, pid, processStart };
}

function processIdentityIsLive(pid: number, bootId: string, processStart: string): boolean {
  try {
    const actual = holderIdentity(pid);
    return actual.bootId === bootId && actual.processStart === processStart;
  } catch {
    return false;
  }
}

function labelsFor(domain: DockerCacheDomainHandle, row: BeforeCacheEntryRow): Readonly<Record<string, string>> {
  return Object.freeze({
    [LABEL.kind]: CACHE_KIND,
    [LABEL.domainId]: domain.domainId,
    [LABEL.entryId]: row.entry_id,
    [LABEL.operationId]: row.operation_id,
    [LABEL.generation]: String(row.generation),
    [LABEL.beforeCacheKey]: row.before_cache_key,
    [LABEL.baseIdentity]: row.base_identity,
    [LABEL.declarationDigest]: row.declaration_digest,
    [LABEL.metadataDigest]: row.metadata_digest,
    [LABEL.cacheFormat]: row.cache_format,
    [LABEL.dependency]: row.dependency,
  });
}

function exactImageId(imageId: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(imageId);
}

function abortableDockerRead<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener("abort", aborted);
        reject(cause);
      },
    );
  });
}

async function inspectExactImage(imageId: string, signal?: AbortSignal): Promise<Docker.ImageInspectInfo> {
  if (!exactImageId(imageId)) throw new Error(`registry resource identity is not an exact Docker image id: ${imageId}`);
  return abortableDockerRead(
    new Docker().getImage(imageId).inspect(signal === undefined ? {} : { abortSignal: signal } as Docker.ImageInspectOptions & {
      readonly abortSignal: AbortSignal;
    }),
    signal,
  );
}

async function inspectExactImageOrAbsent(
  imageId: string,
  signal?: AbortSignal,
): Promise<Docker.ImageInspectInfo | undefined> {
  try {
    return await inspectExactImage(imageId, signal);
  } catch (cause) {
    const statusCode = (cause as { readonly statusCode?: unknown })?.statusCode;
    const message = cause instanceof Error ? cause.message : String(cause);
    if (statusCode === 404 || /no such (?:image|object)|image .* not found/iu.test(message)) {
      return undefined;
    }
    throw cause;
  }
}

function validateImageLabels(
  inspection: Docker.ImageInspectInfo,
  imageId: string,
  expected: Readonly<Record<string, string>>,
): void {
  if (inspection.Id !== imageId) throw new Error(`Docker inspect returned ${inspection.Id} for exact image ${imageId}`);
  const actual = inspection.Config?.Labels ?? {};
  if (actual[LABEL.cacheFormat] !== expected[LABEL.cacheFormat]) {
    throw new Error(`Docker cache image ${imageId} was written by an older NiceEval or has an unsupported format; reconcile its consumers, clean up this image, and rerun.`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) throw new Error(`Docker image ${imageId} has invalid managed label ${key}`);
  }
}

async function hasContainerReference(imageId: string, signal?: AbortSignal): Promise<boolean> {
  const rows = await new Docker().listContainers({
    all: true,
    filters: { ancestor: [imageId] },
    ...(signal === undefined ? {} : { abortSignal: signal }),
  });
  return rows.length > 0;
}

async function containerExists(containerId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await abortableDockerRead(new Docker().getContainer(containerId).inspect(), signal);
    return true;
  } catch (cause) {
    if ((cause as { readonly statusCode?: number }).statusCode === 404) return false;
    throw cause;
  }
}

class BeforeCacheLease {
  private released = false;
  private heartbeatFailure: unknown;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(
    readonly domain: DockerCacheDomainHandle,
    readonly row: BeforeCacheEntryRow,
    readonly leaseId: string,
    readonly kind: "build" | "handoff",
  ) {
    this.heartbeat = setInterval(() => {
      if (this.released || this.heartbeatFailure !== undefined) return;
      const now = Date.now();
      void dockerCacheRepository.request({
        repository: "docker-cache",
        operation: "before-cache-heartbeat",
        domainId: this.domain.domainId,
        leaseId: this.leaseId,
        heartbeatAt: new Date(now).toISOString(),
        expiresAt: new Date(now + LEASE_TTL_MS).toISOString(),
      }).then((updated) => {
        if (updated.changes !== 1) this.heartbeatFailure = new Error("the durable before-cache lease disappeared during use");
      }, (cause) => {
        // Preserve the durable row as a GC veto; surface this failure at release.
        this.heartbeatFailure = cause;
      });
    }, LEASE_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    clearInterval(this.heartbeat);
    let releaseFailure: unknown;
    try {
      const removed = await dockerCacheRepository.request({
        repository: "docker-cache",
        operation: "before-cache-release-lease",
        domainId: this.domain.domainId,
        leaseId: this.leaseId,
      });
      if (removed.changes !== 1) releaseFailure = new Error("the durable before-cache lease disappeared before release");
    } catch (cause) {
      releaseFailure = cause;
    }
    const failure = releaseFailure ?? this.heartbeatFailure;
    if (failure !== undefined) {
      throw new BeforeCacheCleanupError({
        operation: `release before-cache ${this.kind} lease`,
        reason: errorMessage(failure),
        beforeCacheKey: this.row.before_cache_key,
        domainId: this.domain.domainId,
        cause: failure,
      });
    }
  }
}

async function acquireIndexedLease(
  operation: BeforeCacheStep,
  manifest: ValidatedManifest,
  expectedEntryId?: string,
): Promise<BeforeCacheLease | undefined> {
  const domain = await openBeforeCacheDomain();
  const holder = holderIdentity();
  const leaseId = randomUUID();
  const now = Date.now();
  const acquired = await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-acquire-indexed",
    domainId: domain.domainId,
    manifest: repositoryManifest(manifest),
    ...(expectedEntryId === undefined ? {} : { expectedEntryId }),
    leaseId,
    operationId: operation.operationId,
    holder: repositoryHolder(holder),
    now: new Date(now).toISOString(),
    expiresAt: new Date(now + LEASE_TTL_MS).toISOString(),
  });
  return acquired.entry === null
    ? undefined
    : new BeforeCacheLease(domain, localEntry(acquired.entry), leaseId, "handoff");
}

async function markEntryUnverified(entryId: string): Promise<void> {
  const domain = await openBeforeCacheDomain();
  await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-mark-unverified",
    domainId: domain.domainId,
    entryId,
  });
}

async function releaseDurableHold(input: {
  readonly domainId: string;
  readonly holdId: string;
  readonly entryId: string;
  readonly containerId: string;
  readonly beforeCacheKey: string;
}): Promise<void> {
  const domain = await openBeforeCacheDomain();
  try {
    if (domain.domainId !== input.domainId) throw new Error("Docker cache Domain authority changed while releasing a hold");
    await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-begin-hold-release",
      domainId: domain.domainId,
      holdId: input.holdId,
      entryId: input.entryId,
      containerId: input.containerId,
    });
    if (await containerExists(input.containerId, AbortSignal.timeout(PROVIDER_CLEANUP_TIMEOUT_MS))) {
      throw new Error(`Docker container ${input.containerId} still references the before-cache image`);
    }
    await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-finish-hold-release",
      domainId: domain.domainId,
      holdId: input.holdId,
      entryId: input.entryId,
      containerId: input.containerId,
    });
  } catch (cause) {
    throw new BeforeCacheCleanupError({
      operation: "release durable before-cache hold",
      reason: errorMessage(cause),
      beforeCacheKey: input.beforeCacheKey,
      domainId: input.domainId,
      cause,
    });
  }
  await reclaimSupersededDockerImages();
}

async function restoreLeaseIntoTarget(
  target: DockerBeforeCacheTarget,
  lease: BeforeCacheLease,
  operation: BeforeCacheStep,
  signal: AbortSignal,
): Promise<{ readonly imageId: string; readonly sandboxId: string }> {
  signal.throwIfAborted();
  const row = lease.row;
  if (row.image_id === null || !exactImageId(row.image_id)) {
    throw new BeforeCacheValidationError({
      operation: "restore exact before-cache image",
      reason: "the indexed generation has no exact Docker image id",
      beforeCacheKey: row.before_cache_key,
      domainId: lease.domain.domainId,
    });
  }
  try {
    const inspection = await inspectExactImage(row.image_id, signal);
    validateImageLabels(inspection, row.image_id, labelsFor(lease.domain, row));
  } catch (cause) {
    try {
      await markEntryUnverified(row.entry_id);
    } catch (cleanupCause) {
      throw new BeforeCacheCleanupError({
        operation: "isolate invalid before-cache generation",
        reason: "exact-image validation failed and the generation could not be removed from the hit index",
        beforeCacheKey: row.before_cache_key,
        domainId: lease.domain.domainId,
        cause: new AggregateError([cause, cleanupCause]),
      });
    }
    throw new BeforeCacheValidationError({
      operation: "validate exact before-cache image",
      reason: errorMessage(cause),
      beforeCacheKey: row.before_cache_key,
      domainId: lease.domain.domainId,
      cause,
    });
  }

  const holdId = randomUUID();
  const plannedName = `niceeval-before-cache-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const hold: DockerBeforeCacheHoldRow = {
    holdId,
    entryId: row.entry_id,
    beforeCacheKey: row.before_cache_key,
    generation: row.generation,
    sandboxId: plannedName,
    sandboxResourceIdentity: plannedName,
    operationId: operation.operationId,
    state: "prepared",
    createdAt,
  };
  await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-prepare-hold",
    domainId: lease.domain.domainId,
    hold,
  });

  let rebound: { readonly containerId: string; readonly imageId: string } | undefined;
  try {
    rebound = await target.rebaseToExactImage(row.image_id, plannedName, signal);
    signal.throwIfAborted();
    if (rebound.imageId !== row.image_id) {
      throw new Error(`private clone uses ${rebound.imageId}, expected exact image ${row.image_id}`);
    }
    const activated = await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-activate-hold",
      domainId: lease.domain.domainId,
      holdId,
      entryId: row.entry_id,
      generation: row.generation,
      containerId: rebound.containerId,
    });
    if (activated.changes !== 1) throw new Error("prepared before-cache hold could not be activated");
    target.adoptBeforeCacheHold({
      containerId: rebound.containerId,
      release: () => releaseDurableHold({
        domainId: lease.domain.domainId,
        holdId,
        entryId: row.entry_id,
        containerId: rebound!.containerId,
        beforeCacheKey: row.before_cache_key,
      }),
    });
    const usedAt = new Date().toISOString();
    const updated = await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-mark-used",
      domainId: lease.domain.domainId,
      entryId: row.entry_id,
      generation: row.generation,
      usedAt,
    });
    if (updated.changes !== 1) throw new Error("before-cache generation changed before delivery completed");
    return { imageId: row.image_id, sandboxId: rebound.containerId.slice(0, 12) };
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    try {
      await target.destroyCurrentForCacheRecovery();
    } catch (cleanupCause) {
      cleanupFailures.push(cleanupCause);
    }
    try {
      await dockerCacheRepository.request({
        repository: "docker-cache",
        operation: "before-cache-remove-hold",
        domainId: lease.domain.domainId,
        holdId,
      });
    } catch (cleanupCause) {
      cleanupFailures.push(cleanupCause);
    }
    try {
      await markEntryUnverified(row.entry_id);
    } catch (cleanupCause) {
      cleanupFailures.push(cleanupCause);
    }
    if (cleanupFailures.length > 0) {
      throw new BeforeCacheCleanupError({
        operation: "clean partial before-cache restore",
        reason: "restore failed and its partial provider/registry resources could not be fully retired",
        beforeCacheKey: row.before_cache_key,
        domainId: lease.domain.domainId,
        cause: new AggregateError([cause, ...cleanupFailures]),
      });
    }
    throw new BeforeCacheRestoreError({
      operation: "restore exact before-cache image",
      reason: errorMessage(cause),
      beforeCacheKey: row.before_cache_key,
      domainId: lease.domain.domainId,
      cause,
    });
  }
}

async function lookupAndRestore(
  target: DockerBeforeCacheTarget,
  input: BeforeCacheStep,
  signal: AbortSignal,
): Promise<AttemptBeforeCacheLookup> {
  const eligibility = target.eligibility();
  if (eligibility._tag !== "Eligible") return eligibility;
  let manifest: ValidatedManifest;
  try {
    manifest = validateOperation(input);
    if (manifest.value.baseIdentity !== eligibility.baseIdentity) {
      throw new Error("before-cache lookup Base image does not match the initialized provider Base");
    }
    if (!sandboxActionStateCovers(eligibility.coverage, manifest.value.requiredState)) {
      throw new Error("before-cache lookup requires state outside the provider coverage");
    }
  } catch (cause) {
    throw new BeforeCacheValidationError({
      operation: "validate before-cache lookup",
      reason: errorMessage(cause),
      beforeCacheKey: input.declaration.beforeCacheKey,
      cause,
    });
  }
  let lease: BeforeCacheLease | undefined;
  try {
    lease = await acquireIndexedLease(input, manifest);
    if (lease === undefined) return { _tag: "Miss", beforeCacheKey: manifest.value.beforeCacheKey } as const;
    signal.throwIfAborted();
    const restored = await restoreLeaseIntoTarget(target, lease, input, signal);
    return {
      _tag: "Restored",
      beforeCacheKey: manifest.value.beforeCacheKey,
      entryId: lease.row.entry_id,
      generation: lease.row.generation,
      artifactId: restored.imageId,
      imageId: restored.imageId,
      sandboxId: restored.sandboxId,
    } as const;
  } catch (cause) {
    if (isBeforeCacheError(cause)) throw cause;
    throw new BeforeCacheLookupError({
      operation: `lookup and restore before cache:${safeFailureClass(cause)}`,
      reason: errorMessage(cause),
      beforeCacheKey: manifest.value.beforeCacheKey,
      cause,
    });
  } finally {
    await lease?.release();
  }
}

async function reserveEntry(
  input: BeforeCacheStep,
  manifest: ValidatedManifest,
  baseReference: string,
): Promise<
  | { readonly _tag: "Reserved"; readonly lease: BeforeCacheLease }
  | { readonly _tag: "Contended"; readonly beforeCacheKey: string; readonly reason: "active-writer" | "indexed-generation" }
> {
  const domain = await openBeforeCacheDomain();
  const holder = holderIdentity();
  const leaseId = randomUUID();
  const now = new Date();
  const reserved = await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-reserve",
    domainId: domain.domainId,
    manifest: repositoryManifest(manifest),
    replacementScope: replacementScope(input, domain.domainId, baseReference),
    operationId: input.operationId,
    leaseId,
    holder: repositoryHolder(holder),
    now: now.toISOString(),
    protectedUntil: new Date(now.getTime() + MINIMUM_AGE_MS).toISOString(),
    expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
  });
  if (reserved.state === "contended") {
    return {
      _tag: "Contended",
      beforeCacheKey: manifest.value.beforeCacheKey,
      reason: reserved.reason,
    };
  }
  return {
    _tag: "Reserved",
    lease: new BeforeCacheLease(domain, localEntry(reserved.entry), leaseId, "build"),
  };
}

async function publishEntry(row: BeforeCacheEntryRow, imageId: string, signal: AbortSignal): Promise<void> {
  const domain = await openBeforeCacheDomain();
  signal.throwIfAborted();
  await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-publish-reserve",
    domainId: domain.domainId,
    entryId: row.entry_id,
    operationId: row.operation_id,
    generation: row.generation,
    imageId,
  });
  signal.throwIfAborted();
  await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-publish-settle",
    domainId: domain.domainId,
    entryId: row.entry_id,
    beforeCacheKey: row.before_cache_key,
    imageId,
  });
}

async function failedCaptureImageCanBeRemoved(imageId: string, entryId: string): Promise<boolean> {
  const domain = await openBeforeCacheDomain();
  const claims = await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-image-claims",
    domainId: domain.domainId,
    imageId,
    exceptEntryId: entryId,
  });
  return !claims.gcLocked && !claims.taskBuildClaim && !claims.siblingBeforeCacheClaim;
}

/** Retire an artifact only after a replacement with the identical logical lineage is indexed. */
async function reclaimSupersededDockerImages(scope?: string, exceptEntryId?: string): Promise<void> {
  const domain = await openBeforeCacheDomain();
  const listed = await dockerCacheRepository.request({
    repository: "docker-cache",
    operation: "before-cache-list-reclaim-candidates",
    domainId: domain.domainId,
    ...(scope === undefined ? {} : { replacementScope: scope }),
    ...(exceptEntryId === undefined ? {} : { exceptEntryId }),
  });
  for (const repositoryRow of listed.entries) {
    const candidate = localEntry(repositoryRow);
    if (candidate.image_id === null) continue;
    const imageId = candidate.image_id;
    const planId = `before-cache-reclaim:${randomUUID()}`;
    const reserved = await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-reserve-delete",
      domainId: domain.domainId,
      entryId: candidate.entry_id,
      planId,
      holder: repositoryHolder(holderIdentity()),
      createdAt: new Date().toISOString(),
    });
    if (!reserved.reserved) continue;
    let state: "indexed" | "tombstoned" = "indexed";
    try {
      const signal = AbortSignal.timeout(PROVIDER_CLEANUP_TIMEOUT_MS);
      const inspection = await inspectExactImageOrAbsent(imageId, signal);
      if (inspection === undefined) {
        state = "tombstoned";
      } else if (!await hasContainerReference(imageId, signal)) {
        await new Docker().getImage(imageId).remove({ noprune: true, abortSignal: signal });
        if (await inspectExactImageOrAbsent(imageId, signal) === undefined) state = "tombstoned";
      }
    } catch {
      // A replacement is already live. Keep the old generation indexed if its
      // provider deletion cannot be proven; a later publish/hold release retries.
    }
    await dockerCacheRepository.request({
      repository: "docker-cache",
      operation: "before-cache-settle-delete",
      domainId: domain.domainId,
      entryId: candidate.entry_id,
      imageId,
      generation: candidate.generation,
      state,
    });
  }
}

async function capture(
  target: DockerBeforeCacheTarget,
  input: BeforeCacheStep,
  signal: AbortSignal,
): Promise<AttemptBeforeCacheCapture> {
  const eligibility = target.eligibility();
  if (eligibility._tag !== "Eligible") return eligibility;
  let manifest: ValidatedManifest;
  try {
    manifest = validateOperation(input);
    if (manifest.value.baseIdentity !== eligibility.baseIdentity) {
      throw new Error("before-cache capture Base image does not match the initialized provider Base");
    }
    if (!sandboxActionStateCovers(eligibility.coverage, manifest.value.requiredState)) {
      throw new Error("before-cache capture requires state outside the provider coverage");
    }
  } catch (cause) {
    throw new BeforeCacheValidationError({
      operation: "validate before-cache capture",
      reason: errorMessage(cause),
      beforeCacheKey: input.declaration.beforeCacheKey,
      cause,
    });
  }

  let reservation: BeforeCacheLease | undefined;
  let reservedRow: BeforeCacheEntryRow | undefined;
  let imageId: string | undefined;
  try {
    signal.throwIfAborted();
    const reserved = await reserveEntry(input, manifest, target.baseReference);
    if (reserved._tag === "Contended") return reserved;
    reservation = reserved.lease;
    reservedRow = reservation.row;
    const labels = labelsFor(reservation.domain, reservedRow);
    imageId = await target.captureExactImage(labels, input.knownSensitiveValues ?? [], signal);
    signal.throwIfAborted();
    const inspection = await inspectExactImage(imageId, signal);
    validateImageLabels(inspection, imageId, labels);
    await publishEntry(reservedRow, imageId, signal);
    await reclaimSupersededDockerImages(replacementScope(input, reservation.domain.domainId, target.baseReference), reservedRow.entry_id);
    signal.throwIfAborted();
    const lease = await acquireIndexedLease(input, manifest, reservedRow.entry_id);
    if (lease === undefined) throw new Error("captured before-cache generation was not indexed");
    try {
      // The handoff lease now closes the build-lease-to-hold protection window.
      await reservation.release();
      reservation = undefined;
      const restored = await restoreLeaseIntoTarget(target, lease, input, signal);
      return {
        _tag: "Captured",
        beforeCacheKey: manifest.value.beforeCacheKey,
        entryId: reservedRow.entry_id,
        generation: reservedRow.generation,
        artifactId: restored.imageId,
        imageId: restored.imageId,
        sandboxId: restored.sandboxId,
      } as const;
    } finally {
      await lease.release();
    }
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    if (reservation !== undefined) {
      try {
        await reservation.release();
        reservation = undefined;
      } catch (cleanupCause) {
        cleanupFailures.push(cleanupCause);
      }
    }
    if (reservedRow !== undefined) {
      try {
        await markEntryUnverified(reservedRow.entry_id);
      } catch (cleanupCause) {
        cleanupFailures.push(cleanupCause);
      }
    }
    if (imageId !== undefined && reservedRow !== undefined) {
      try {
        const cleanupSignal = AbortSignal.timeout(PROVIDER_CLEANUP_TIMEOUT_MS);
        if (
          !await hasContainerReference(imageId, cleanupSignal) &&
          await failedCaptureImageCanBeRemoved(imageId, reservedRow.entry_id)
        ) {
          await new Docker().getImage(imageId).remove({ abortSignal: cleanupSignal });
        }
      } catch (cleanupCause) {
        cleanupFailures.push(cleanupCause);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new BeforeCacheCleanupError({
        operation: "clean failed before-cache capture",
        reason: "capture failed and its unindexed image/registry claim could not be fully retired",
        beforeCacheKey: manifest.value.beforeCacheKey,
        cause: new AggregateError([cause, ...cleanupFailures]),
      });
    }
    if (isBeforeCacheError(cause)) throw cause;
    throw new BeforeCacheCaptureError({
      operation: "capture and publish before-cache image",
      reason: errorMessage(cause),
      beforeCacheKey: manifest.value.beforeCacheKey,
      cause,
    });
  }
}

export function makeDockerBeforeCacheCapability(
  target: DockerBeforeCacheTarget,
): AttemptBeforeCache {
  const scopedOperation = <A>(
    run: (signal: AbortSignal) => Promise<A>,
    mapError: (cause: unknown) => BeforeCacheError,
  ): Effect.Effect<A, BeforeCacheError> => Effect.acquireUseRelease(
    Effect.sync(() => {
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => run(controller.signal));
      return {
        controller,
        promise,
        settled: promise.then(() => undefined, () => undefined),
      };
    }),
    ({ controller, promise }) => Effect.tryPromise({
      try: (signal) => {
        const abort = (): void => controller.abort(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        return promise.finally(() => signal.removeEventListener("abort", abort));
      },
      catch: mapError,
    }),
    ({ controller, settled }) => Effect.sync(() => controller.abort(
      new DOMException("before cache operation scope closed", "AbortError"),
    )).pipe(Effect.andThen(Effect.promise(() => settled))),
  );

  return Object.freeze({
    eligibility: target.eligibility,
    lookupAndRestore: (input: BeforeCacheStep) => scopedOperation(
      (signal) => lookupAndRestore(target, input, signal),
      (cause) => isBeforeCacheError(cause)
        ? cause
        : new BeforeCacheLookupError({
            operation: "lookup and restore before cache",
            reason: errorMessage(cause),
            beforeCacheKey: input.declaration.beforeCacheKey,
            cause,
          }),
    ),
    capture: (input: BeforeCacheStep) => scopedOperation(
      (signal) => capture(target, input, signal),
      (cause) => isBeforeCacheError(cause)
        ? cause
        : new BeforeCacheCaptureError({
            operation: "capture and publish before cache",
            reason: errorMessage(cause),
            beforeCacheKey: input.declaration.beforeCacheKey,
            cause,
          }),
    ),
    fallBackToBase: () => scopedOperation(
      async (signal) => {
        const eligibility = target.eligibility();
        if (eligibility._tag !== "Eligible") return eligibility;
        const recovered = await target.fallBackToBase(signal);
        if (!exactImageId(recovered.baseIdentity)) throw new Error("clean Base recovery did not use an exact image id");
        return { _tag: "FellBackToBase", ...recovered } as const;
      },
      (cause) => isBeforeCacheError(cause)
        ? cause
        : new BeforeCacheRestoreError({
            operation: "recover a clean exact Base",
            reason: errorMessage(cause),
            cause,
          }),
    ),
  });
}
