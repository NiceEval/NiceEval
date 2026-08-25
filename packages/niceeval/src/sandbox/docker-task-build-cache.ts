import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import type {
  DockerCapacityObservation as ProviderCapacityObservation,
  DockerCacheDomainDescriptor as CacheDomainDescriptor,
} from "../docker/cache-administration.ts";

const execFileAsync = promisify(execFile);
export const DOCKER_CACHE_REGISTRY_SCHEMA_VERSION = 1;
const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TASK_BUILD_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PLAN_TTL_MS = 15 * 60 * 1000;
const PROVIDER_OPERATION_TIMEOUT_MS = 30 * 1000;

interface EntryRow {
  readonly build_key: string;
  readonly tag: string;
  readonly image_id: string;
  readonly created_at: string;
  readonly last_successful_use_at: string | null;
  readonly protected_until: string;
  readonly manifest_digest: string;
  readonly generation: number;
  readonly operation_id: string;
  readonly state: "indexed" | "deleting" | "tombstoned" | "unverified";
}

interface DockerImageGcLockRow {
  readonly image_id: string;
  readonly cache_kind: string;
  readonly plan_id: string;
  readonly entry_id: string;
  readonly entry_generation: number;
  readonly holder_pid: number;
  readonly holder_boot_id: string;
  readonly holder_process_start: string;
  readonly created_at: string;
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
  acquireUse(buildKey: string, tag: string, manifestDigest: string, dockerSocketPath?: string): Promise<{ release(): void }>;
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
  readonly db: DatabaseSync;
}

function domainIdFor(ownerId: string, daemonId: string, storageDriver: string, sentinelId: string): string {
  return createHash("sha256")
    .update(`docker-images\0${ownerId}\0${daemonId}\0${storageDriver}\0${sentinelId}`)
    .digest("hex").slice(0, 24);
}

function inventoryState(actual: string | undefined, expected: string, leases: number): TaskBuildInventoryEntry["state"] {
  return actual !== expected ? "unverified" : leases > 0 ? "active-leased" : "cold-reusable";
}

function passesGcAgePolicy(row: EntryRow, now: number): boolean {
  const lastUse = Date.parse(row.last_successful_use_at ?? row.created_at);
  return Date.parse(row.protected_until) <= now && now - lastUse >= MAX_TASK_BUILD_AGE_MS;
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestPlan(plan: Omit<TaskBuildGcPlan, "planDigest">): string {
  return canonicalDigest(plan);
}

function entryEvidence(row: EntryRow): Record<string, unknown> {
  return {
    buildKey: row.build_key,
    imageId: row.image_id,
    manifestDigest: row.manifest_digest,
    generation: row.generation,
    createdAt: row.created_at,
    lastSuccessfulUseAt: row.last_successful_use_at,
    protectedUntil: row.protected_until,
  };
}

function stateRoot(): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "niceeval", "cache", "v2", "domains");
}

function registryBusy(cause: unknown): boolean {
  return /database is locked|SQLITE_BUSY/iu.test(cause instanceof Error ? cause.message : String(cause));
}

async function openRegistryDatabase(path: string): Promise<DatabaseSync> {
  const deadline = Date.now() + PROVIDER_OPERATION_TIMEOUT_MS;
  for (;;) {
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout=100;");
      const journal = db.prepare("PRAGMA journal_mode").get() as { readonly journal_mode: string };
      // Reissuing journal_mode=WAL needs an exclusive lock even when the database
      // is already in WAL mode. If two first openers race, the loser closes its
      // connection before retrying so it cannot itself block the winner.
      if (journal.journal_mode.toLowerCase() !== "wal") db.exec("PRAGMA journal_mode=WAL;");
      db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
      return db;
    } catch (cause) {
      db.close();
      if (!registryBusy(cause) || Date.now() >= deadline) throw cause;
      await delay(10 + Math.floor(Math.random() * 40));
    }
  }
}

function assertTableColumns(db: DatabaseSync, table: string, required: readonly string[]): void {
  const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ readonly name: string }>)
    .map((column) => column.name));
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(`Docker cache registry schema v1 table ${table} is missing columns: ${missing.join(", ")}`);
  }
}

const DOCKER_IMAGE_GC_LOCK_COLUMNS = [
  "image_id", "cache_kind", "plan_id", "entry_id", "entry_generation",
  "holder_pid", "holder_boot_id", "holder_process_start", "created_at",
] as const;

function initializeRegistrySchema(db: DatabaseSync): { readonly authorityEpoch: string } {
  db.exec("BEGIN IMMEDIATE");
  try {
    const metadataExists = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'metadata'",
    ).get() !== undefined;
    const version = metadataExists
      ? db.prepare("SELECT value FROM metadata WHERE key = 'registrySchemaVersion'")
        .get() as { readonly value: string } | undefined
      : undefined;
    if (version !== undefined) {
      const parsed = Number(version.value);
      if (!Number.isSafeInteger(parsed) || parsed !== DOCKER_CACHE_REGISTRY_SCHEMA_VERSION) {
        throw new Error(
          `Docker cache registry schema ${JSON.stringify(version.value)} is unsupported; ` +
          `this NiceEval understands only v${DOCKER_CACHE_REGISTRY_SCHEMA_VERSION}`,
        );
      }
    }

    const gcLocksExist = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'docker_image_gc_locks'",
    ).get() !== undefined;
    if (gcLocksExist) {
      const existingColumns = new Set(
        (db.prepare("PRAGMA table_info(docker_image_gc_locks)").all() as Array<{ readonly name: string }>)
          .map((column) => column.name),
      );
      const legacyShape = DOCKER_IMAGE_GC_LOCK_COLUMNS.some((column) => !existingColumns.has(column));
      if (legacyShape && version === undefined) {
        const row = db.prepare("SELECT COUNT(*) AS count FROM docker_image_gc_locks")
          .get() as { readonly count: number };
        if (row.count !== 0) {
          throw new Error(
            "Docker cache registry has a non-empty legacy docker_image_gc_locks table; " +
            "refusing to discard unverifiable deletion ownership",
          );
        }
        // This is intentionally inside the same IMMEDIATE transaction as v1
        // publication. Only an empty, unversioned legacy lock table is replaced.
        db.exec("DROP TABLE docker_image_gc_locks");
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        build_key TEXT PRIMARY KEY,
        tag TEXT NOT NULL,
        image_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_successful_use_at TEXT,
        protected_until TEXT NOT NULL,
        manifest_digest TEXT NOT NULL,
        generation INTEGER NOT NULL,
        operation_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('indexed','deleting','tombstoned','unverified'))
      );
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        build_key TEXT NOT NULL REFERENCES entries(build_key),
        holder_pid INTEGER NOT NULL,
        holder_boot_id TEXT NOT NULL,
        holder_process_start TEXT NOT NULL,
        generation INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roots (
        root_id TEXT PRIMARY KEY,
        build_key TEXT NOT NULL REFERENCES entries(build_key),
        generation INTEGER NOT NULL,
        holder_boot_id TEXT NOT NULL,
        holder_pid INTEGER NOT NULL,
        holder_process_start TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('prepared','active')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gc_plans (
        plan_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        digest TEXT NOT NULL,
        outcome TEXT
      );
      CREATE TABLE IF NOT EXISTS docker_image_gc_locks (
        image_id TEXT PRIMARY KEY,
        cache_kind TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        entry_generation INTEGER NOT NULL,
        holder_pid INTEGER NOT NULL,
        holder_boot_id TEXT NOT NULL,
        holder_process_start TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    assertTableColumns(db, "entries", [
      "build_key", "tag", "image_id", "created_at", "last_successful_use_at", "protected_until",
      "manifest_digest", "generation", "operation_id", "state",
    ]);
    assertTableColumns(db, "docker_image_gc_locks", DOCKER_IMAGE_GC_LOCK_COLUMNS);
    db.prepare("INSERT OR IGNORE INTO metadata(key, value) VALUES ('registrySchemaVersion', ?)")
      .run(String(DOCKER_CACHE_REGISTRY_SCHEMA_VERSION));
    const stored = db.prepare("SELECT value FROM metadata WHERE key = 'registrySchemaVersion'")
      .get() as { readonly value: string };
    if (stored.value !== String(DOCKER_CACHE_REGISTRY_SCHEMA_VERSION)) {
      throw new Error(`Docker cache registry schema changed during initialization: ${stored.value}`);
    }
    const epochRow = db.prepare("SELECT value FROM metadata WHERE key = 'authorityEpoch'")
      .get() as { readonly value: string } | undefined;
    const authorityEpoch = epochRow?.value ?? randomUUID();
    db.prepare("INSERT OR IGNORE INTO metadata(key, value) VALUES ('authorityEpoch', ?)").run(authorityEpoch);
    db.prepare("INSERT OR IGNORE INTO metadata(key, value) VALUES ('safetyRevision', '1')").run();
    db.exec("COMMIT");
    return { authorityEpoch };
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
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
    .map((value) => value.toString())
    .join("\n");
  return /no such (?:image|object)|image .* not found/iu.test(detail);
}

function decimalBytes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?b)$/iu.exec(value.trim());
  if (match === null) return null;
  const power = ["b", "kb", "mb", "gb", "tb", "pb"].indexOf(match[2]!.toLowerCase());
  return power < 0 ? null : Math.round(Number(match[1]) * 1000 ** power);
}

export async function observeDockerBuildKitCapacity(): Promise<ProviderCapacityObservation> {
  const output = await docker(["system", "df", "--format", "json"]);
  const rows = output.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const build = rows.find((row) => row.Type === "Build Cache");
  const reclaimable = typeof build?.Reclaimable === "string" ? build.Reclaimable.trim().split(/\s+/u)[0] : undefined;
  return Object.freeze({
    scope: "provider",
    providerFamily: "docker",
    backendKind: "buildkit",
    state: "unverified",
    observedAt: new Date().toISOString(),
    totalBytes: decimalBytes(build?.Size),
    reclaimableEstimateBytes: decimalBytes(reclaimable),
    reason: "shared-builder-unattributed",
  });
}

async function openDomain(dockerSocketPath?: string): Promise<DockerCacheDomainHandle> {
  if (dockerSocketPath !== undefined) throw new Error("managed Docker cache requires the default local Unix socket");
  const root = stateRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const ownerPath = join(root, "owner-id");
  let ownerId: string;
  try {
    ownerId = readFileSync(ownerPath, "utf8").trim();
  } catch {
    ownerId = randomUUID();
    const temporary = `${ownerPath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${ownerId}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      // Hard-link publication is no-replace: concurrent cache kinds can open the
      // shared authority without the later opener overwriting the winner.
      linkSync(temporary, ownerPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      ownerId = readFileSync(ownerPath, "utf8").trim();
    } finally {
      try {
        unlinkSync(temporary);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
  }
  const sentinelName = `niceeval-cache-${createHash("sha256").update(ownerId).digest("hex").slice(0, 16)}`;
  const sentinelLabel = "io.niceeval.cache-domain";
  let sentinelId: string | undefined;
  try {
    sentinelId = await docker(["volume", "inspect", "--format", `{{index .Labels \"${sentinelLabel}\"}}`, sentinelName]);
  } catch {
    sentinelId = randomUUID();
    await docker(["volume", "create", "--label", `${sentinelLabel}=${sentinelId}`, sentinelName]);
    sentinelId = await docker(["volume", "inspect", "--format", `{{index .Labels \"${sentinelLabel}\"}}`, sentinelName]);
  }
  if (sentinelId.length === 0 || sentinelId === "<no value>") throw new Error(`Docker cache sentinel ${sentinelName} has no managed identity`);
  const daemonId = await docker(["info", "--format", "{{.ID}}"], dockerSocketPath);
  const storageDriver = await docker(["info", "--format", "{{.Driver}}"], dockerSocketPath);
  const domainId = domainIdFor(ownerId, daemonId, storageDriver, sentinelId);
  const backendIdentity = createHash("sha256").update(`${daemonId}\0${storageDriver}\0${sentinelId}`).digest("hex");
  const directory = join(stateRoot(), domainId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Separate NiceEval invocations share this registry. WAL allows concurrent
  // readers; first-open mode negotiation uses close-before-retry above.
  const db = await openRegistryDatabase(join(directory, "registry.sqlite"));
  let authorityEpoch: string;
  try {
    ({ authorityEpoch } = initializeRegistrySchema(db));
  } catch (cause) {
    db.close();
    throw cause;
  }
  const catalog = await openRegistryDatabase(join(root, "catalog.sqlite"));
  catalog.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      domain_id TEXT PRIMARY KEY,
      provider_family TEXT NOT NULL,
      admin_protocol_version INTEGER NOT NULL,
      backend_kind TEXT NOT NULL,
      first_verified_at TEXT NOT NULL,
      last_verified_at TEXT NOT NULL,
      last_state TEXT NOT NULL
    );
  `);
  const verifiedAt = new Date().toISOString();
  catalog.prepare(`
    INSERT INTO domains(domain_id, provider_family, admin_protocol_version, backend_kind, first_verified_at, last_verified_at, last_state)
    VALUES (?, 'docker', 1, 'docker-images', ?, ?, 'verified-managed')
    ON CONFLICT(domain_id) DO UPDATE SET last_verified_at=excluded.last_verified_at, last_state='verified-managed'
  `).run(domainId, verifiedAt, verifiedAt);
  catalog.close();
  const handle = { domainId, ownerId, authorityEpoch, backendIdentity, db };
  try {
    await reconcileCrashedTaskBuildDeletes(handle, dockerSocketPath);
    return handle;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

/** Shared Docker image-cache authority. Cache kinds must create their own namespaced tables in this database. */
export function openDockerCacheDomain(dockerSocketPath?: string): Promise<DockerCacheDomainHandle> {
  return openDomain(dockerSocketPath);
}

export async function listDockerCacheDomains(): Promise<readonly CacheDomainDescriptor[]> {
  const current = await openDomain();
  current.db.close();
  const catalog = new DatabaseSync(join(stateRoot(), "catalog.sqlite"), { readOnly: true });
  const rows = catalog.prepare("SELECT domain_id, provider_family, admin_protocol_version, backend_kind FROM domains ORDER BY first_verified_at, domain_id").all() as Array<{
    domain_id: string; provider_family: string; admin_protocol_version: number; backend_kind: string;
  }>;
  catalog.close();
  return rows.map((row) => ({
    providerFamily: "docker",
    adminProtocolVersion: row.admin_protocol_version,
    domainId: row.domain_id,
    backendKind: row.backend_kind,
    state: row.domain_id === current.domainId ? "verified-managed" : "unavailable",
  }));
}

export async function dockerTaskBuildAuthorityFingerprint(): Promise<string> {
  const domain = await openDomain();
  domain.db.close();
  return domain.domainId;
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

function setupPrefixClaimsImage(db: DatabaseSync, imageId: string): boolean {
  const table = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'setup_prefix_entries'")
    .get();
  if (table === undefined) return false;
  return db.prepare(`
    SELECT 1 AS present FROM setup_prefix_entries
    WHERE image_id = ? AND state != 'tombstoned' LIMIT 1
  `).get(imageId) !== undefined;
}

function holderIdentity(pid = process.pid): { bootId: string; processStart: string } {
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8").trim();
  const processStart = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u)[19];
  if (bootId.length === 0 || processStart === undefined) throw new Error("cannot verify local process identity");
  return { bootId, processStart };
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
  return lock.entry_id.startsWith(prefix) ? lock.entry_id.slice(prefix.length) : undefined;
}

function taskBuildDeleteLockMatchesPlan(
  domain: DockerCacheDomainHandle,
  lock: DockerImageGcLockRow,
  row: EntryRow,
): boolean {
  const saved = domain.db.prepare("SELECT payload, digest, outcome FROM gc_plans WHERE plan_id = ?")
    .get(lock.plan_id) as { readonly payload: string; readonly digest: string; readonly outcome: string | null } | undefined;
  if (saved === undefined || saved.outcome !== null) return false;
  try {
    const plan = JSON.parse(saved.payload) as TaskBuildGcPlan;
    const { planDigest, ...unsigned } = plan;
    if (
      saved.digest !== planDigest ||
      digestPlan(unsigned) !== planDigest ||
      plan.domainId !== domain.domainId ||
      plan.ownerId !== domain.ownerId ||
      plan.backendIdentity !== domain.backendIdentity ||
      plan.authorityEpoch !== domain.authorityEpoch ||
      plan.policyVersion !== 1
    ) return false;
    const candidate = plan.candidates.find((item) =>
      item.buildKey === row.build_key &&
      item.imageId === lock.image_id &&
      item.generation === lock.entry_generation
    );
    return candidate !== undefined &&
      candidate.tag === row.tag &&
      candidate.manifestDigest === row.manifest_digest &&
      candidate.evidenceDigest === canonicalDigest(entryEvidence(row));
  } catch {
    return false;
  }
}

function settleCrashedTaskBuildDelete(
  db: DatabaseSync,
  lock: DockerImageGcLockRow,
  row: EntryRow,
  nextState: "tombstoned" | "unverified",
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const updated = db.prepare(`
      UPDATE entries SET state = ?
      WHERE build_key = ? AND generation = ? AND image_id = ? AND state = 'deleting'
    `).run(nextState, row.build_key, row.generation, lock.image_id);
    if (updated.changes !== 1) throw new Error("task-build deleting generation changed during reconciliation");
    db.prepare(`
      DELETE FROM docker_image_gc_locks
      WHERE image_id = ? AND cache_kind = 'task-build' AND plan_id = ?
        AND entry_id = ? AND entry_generation = ?
    `).run(lock.image_id, lock.plan_id, lock.entry_id, lock.entry_generation);
    db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'safetyRevision'").run();
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

function isolateUnverifiedTaskBuildDelete(
  db: DatabaseSync,
  lock: DockerImageGcLockRow,
): void {
  const buildKey = taskBuildKeyFromLock(lock);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE entries SET state = 'unverified'
      WHERE state = 'deleting' AND image_id = ?
        AND (? IS NULL OR build_key = ?)
    `).run(lock.image_id, buildKey ?? null, buildKey ?? null);
    db.prepare(`
      DELETE FROM docker_image_gc_locks
      WHERE image_id = ? AND cache_kind = 'task-build' AND plan_id = ?
        AND entry_id = ? AND entry_generation = ?
    `).run(lock.image_id, lock.plan_id, lock.entry_id, lock.entry_generation);
    db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'safetyRevision'").run();
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

async function reconcileCrashedTaskBuildDeletes(
  domain: DockerCacheDomainHandle,
  dockerSocketPath?: string,
): Promise<void> {
  const locks = domain.db.prepare(`
    SELECT * FROM docker_image_gc_locks
    WHERE cache_kind = 'task-build'
    ORDER BY created_at, image_id
    LIMIT 128
  `).all() as unknown as DockerImageGcLockRow[];
  for (const lock of locks) {
    if (processIdentityIsLive(lock.holder_pid, lock.holder_boot_id, lock.holder_process_start)) continue;
    const buildKey = taskBuildKeyFromLock(lock);
    const row = buildKey === undefined
      ? undefined
      : domain.db.prepare(`
          SELECT * FROM entries
          WHERE build_key = ? AND generation = ? AND image_id = ? AND state = 'deleting'
        `).get(buildKey, lock.entry_generation, lock.image_id) as EntryRow | undefined;
    if (row === undefined || !taskBuildDeleteLockMatchesPlan(domain, lock, row)) {
      isolateUnverifiedTaskBuildDelete(domain.db, lock);
      continue;
    }

    try {
      const exact = await imageId(lock.image_id, dockerSocketPath);
      if (exact === undefined) {
        settleCrashedTaskBuildDelete(domain.db, lock, row, "tombstoned");
        continue;
      }
      const locator = await imageId(row.tag, dockerSocketPath);
      const protectedByReference = liveLeaseCount(domain.db, row.build_key) > 0 ||
        liveRootCount(domain.db, row.build_key) > 0 ||
        setupPrefixClaimsImage(domain.db, lock.image_id) ||
        await hasContainerReference(lock.image_id, dockerSocketPath);
      if (exact !== lock.image_id || locator !== lock.image_id || protectedByReference) {
        isolateUnverifiedTaskBuildDelete(domain.db, lock);
        continue;
      }
      try {
        await docker(["image", "rm", lock.image_id], dockerSocketPath);
      } catch (cause) {
        if (!dockerConfirmedImageAbsent(cause)) throw cause;
      }
      if (await imageId(lock.image_id, dockerSocketPath) === undefined) {
        settleCrashedTaskBuildDelete(domain.db, lock, row, "tombstoned");
      } else {
        isolateUnverifiedTaskBuildDelete(domain.db, lock);
      }
    } catch {
      // Provider ambiguity is never deletion authority. Retain the exact image
      // as an unverified claim and release only the stale process lock.
      isolateUnverifiedTaskBuildDelete(domain.db, lock);
    }
  }
}

class LiveTaskBuildCacheSession implements TaskBuildCacheService {
  async lookup(buildKey: string, tag: string, manifestDigest: string, dockerSocketPath?: string): Promise<boolean> {
    const domain = await openDomain(dockerSocketPath);
    const row = domain.db.prepare("SELECT * FROM entries WHERE build_key = ? AND state = 'indexed'").get(buildKey) as EntryRow | undefined;
    if (row === undefined || row.tag !== tag || row.manifest_digest !== manifestDigest) {
      domain.db.close();
      return false;
    }
    const actual = await imageId(tag, dockerSocketPath);
    if (actual === undefined || actual !== row.image_id) {
      domain.db.prepare("UPDATE entries SET state = 'unverified' WHERE build_key = ?").run(buildKey);
      domain.db.close();
      return false;
    }
    domain.db.close();
    return true;
  }

  async publish(buildKey: string, tag: string, manifestDigest: string, operationId: string, dockerSocketPath?: string): Promise<void> {
    const actual = await imageId(tag, dockerSocketPath);
    if (actual === undefined) throw new Error(`built image ${tag} is absent after build`);
    const domain = await openDomain(dockerSocketPath);
    const now = new Date();
    domain.db.exec("BEGIN IMMEDIATE");
    try {
      const gcLock = domain.db.prepare("SELECT cache_kind, plan_id FROM docker_image_gc_locks WHERE image_id = ?")
        .get(actual) as { readonly cache_kind: string; readonly plan_id: string } | undefined;
      if (gcLock !== undefined) {
        throw new Error(`built image is fenced by ${gcLock.cache_kind} GC plan ${gcLock.plan_id}`);
      }
      domain.db.prepare(`
        INSERT INTO entries(build_key, tag, image_id, created_at, last_successful_use_at, protected_until, manifest_digest, generation, operation_id, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'indexed')
        ON CONFLICT(build_key) DO UPDATE SET
          tag=excluded.tag, image_id=excluded.image_id, created_at=excluded.created_at,
          last_successful_use_at=excluded.last_successful_use_at,
          protected_until=excluded.protected_until, manifest_digest=excluded.manifest_digest,
          generation=CASE WHEN entries.operation_id = excluded.operation_id THEN entries.generation ELSE entries.generation + 1 END,
          operation_id=excluded.operation_id, state='indexed'
      `).run(buildKey, tag, actual, now.toISOString(), now.toISOString(), new Date(now.getTime() + MINIMUM_AGE_MS).toISOString(), manifestDigest, operationId);
      domain.db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'safetyRevision'").run();
      domain.db.exec("COMMIT");
    } catch (cause) {
      domain.db.exec("ROLLBACK");
      throw cause;
    } finally {
      domain.db.close();
    }
  }

  async acquireUse(buildKey: string, tag: string, manifestDigest: string, dockerSocketPath?: string): Promise<{ release(): void }> {
    const domain = await openDomain(dockerSocketPath);
    const row = domain.db.prepare("SELECT * FROM entries WHERE build_key = ? AND state = 'indexed'").get(buildKey) as EntryRow | undefined;
    if (row === undefined || row.tag !== tag || row.manifest_digest !== manifestDigest || await imageId(tag, dockerSocketPath) !== row.image_id) {
      domain.db.close();
      throw new Error(`Docker task-build artifact ${buildKey.slice(0, 12)} is no longer available`);
    }
    const leaseId = randomUUID();
    const rootId = randomUUID();
    const now = new Date().toISOString();
    const holder = holderIdentity();
    domain.db.exec("BEGIN IMMEDIATE");
    try {
      domain.db.prepare("INSERT INTO leases(lease_id, build_key, holder_pid, holder_boot_id, holder_process_start, generation, created_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(leaseId, buildKey, process.pid, holder.bootId, holder.processStart, row.generation, now, now);
      domain.db.prepare("INSERT INTO roots(root_id, build_key, generation, holder_boot_id, holder_pid, holder_process_start, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?)")
        .run(rootId, buildKey, row.generation, holder.bootId, process.pid, holder.processStart, now);
      domain.db.prepare("UPDATE roots SET state = 'active' WHERE root_id = ? AND state = 'prepared'").run(rootId);
      domain.db.prepare("UPDATE entries SET last_successful_use_at = ? WHERE build_key = ?").run(now, buildKey);
      domain.db.exec("COMMIT");
    } catch (cause) {
      domain.db.exec("ROLLBACK");
      domain.db.close();
      throw cause;
    }
    let released = false;
    const heartbeat = setInterval(() => {
      if (released) return;
      try {
        domain.db.prepare("UPDATE leases SET heartbeat_at = ? WHERE lease_id = ?").run(new Date().toISOString(), leaseId);
      } catch {
        // The holder identity and durable root remain authoritative; reconciliation will classify an unreadable registry as unverified.
      }
    }, 30_000);
    heartbeat.unref();
    return { release() {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      domain.db.exec("BEGIN IMMEDIATE");
      try {
        domain.db.prepare("DELETE FROM roots WHERE root_id = ?").run(rootId);
        domain.db.prepare("DELETE FROM leases WHERE lease_id = ?").run(leaseId);
        domain.db.exec("COMMIT");
      } catch (cause) {
        domain.db.exec("ROLLBACK");
        throw cause;
      }
      domain.db.close();
    } };
  }
}

export function makeTaskBuildCacheService(): TaskBuildCacheService {
  return new LiveTaskBuildCacheSession();
}

function liveLeaseCount(db: DatabaseSync, buildKey: string): number {
  const rows = db.prepare("SELECT lease_id, holder_pid, holder_boot_id, holder_process_start FROM leases WHERE build_key = ?").all(buildKey) as Array<{
    lease_id: string; holder_pid: number; holder_boot_id: string; holder_process_start: string;
  }>;
  let live = 0;
  for (const row of rows) {
    if (processIdentityIsLive(row.holder_pid, row.holder_boot_id, row.holder_process_start)) {
      live += 1;
    } else {
      db.prepare("DELETE FROM leases WHERE lease_id = ?").run(row.lease_id);
    }
  }
  return live;
}

function liveRootCount(db: DatabaseSync, buildKey: string): number {
  const rows = db.prepare("SELECT root_id, holder_pid, holder_boot_id, holder_process_start FROM roots WHERE build_key = ?").all(buildKey) as Array<{
    root_id: string; holder_pid: number; holder_boot_id: string; holder_process_start: string;
  }>;
  let live = 0;
  for (const row of rows) {
    if (processIdentityIsLive(row.holder_pid, row.holder_boot_id, row.holder_process_start)) live += 1;
    else db.prepare("DELETE FROM roots WHERE root_id = ?").run(row.root_id);
  }
  return live;
}

export async function inventoryTaskBuildDomain(dockerSocketPath?: string): Promise<TaskBuildDomainInventory> {
  const domain = await openDomain(dockerSocketPath);
  const rows = domain.db.prepare(`
    SELECT * FROM entries WHERE state != 'tombstoned'
    ORDER BY COALESCE(last_successful_use_at, created_at), created_at, build_key
  `).all() as unknown as EntryRow[];
  const entries: TaskBuildInventoryEntry[] = [];
  for (const row of rows) {
    const actual = await imageId(row.tag, dockerSocketPath);
    const leases = liveLeaseCount(domain.db, row.build_key) + liveRootCount(domain.db, row.build_key);
    entries.push({
      buildKey: row.build_key,
      tag: row.tag,
      imageId: row.image_id,
      createdAt: row.created_at,
      lastSuccessfulUseAt: row.last_successful_use_at,
      protectedUntil: row.protected_until,
      state: inventoryState(actual, row.image_id, leases),
    });
  }
  domain.db.close();
  return { domainId: domain.domainId, providerFamily: "docker", backendKind: "docker-images", state: "verified-managed", entries };
}

export async function planTaskBuildGc(domainId: string): Promise<TaskBuildGcPlan> {
  const domain = await openDomain();
  if (domain.domainId !== domainId) {
    domain.db.close();
    throw new Error(`unknown Docker image cache domain ${domainId}`);
  }
  const now = new Date();
  const candidates: TaskBuildGcPlan["candidates"][number][] = [];
  const rows = domain.db.prepare("SELECT * FROM entries WHERE state = 'indexed' ORDER BY COALESCE(last_successful_use_at, created_at), created_at, build_key").all() as unknown as EntryRow[];
  for (const row of rows) {
    if (!passesGcAgePolicy(row, now.getTime())) continue;
    if (liveLeaseCount(domain.db, row.build_key) > 0) continue;
    if (liveRootCount(domain.db, row.build_key) > 0) continue;
    if (setupPrefixClaimsImage(domain.db, row.image_id)) continue;
    if (await imageId(row.tag) !== row.image_id) continue;
    if (await hasContainerReference(row.image_id)) continue;
    const evidence = entryEvidence(row);
    candidates.push({
      buildKey: row.build_key,
      tag: row.tag,
      imageId: row.image_id,
      manifestDigest: row.manifest_digest,
      generation: row.generation,
      evidenceDigest: canonicalDigest(evidence),
      ruleId: "max-age/task-build",
    });
  }
  const revision = Number((domain.db.prepare("SELECT value FROM metadata WHERE key = 'safetyRevision'").get() as { value: string }).value);
  const unsigned: Omit<TaskBuildGcPlan, "planDigest"> = {
    schemaVersion: 1,
    planId: randomUUID(),
    domainId,
    ownerId: domain.ownerId,
    backendIdentity: domain.backendIdentity,
    authorityEpoch: domain.authorityEpoch,
    policyVersion: 1,
    registrySafetyRevision: revision,
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    candidates,
  };
  const plan: TaskBuildGcPlan = { ...unsigned, planDigest: digestPlan(unsigned) };
  domain.db.prepare("INSERT INTO gc_plans(plan_id, created_at, expires_at, payload, digest) VALUES (?, ?, ?, ?, ?)")
    .run(plan.planId, plan.observedAt, plan.expiresAt, JSON.stringify(plan), plan.planDigest);
  domain.db.close();
  return plan;
}

export interface TaskBuildGcOutcome {
  readonly planId: string;
  readonly domainId: string;
  readonly outcomes: ReadonlyArray<{ readonly buildKey: string; readonly status: "deleted" | "already-absent" | "skipped" | "failed"; readonly reason: string }>;
}

function settleTaskBuildGcCandidate(
  db: DatabaseSync,
  candidate: TaskBuildGcPlan["candidates"][number],
  state: "indexed" | "tombstoned" | "unverified",
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE entries SET state = ? WHERE build_key = ? AND generation = ? AND state = 'deleting'")
      .run(state, candidate.buildKey, candidate.generation);
    db.prepare("DELETE FROM docker_image_gc_locks WHERE image_id = ? AND cache_kind = 'task-build'")
      .run(candidate.imageId);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

export async function applyTaskBuildGc(domainId: string, planId: string): Promise<TaskBuildGcOutcome> {
  const domain = await openDomain();
  if (domain.domainId !== domainId) {
    domain.db.close();
    throw new Error(`unknown Docker image cache domain ${domainId}`);
  }
  const saved = domain.db.prepare("SELECT expires_at, payload, digest, outcome FROM gc_plans WHERE plan_id = ?").get(planId) as
    | { expires_at: string; payload: string; digest: string; outcome: string | null }
    | undefined;
  if (saved === undefined) {
    domain.db.close();
    throw new Error(`unknown GC plan ${planId}`);
  }
  if (saved.outcome !== null) {
    const outcome = JSON.parse(saved.outcome);
    domain.db.close();
    return outcome;
  }
  if (Date.parse(saved.expires_at) < Date.now()) {
    domain.db.close();
    throw new Error(`GC plan ${planId} expired`);
  }
  const plan = JSON.parse(saved.payload) as TaskBuildGcPlan;
  const { planDigest: persistedPlanDigest, ...unsigned } = plan;
  if (saved.digest !== persistedPlanDigest || digestPlan(unsigned) !== persistedPlanDigest) {
    domain.db.close();
    throw new Error(`GC plan ${planId} is corrupt`);
  }
  if (
    plan.domainId !== domain.domainId ||
    plan.ownerId !== domain.ownerId ||
    plan.backendIdentity !== domain.backendIdentity ||
    plan.authorityEpoch !== domain.authorityEpoch ||
    plan.policyVersion !== 1
  ) {
    domain.db.close();
    throw new Error(`GC plan ${planId} authority changed`);
  }
  const outcomes: Array<{ buildKey: string; status: "deleted" | "already-absent" | "skipped" | "failed"; reason: string }> = [];
  const deleteHolder = holderIdentity();
  for (const candidate of plan.candidates) {
    domain.db.exec("BEGIN IMMEDIATE");
    let row: EntryRow | undefined;
    try {
      row = domain.db.prepare("SELECT * FROM entries WHERE build_key = ?").get(candidate.buildKey) as EntryRow | undefined;
      if (row === undefined || row.state !== "indexed" || row.image_id !== candidate.imageId ||
        row.manifest_digest !== candidate.manifestDigest || row.generation !== candidate.generation ||
        canonicalDigest(entryEvidence(row)) !== candidate.evidenceDigest ||
        liveLeaseCount(domain.db, candidate.buildKey) > 0 || liveRootCount(domain.db, candidate.buildKey) > 0 ||
        setupPrefixClaimsImage(domain.db, candidate.imageId)) {
        domain.db.exec("ROLLBACK");
        outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: "entry-lease-root-or-generation-changed" });
        continue;
      }
      const existingLock = domain.db.prepare("SELECT * FROM docker_image_gc_locks WHERE image_id = ?")
        .get(candidate.imageId) as unknown as DockerImageGcLockRow | undefined;
      if (existingLock !== undefined) {
        domain.db.exec("ROLLBACK");
        outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: "active-delete-conflict" });
        continue;
      }
      domain.db.prepare(`
        INSERT INTO docker_image_gc_locks(
          image_id, cache_kind, plan_id, entry_id, entry_generation,
          holder_pid, holder_boot_id, holder_process_start, created_at
        ) VALUES (?, 'task-build', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candidate.imageId,
        planId,
        `task-build:${candidate.buildKey}`,
        candidate.generation,
        process.pid,
        deleteHolder.bootId,
        deleteHolder.processStart,
        new Date().toISOString(),
      );
      const marked = domain.db.prepare(`
        UPDATE entries SET state = 'deleting'
        WHERE build_key = ? AND generation = ? AND state = 'indexed'
      `).run(candidate.buildKey, candidate.generation);
      if (marked.changes !== 1) throw new Error("task-build generation changed before deleting transition");
      domain.db.exec("COMMIT");
    } catch (cause) {
      domain.db.exec("ROLLBACK");
      outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
      continue;
    }
    let actual: string | undefined;
    try {
      actual = await imageId(row.tag);
    } catch (cause) {
      settleTaskBuildGcCandidate(domain.db, candidate, "unverified");
      outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
      continue;
    }
    if (actual === undefined) {
      let exact: string | undefined;
      try {
        exact = await imageId(candidate.imageId);
      } catch (cause) {
        settleTaskBuildGcCandidate(domain.db, candidate, "unverified");
        outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
        continue;
      }
      if (exact === undefined) {
        settleTaskBuildGcCandidate(domain.db, candidate, "tombstoned");
        outcomes.push({ buildKey: candidate.buildKey, status: "already-absent", reason: "provider-confirmed-absent" });
      } else {
        settleTaskBuildGcCandidate(domain.db, candidate, "unverified");
        outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: "locator-no-longer-verifies-exact-image" });
      }
      continue;
    }
    if (
      actual !== candidate.imageId ||
      setupPrefixClaimsImage(domain.db, candidate.imageId) ||
      await hasContainerReference(candidate.imageId)
    ) {
      settleTaskBuildGcCandidate(domain.db, candidate, "unverified");
      outcomes.push({ buildKey: candidate.buildKey, status: "skipped", reason: "resource-or-reference-changed" });
      continue;
    }
    try {
      await docker(["image", "rm", candidate.imageId]);
      if (await imageId(candidate.imageId) !== undefined || await hasContainerReference(candidate.imageId)) {
        settleTaskBuildGcCandidate(domain.db, candidate, "unverified");
        outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: "image-still-present" });
        continue;
      }
      settleTaskBuildGcCandidate(domain.db, candidate, "tombstoned");
      outcomes.push({ buildKey: candidate.buildKey, status: "deleted", reason: "max-age/task-build" });
    } catch (cause) {
      settleTaskBuildGcCandidate(domain.db, candidate, "unverified");
      outcomes.push({ buildKey: candidate.buildKey, status: "failed", reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  const result = { planId, domainId, outcomes } as const;
  domain.db.prepare("UPDATE gc_plans SET outcome = ? WHERE plan_id = ?").run(JSON.stringify(result), planId);
  domain.db.close();
  return result;
}

export const liveTaskBuildCacheAdminService: TaskBuildCacheAdminService = Object.freeze({
  inventory: inventoryTaskBuildDomain,
  planGc: planTaskBuildGc,
  applyGc: applyTaskBuildGc,
});
