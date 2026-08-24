import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import Docker from "dockerode";
import { Effect } from "effect";
import {
  SandboxSetupPrefixCacheCaptureError,
  SandboxSetupPrefixCacheCleanupError,
  SandboxSetupPrefixCacheLookupError,
  SandboxSetupPrefixCacheRegistryError,
  SandboxSetupPrefixCacheRestoreError,
  SandboxSetupPrefixCacheValidationError,
  type SandboxSetupPrefixCacheCapability,
  type SandboxSetupPrefixCacheCaptureResult,
  type SandboxSetupPrefixCacheEligibility,
  type SandboxSetupPrefixCacheError,
  type SandboxSetupPrefixCacheLookupResult,
  type SandboxSetupPrefixCacheManifest,
  type SandboxSetupPrefixCacheOperation,
} from "./backend.ts";
import {
  openDockerCacheDomain,
  type DockerCacheDomainHandle,
} from "./docker-task-build-cache.ts";

const CACHE_KIND = "sandbox-setup-prefix";
const CACHE_PROTOCOL_VERSION = 1;
const SETUP_PREFIX_REGISTRY_SCHEMA_VERSION = 2;
const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const LEASE_HEARTBEAT_MS = 10 * 1000;
const LEASE_TTL_MS = 60 * 1000;
const LEASE_RECONCILE_GRACE_MS = 30 * 1000;
const PROVIDER_CLEANUP_TIMEOUT_MS = 30 * 1000;

const LABEL = Object.freeze({
  kind: "io.niceeval.cache.kind",
  protocol: "io.niceeval.cache.protocol",
  domainId: "io.niceeval.cache.domain-id",
  entryId: "io.niceeval.cache.setup-prefix.entry-id",
  operationId: "io.niceeval.cache.setup-prefix.operation-id",
  generation: "io.niceeval.cache.setup-prefix.generation",
  setupPrefixKey: "io.niceeval.cache.setup-prefix.key",
  baseImageId: "io.niceeval.cache.setup-prefix.base-image-id",
  setupManifestDigest: "io.niceeval.cache.setup-prefix.manifest-digest",
  declarationDigest: "io.niceeval.cache.setup-prefix.declaration-digest",
  storageSchemaRevision: "io.niceeval.cache.setup-prefix.storage-schema",
  artifactFormatRevision: "io.niceeval.cache.setup-prefix.artifact-format",
  dependency: "io.niceeval.cache.setup-prefix.dependency",
});

type SetupPrefixEntryState =
  | "reserved"
  | "building"
  | "published"
  | "indexed"
  | "invalidated"
  | "deleting"
  | "tombstoned"
  | "unverified";

interface SetupPrefixEntryRow {
  readonly entry_id: string;
  readonly setup_prefix_key: string;
  readonly base_image_id: string;
  readonly image_id: string | null;
  readonly declaration_json: string;
  readonly declaration_digest: string;
  readonly setup_manifest_digest: string;
  readonly storage_schema_revision: string;
  readonly artifact_format_revision: string;
  readonly dependency: "parent-backed";
  readonly change_frequency: number;
  readonly generation: number;
  readonly operation_id: string;
  readonly created_at: string;
  readonly last_successful_use_at: string | null;
  readonly protected_until: string;
  readonly state: SetupPrefixEntryState;
}

interface ValidatedManifest {
  readonly value: SandboxSetupPrefixCacheManifest;
  readonly declarationJson: string;
  readonly declarationDigest: string;
}

interface HolderIdentity {
  readonly hostId: string;
  readonly bootId: string;
  readonly pid: number;
  readonly processStart: string;
}

export interface DockerSetupPrefixRootOwnership {
  readonly containerId: string;
  readonly release: () => Promise<void>;
}

/** Narrow Docker target. Registry code never reaches into DockerSandbox implementation fields. */
export interface DockerSetupPrefixCacheTarget {
  readonly eligibility: () => SandboxSetupPrefixCacheEligibility;
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
  readonly adoptSetupPrefixRoot: (root: DockerSetupPrefixRootOwnership) => void;
  /** Exact pristine Base recovery on the same stable backend object. */
  readonly recoverCleanBase: (
    signal: AbortSignal,
  ) => Promise<{ readonly baseImageId: string; readonly sandboxId: string }>;
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

function isSetupPrefixError(cause: unknown): cause is SandboxSetupPrefixCacheError {
  if (typeof cause !== "object" || cause === null || !("_tag" in cause)) return false;
  return new Set([
    "SandboxSetupPrefixCacheRegistryError",
    "SandboxSetupPrefixCacheLookupError",
    "SandboxSetupPrefixCacheCaptureError",
    "SandboxSetupPrefixCacheRestoreError",
    "SandboxSetupPrefixCacheValidationError",
    "SandboxSetupPrefixCacheCleanupError",
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

function digestJson(value: unknown): string {
  return digest(canonicalJson(value));
}

function validateIdentity(value: string, field: string): void {
  if (value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${field} must be a non-empty bounded identity without control characters`);
  }
}

function validateOperation(input: SandboxSetupPrefixCacheOperation): ValidatedManifest {
  validateIdentity(input.operationId, "operationId");
  validateIdentity(input.manifest.baseImageId, "baseImageId");
  if (!exactImageId(input.manifest.baseImageId)) {
    throw new TypeError("baseImageId must be an exact Docker image id");
  }
  validateIdentity(input.manifest.setupPrefixKey, "setupPrefixKey");
  validateIdentity(input.manifest.setupManifestDigest, "setupManifestDigest");
  validateIdentity(input.manifest.storageSchemaRevision, "storageSchemaRevision");
  validateIdentity(input.manifest.artifactFormatRevision, "artifactFormatRevision");
  if (!Number.isFinite(input.manifest.changeFrequency) || input.manifest.changeFrequency < 0) {
    throw new TypeError("changeFrequency must be a finite non-negative number");
  }
  const declarationJson = canonicalJson(input.manifest.declarationMetadata);
  return {
    value: input.manifest,
    declarationJson,
    declarationDigest: digest(declarationJson),
  };
}

function assertSetupPrefixTableColumns(db: DatabaseSync, table: string, required: readonly string[]): void {
  const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ readonly name: string }>)
    .map((column) => column.name));
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(`Docker cache registry schema v1 table ${table} is missing columns: ${missing.join(", ")}`);
  }
}

function setupPrefixSchema(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const setupTableExists = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'setup_prefix_entries'",
    ).get() !== undefined;
    const storedVersion = db.prepare(
      "SELECT value FROM metadata WHERE key = 'setupPrefixRegistrySchemaVersion'",
    ).get() as { readonly value: string } | undefined;
    if (storedVersion !== undefined && storedVersion.value !== String(SETUP_PREFIX_REGISTRY_SCHEMA_VERSION)) {
      throw new Error(
        `Docker setup-prefix registry schema ${JSON.stringify(storedVersion.value)} is unsupported; ` +
        `this NiceEval understands only v${SETUP_PREFIX_REGISTRY_SCHEMA_VERSION}`,
      );
    }
    if (setupTableExists) {
      const columns = new Set(
        (db.prepare("PRAGMA table_info(setup_prefix_entries)").all() as Array<{ readonly name: string }>)
          .map((column) => column.name),
      );
      if (!columns.has("base_image_id")) {
        const legacyColumns = [
          "entry_id", "setup_prefix_key", "image_id", "declaration_json", "declaration_digest",
          "setup_manifest_digest", "storage_schema_revision", "artifact_format_revision", "dependency",
          "change_frequency", "generation", "operation_id", "created_at", "last_successful_use_at",
          "protected_until", "state",
        ] as const;
        if (storedVersion !== undefined || legacyColumns.some((column) => !columns.has(column))) {
          throw new Error("Docker setup-prefix registry has an unknown unversioned table shape");
        }
        const activeLeases = db.prepare(
          "SELECT COUNT(*) AS count FROM setup_prefix_leases WHERE state = 'active'",
        ).get() as { readonly count: number };
        const activeRoots = db.prepare(
          "SELECT COUNT(*) AS count FROM setup_prefix_roots WHERE state IN ('prepared','active')",
        ).get() as { readonly count: number };
        if (activeLeases.count !== 0 || activeRoots.count !== 0) {
          throw new Error("Docker setup-prefix legacy registry still has active ownership; migration fails closed");
        }
        // The legacy schema did not record exact Base identity. Its entries can
        // remain provider/GC evidence, but none may survive as a logical hit.
        // A non-exact sentinel keeps the column NOT NULL; triggers below make
        // older writers fail instead of publishing another unverifiable row.
        db.exec("ALTER TABLE setup_prefix_entries ADD COLUMN base_image_id TEXT NOT NULL DEFAULT 'legacy-unverified'");
        db.exec("DELETE FROM setup_prefix_index");
        db.exec("UPDATE setup_prefix_entries SET state = 'unverified'");
      }
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS setup_prefix_entries (
      entry_id TEXT PRIMARY KEY,
      setup_prefix_key TEXT NOT NULL,
      base_image_id TEXT NOT NULL,
      image_id TEXT,
      declaration_json TEXT NOT NULL,
      declaration_digest TEXT NOT NULL,
      setup_manifest_digest TEXT NOT NULL,
      storage_schema_revision TEXT NOT NULL,
      artifact_format_revision TEXT NOT NULL,
      dependency TEXT NOT NULL CHECK(dependency = 'parent-backed'),
      change_frequency REAL NOT NULL,
      generation INTEGER NOT NULL,
      operation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_successful_use_at TEXT,
      protected_until TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('reserved','building','published','indexed','invalidated','deleting','tombstoned','unverified')),
      UNIQUE(setup_prefix_key, generation)
    );
      CREATE UNIQUE INDEX IF NOT EXISTS setup_prefix_writer
        ON setup_prefix_entries(setup_prefix_key)
        WHERE state IN ('reserved','building','published','deleting');
      CREATE TABLE IF NOT EXISTS setup_prefix_index (
      setup_prefix_key TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL UNIQUE REFERENCES setup_prefix_entries(entry_id)
    );
      CREATE TABLE IF NOT EXISTS setup_prefix_generation_fences (
      setup_prefix_key TEXT PRIMARY KEY,
      next_generation INTEGER NOT NULL
    );
      CREATE TABLE IF NOT EXISTS setup_prefix_leases (
      lease_id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES setup_prefix_entries(entry_id),
      setup_prefix_key TEXT NOT NULL,
      generation INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('build','read','handoff')),
      operation_id TEXT NOT NULL,
      holder_host_id TEXT NOT NULL,
      holder_boot_id TEXT NOT NULL,
      holder_pid INTEGER NOT NULL,
      holder_process_start TEXT NOT NULL,
      heartbeat_sequence INTEGER NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('active','released','expired-unverified','ended'))
    );
      CREATE TABLE IF NOT EXISTS setup_prefix_roots (
      root_id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES setup_prefix_entries(entry_id),
      setup_prefix_key TEXT NOT NULL,
      generation INTEGER NOT NULL,
      sandbox_id TEXT NOT NULL,
      sandbox_resource_identity TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('prepared','active','releasing')),
      created_at TEXT NOT NULL
    );
      CREATE TRIGGER IF NOT EXISTS setup_prefix_exact_base_insert
      BEFORE INSERT ON setup_prefix_entries
      WHEN length(NEW.base_image_id) != 71
        OR substr(NEW.base_image_id, 1, 7) != 'sha256:'
        OR substr(NEW.base_image_id, 8) GLOB '*[^0-9a-f]*'
      BEGIN
        SELECT RAISE(ABORT, 'setup-prefix exact Base identity is required');
      END;
      CREATE TRIGGER IF NOT EXISTS setup_prefix_exact_base_update
      BEFORE UPDATE OF base_image_id ON setup_prefix_entries
      WHEN length(NEW.base_image_id) != 71
        OR substr(NEW.base_image_id, 1, 7) != 'sha256:'
        OR substr(NEW.base_image_id, 8) GLOB '*[^0-9a-f]*'
      BEGIN
        SELECT RAISE(ABORT, 'setup-prefix exact Base identity is required');
      END;
    `);
    assertSetupPrefixTableColumns(db, "setup_prefix_entries", [
      "entry_id", "setup_prefix_key", "base_image_id", "image_id", "declaration_json",
      "declaration_digest", "setup_manifest_digest", "storage_schema_revision",
      "artifact_format_revision", "dependency", "change_frequency", "generation", "operation_id",
      "created_at", "last_successful_use_at", "protected_until", "state",
    ]);
    db.prepare("INSERT OR IGNORE INTO metadata(key, value) VALUES ('setupPrefixSafetyRevision', '1')").run();
    db.prepare(
      "INSERT OR IGNORE INTO metadata(key, value) VALUES ('setupPrefixRegistrySchemaVersion', ?)",
    ).run(String(SETUP_PREFIX_REGISTRY_SCHEMA_VERSION));
    const publishedVersion = db.prepare(
      "SELECT value FROM metadata WHERE key = 'setupPrefixRegistrySchemaVersion'",
    ).get() as { readonly value: string };
    if (publishedVersion.value !== String(SETUP_PREFIX_REGISTRY_SCHEMA_VERSION)) {
      throw new Error("Docker setup-prefix registry schema changed during initialization");
    }
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

const domainStartupReconciliations = new Map<string, Promise<void>>();

async function reconcileSetupPrefixDomainAtStartup(domain: DockerCacheDomainHandle): Promise<void> {
  // Startup reconciliation is shared by callers, so it owns a bounded signal
  // instead of borrowing one caller's cancellation. A cache-operation
  // finalizer may join this promise, but never indefinitely.
  const signal = AbortSignal.timeout(PROVIDER_CLEANUP_TIMEOUT_MS);
  const incomplete = domain.db.prepare(`
    SELECT * FROM setup_prefix_entries WHERE state IN ('reserved','building')
    ORDER BY setup_prefix_key, generation
  `).all() as unknown as SetupPrefixEntryRow[];
  for (const row of incomplete) {
    // A live or not-yet-verifiably-expired build lease owns this promotion. A
    // dead writer is isolated; any image it produced remains an unverified
    // registry/provider claim and is never auto-adopted or auto-deleted.
    if (reconcileLeaseCount(domain.db, row.entry_id) > 0) continue;
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
    domain.db.exec("BEGIN IMMEDIATE");
    try {
      domain.db.prepare("DELETE FROM setup_prefix_index WHERE entry_id = ?").run(row.entry_id);
      domain.db.prepare(`
        UPDATE setup_prefix_entries SET image_id = ?, state = 'unverified'
        WHERE entry_id = ? AND state IN ('reserved','building')
      `).run(verifiedClaims.length === 1 ? verifiedClaims[0]! : null, row.entry_id);
      domain.db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'setupPrefixSafetyRevision'").run();
      domain.db.exec("COMMIT");
    } catch (cause) {
      domain.db.exec("ROLLBACK");
      throw cause;
    }
  }

  const rows = domain.db.prepare(`
    SELECT * FROM setup_prefix_entries WHERE state IN ('published','indexed')
    ORDER BY setup_prefix_key, generation
  `).all() as unknown as SetupPrefixEntryRow[];
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
    domain.db.exec("BEGIN IMMEDIATE");
    try {
      if (!valid) {
        domain.db.prepare("DELETE FROM setup_prefix_index WHERE entry_id = ?").run(row.entry_id);
        domain.db.prepare("UPDATE setup_prefix_entries SET state = 'unverified' WHERE entry_id = ?")
          .run(row.entry_id);
      } else if (row.state === "published") {
        const active = domain.db.prepare("SELECT entry_id FROM setup_prefix_index WHERE setup_prefix_key = ?")
          .get(row.setup_prefix_key) as { readonly entry_id: string } | undefined;
        if (active === undefined || active.entry_id === row.entry_id) {
          domain.db.prepare("INSERT OR IGNORE INTO setup_prefix_index(setup_prefix_key, entry_id) VALUES (?, ?)")
            .run(row.setup_prefix_key, row.entry_id);
          domain.db.prepare("UPDATE setup_prefix_entries SET state = 'indexed' WHERE entry_id = ? AND state = 'published'")
            .run(row.entry_id);
        } else {
          domain.db.prepare("UPDATE setup_prefix_entries SET state = 'unverified' WHERE entry_id = ?")
            .run(row.entry_id);
        }
      } else {
        const active = domain.db.prepare("SELECT entry_id FROM setup_prefix_index WHERE setup_prefix_key = ?")
          .get(row.setup_prefix_key) as { readonly entry_id: string } | undefined;
        if (active?.entry_id !== row.entry_id) {
          domain.db.prepare("UPDATE setup_prefix_entries SET state = 'unverified' WHERE entry_id = ?")
            .run(row.entry_id);
        }
      }
      domain.db.exec("COMMIT");
    } catch (cause) {
      domain.db.exec("ROLLBACK");
      throw cause;
    }
  }
}

async function openSetupPrefixDomain(): Promise<DockerCacheDomainHandle> {
  const domain = await openDockerCacheDomain();
  try {
    setupPrefixSchema(domain.db);
    let reconciliation = domainStartupReconciliations.get(domain.domainId);
    if (reconciliation === undefined) {
      reconciliation = reconcileSetupPrefixDomainAtStartup(domain).catch((cause) => {
        domainStartupReconciliations.delete(domain.domainId);
        throw cause;
      });
      domainStartupReconciliations.set(domain.domainId, reconciliation);
    }
    await reconciliation;
    return domain;
  } catch (cause) {
    domain.db.close();
    throw cause;
  }
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

function labelsFor(domain: DockerCacheDomainHandle, row: SetupPrefixEntryRow): Readonly<Record<string, string>> {
  return Object.freeze({
    [LABEL.kind]: CACHE_KIND,
    [LABEL.protocol]: String(CACHE_PROTOCOL_VERSION),
    [LABEL.domainId]: domain.domainId,
    [LABEL.entryId]: row.entry_id,
    [LABEL.operationId]: row.operation_id,
    [LABEL.generation]: String(row.generation),
    [LABEL.setupPrefixKey]: row.setup_prefix_key,
    [LABEL.baseImageId]: row.base_image_id,
    [LABEL.setupManifestDigest]: row.setup_manifest_digest,
    [LABEL.declarationDigest]: row.declaration_digest,
    [LABEL.storageSchemaRevision]: row.storage_schema_revision,
    [LABEL.artifactFormatRevision]: row.artifact_format_revision,
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

function manifestMatches(row: SetupPrefixEntryRow, manifest: ValidatedManifest): boolean {
  return row.base_image_id === manifest.value.baseImageId &&
    row.setup_manifest_digest === manifest.value.setupManifestDigest &&
    row.storage_schema_revision === manifest.value.storageSchemaRevision &&
    row.artifact_format_revision === manifest.value.artifactFormatRevision &&
    row.declaration_digest === manifest.declarationDigest &&
    row.declaration_json === manifest.declarationJson &&
    row.change_frequency === manifest.value.changeFrequency &&
    row.dependency === "parent-backed";
}

class SetupPrefixLease {
  private released = false;
  private heartbeatFailure: unknown;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(
    readonly domain: DockerCacheDomainHandle,
    readonly row: SetupPrefixEntryRow,
    readonly leaseId: string,
    readonly kind: "build" | "handoff",
  ) {
    this.heartbeat = setInterval(() => {
      if (this.released || this.heartbeatFailure !== undefined) return;
      try {
        const now = Date.now();
        const updated = this.domain.db.prepare(`
          UPDATE setup_prefix_leases
          SET heartbeat_sequence = heartbeat_sequence + 1, heartbeat_at = ?, expires_at = ?
          WHERE lease_id = ? AND state = 'active'
        `).run(new Date(now).toISOString(), new Date(now + LEASE_TTL_MS).toISOString(), this.leaseId);
        if (updated.changes !== 1) throw new Error("the durable setup-prefix lease disappeared during use");
      } catch (cause) {
        // Preserve the durable row as a GC veto; surface this failure synchronously at release.
        this.heartbeatFailure = cause;
      }
    }, LEASE_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    clearInterval(this.heartbeat);
    let releaseFailure: unknown;
    try {
      const removed = this.domain.db.prepare("DELETE FROM setup_prefix_leases WHERE lease_id = ?").run(this.leaseId);
      if (removed.changes !== 1) releaseFailure = new Error("the durable setup-prefix lease disappeared before release");
    } catch (cause) {
      releaseFailure = cause;
    }
    this.domain.db.close();
    const failure = releaseFailure ?? this.heartbeatFailure;
    if (failure !== undefined) {
      throw new SandboxSetupPrefixCacheCleanupError({
        operation: `release setup-prefix ${this.kind} lease`,
        reason: errorMessage(failure),
        setupPrefixKey: this.row.setup_prefix_key,
        domainId: this.domain.domainId,
        cause: failure,
      });
    }
  }
}

async function acquireIndexedLease(
  operation: SandboxSetupPrefixCacheOperation,
  manifest: ValidatedManifest,
  expectedEntryId?: string,
): Promise<SetupPrefixLease | undefined> {
  const domain = await openSetupPrefixDomain();
  const holder = holderIdentity();
  const leaseId = randomUUID();
  const now = Date.now();
  domain.db.exec("BEGIN IMMEDIATE");
  try {
    const row = domain.db.prepare(`
      SELECT entry.* FROM setup_prefix_index AS active
      JOIN setup_prefix_entries AS entry ON entry.entry_id = active.entry_id
      WHERE active.setup_prefix_key = ?
    `).get(manifest.value.setupPrefixKey) as unknown as SetupPrefixEntryRow | undefined;
    if (row === undefined) {
      domain.db.exec("COMMIT");
      domain.db.close();
      return undefined;
    }
    if (row.state !== "indexed" || (expectedEntryId !== undefined && row.entry_id !== expectedEntryId)) {
      throw new SandboxSetupPrefixCacheValidationError({
        operation: "acquire lookup lease",
        reason: "the setup-prefix index no longer names the expected indexed generation",
        setupPrefixKey: manifest.value.setupPrefixKey,
        domainId: domain.domainId,
      });
    }
    if (!manifestMatches(row, manifest)) {
      throw new SandboxSetupPrefixCacheValidationError({
        operation: "acquire lookup lease",
        reason: "the indexed setup-prefix declaration or manifest metadata does not match the requested key",
        setupPrefixKey: manifest.value.setupPrefixKey,
        domainId: domain.domainId,
      });
    }
    domain.db.prepare(`
      INSERT INTO setup_prefix_leases(
        lease_id, entry_id, setup_prefix_key, generation, kind, operation_id,
        holder_host_id, holder_boot_id, holder_pid, holder_process_start,
        heartbeat_sequence, heartbeat_at, expires_at, state
      ) VALUES (?, ?, ?, ?, 'handoff', ?, ?, ?, ?, ?, 0, ?, ?, 'active')
    `).run(
      leaseId,
      row.entry_id,
      row.setup_prefix_key,
      row.generation,
      operation.operationId,
      holder.hostId,
      holder.bootId,
      holder.pid,
      holder.processStart,
      new Date(now).toISOString(),
      new Date(now + LEASE_TTL_MS).toISOString(),
    );
    domain.db.exec("COMMIT");
    return new SetupPrefixLease(domain, row, leaseId, "handoff");
  } catch (cause) {
    try {
      domain.db.exec("ROLLBACK");
    } finally {
      domain.db.close();
    }
    throw cause;
  }
}

async function markEntryUnverified(entryId: string): Promise<void> {
  const domain = await openSetupPrefixDomain();
  try {
    domain.db.exec("BEGIN IMMEDIATE");
    domain.db.prepare("DELETE FROM setup_prefix_index WHERE entry_id = ?").run(entryId);
    domain.db.prepare(`
      UPDATE setup_prefix_entries SET state = 'unverified'
      WHERE entry_id = ? AND state NOT IN ('tombstoned','deleting')
    `).run(entryId);
    domain.db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'setupPrefixSafetyRevision'").run();
    domain.db.exec("COMMIT");
  } catch (cause) {
    domain.db.exec("ROLLBACK");
    throw cause;
  } finally {
    domain.db.close();
  }
}

async function releaseDurableRoot(input: {
  readonly domainId: string;
  readonly rootId: string;
  readonly entryId: string;
  readonly containerId: string;
  readonly setupPrefixKey: string;
}): Promise<void> {
  const domain = await openSetupPrefixDomain();
  try {
    if (domain.domainId !== input.domainId) throw new Error("Docker cache Domain authority changed while releasing a root");
    domain.db.prepare(`
      UPDATE setup_prefix_roots SET state = 'releasing'
      WHERE root_id = ? AND entry_id = ? AND sandbox_resource_identity = ? AND state IN ('prepared','active','releasing')
    `).run(input.rootId, input.entryId, input.containerId);
    if (await containerExists(input.containerId, AbortSignal.timeout(PROVIDER_CLEANUP_TIMEOUT_MS))) {
      throw new Error(`Docker container ${input.containerId} still references the setup-prefix image`);
    }
    domain.db.prepare(`
      DELETE FROM setup_prefix_roots
      WHERE root_id = ? AND entry_id = ? AND sandbox_resource_identity = ? AND state = 'releasing'
    `).run(input.rootId, input.entryId, input.containerId);
  } catch (cause) {
    throw new SandboxSetupPrefixCacheCleanupError({
      operation: "release durable setup-prefix root",
      reason: errorMessage(cause),
      setupPrefixKey: input.setupPrefixKey,
      domainId: input.domainId,
      cause,
    });
  } finally {
    domain.db.close();
  }
}

async function restoreLeaseIntoTarget(
  target: DockerSetupPrefixCacheTarget,
  lease: SetupPrefixLease,
  operation: SandboxSetupPrefixCacheOperation,
  signal: AbortSignal,
): Promise<{ readonly imageId: string; readonly sandboxId: string }> {
  signal.throwIfAborted();
  const row = lease.row;
  if (row.image_id === null || !exactImageId(row.image_id)) {
    throw new SandboxSetupPrefixCacheValidationError({
      operation: "restore exact setup-prefix image",
      reason: "the indexed generation has no exact Docker image id",
      setupPrefixKey: row.setup_prefix_key,
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
      throw new SandboxSetupPrefixCacheCleanupError({
        operation: "isolate invalid setup-prefix generation",
        reason: "exact-image validation failed and the generation could not be removed from the hit index",
        setupPrefixKey: row.setup_prefix_key,
        domainId: lease.domain.domainId,
        cause: new AggregateError([cause, cleanupCause]),
      });
    }
    throw new SandboxSetupPrefixCacheValidationError({
      operation: "validate exact setup-prefix image",
      reason: errorMessage(cause),
      setupPrefixKey: row.setup_prefix_key,
      domainId: lease.domain.domainId,
      cause,
    });
  }

  const rootId = randomUUID();
  const plannedName = `niceeval-setup-prefix-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  lease.domain.db.prepare(`
    INSERT INTO setup_prefix_roots(
      root_id, entry_id, setup_prefix_key, generation, sandbox_id,
      sandbox_resource_identity, operation_id, state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?)
  `).run(
    rootId,
    row.entry_id,
    row.setup_prefix_key,
    row.generation,
    plannedName,
    plannedName,
    operation.operationId,
    createdAt,
  );

  let rebound: { readonly containerId: string; readonly imageId: string } | undefined;
  try {
    rebound = await target.rebaseToExactImage(row.image_id, plannedName, signal);
    signal.throwIfAborted();
    if (rebound.imageId !== row.image_id) {
      throw new Error(`private clone uses ${rebound.imageId}, expected exact image ${row.image_id}`);
    }
    const activated = lease.domain.db.prepare(`
      UPDATE setup_prefix_roots
      SET sandbox_id = ?, sandbox_resource_identity = ?, state = 'active'
      WHERE root_id = ? AND entry_id = ? AND generation = ? AND state = 'prepared'
    `).run(rebound.containerId, rebound.containerId, rootId, row.entry_id, row.generation);
    if (activated.changes !== 1) throw new Error("prepared setup-prefix root could not be activated");
    target.adoptSetupPrefixRoot({
      containerId: rebound.containerId,
      release: () => releaseDurableRoot({
        domainId: lease.domain.domainId,
        rootId,
        entryId: row.entry_id,
        containerId: rebound!.containerId,
        setupPrefixKey: row.setup_prefix_key,
      }),
    });
    const usedAt = new Date().toISOString();
    const updated = lease.domain.db.prepare(`
      UPDATE setup_prefix_entries SET last_successful_use_at = ?
      WHERE entry_id = ? AND generation = ? AND state = 'indexed'
    `).run(usedAt, row.entry_id, row.generation);
    if (updated.changes !== 1) throw new Error("setup-prefix generation changed before delivery completed");
    return { imageId: row.image_id, sandboxId: rebound.containerId.slice(0, 12) };
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    try {
      await target.destroyCurrentForCacheRecovery();
    } catch (cleanupCause) {
      cleanupFailures.push(cleanupCause);
    }
    try {
      lease.domain.db.prepare("DELETE FROM setup_prefix_roots WHERE root_id = ?").run(rootId);
    } catch (cleanupCause) {
      cleanupFailures.push(cleanupCause);
    }
    try {
      await markEntryUnverified(row.entry_id);
    } catch (cleanupCause) {
      cleanupFailures.push(cleanupCause);
    }
    if (cleanupFailures.length > 0) {
      throw new SandboxSetupPrefixCacheCleanupError({
        operation: "clean partial setup-prefix restore",
        reason: "restore failed and its partial provider/registry resources could not be fully retired",
        setupPrefixKey: row.setup_prefix_key,
        domainId: lease.domain.domainId,
        cause: new AggregateError([cause, ...cleanupFailures]),
      });
    }
    throw new SandboxSetupPrefixCacheRestoreError({
      operation: "restore exact setup-prefix image",
      reason: errorMessage(cause),
      setupPrefixKey: row.setup_prefix_key,
      domainId: lease.domain.domainId,
      cause,
    });
  }
}

async function lookupAndRebase(
  target: DockerSetupPrefixCacheTarget,
  input: SandboxSetupPrefixCacheOperation,
  signal: AbortSignal,
): Promise<SandboxSetupPrefixCacheLookupResult> {
  const eligibility = target.eligibility();
  if (eligibility._tag === "Unsupported") return eligibility;
  let manifest: ValidatedManifest;
  try {
    manifest = validateOperation(input);
    if (manifest.value.baseImageId !== eligibility.baseImageId) {
      throw new Error("setup-prefix lookup Base image does not match the initialized provider Base");
    }
  } catch (cause) {
    throw new SandboxSetupPrefixCacheValidationError({
      operation: "validate setup-prefix lookup",
      reason: errorMessage(cause),
      setupPrefixKey: input.manifest.setupPrefixKey,
      cause,
    });
  }
  let lease: SetupPrefixLease | undefined;
  try {
    lease = await acquireIndexedLease(input, manifest);
    if (lease === undefined) return { _tag: "Miss", setupPrefixKey: manifest.value.setupPrefixKey } as const;
    signal.throwIfAborted();
    const restored = await restoreLeaseIntoTarget(target, lease, input, signal);
    return {
      _tag: "Restored",
      setupPrefixKey: manifest.value.setupPrefixKey,
      entryId: lease.row.entry_id,
      generation: lease.row.generation,
      imageId: restored.imageId,
      sandboxId: restored.sandboxId,
    } as const;
  } catch (cause) {
    if (isSetupPrefixError(cause)) throw cause;
    throw new SandboxSetupPrefixCacheLookupError({
      operation: `lookup and restore setup-prefix cache:${safeFailureClass(cause)}`,
      reason: errorMessage(cause),
      setupPrefixKey: manifest.value.setupPrefixKey,
      cause,
    });
  } finally {
    lease?.release();
  }
}

async function reserveEntry(
  input: SandboxSetupPrefixCacheOperation,
  manifest: ValidatedManifest,
): Promise<
  | { readonly _tag: "Reserved"; readonly lease: SetupPrefixLease }
  | { readonly _tag: "Contended"; readonly setupPrefixKey: string; readonly reason: "active-writer" | "indexed-generation" }
> {
  const domain = await openSetupPrefixDomain();
  const holder = holderIdentity();
  const leaseId = randomUUID();
  const now = new Date();
  domain.db.exec("BEGIN IMMEDIATE");
  try {
    const indexed = domain.db.prepare(`
      SELECT entry.* FROM setup_prefix_index AS active
      JOIN setup_prefix_entries AS entry ON entry.entry_id = active.entry_id
      WHERE active.setup_prefix_key = ?
    `).get(manifest.value.setupPrefixKey) as unknown as SetupPrefixEntryRow | undefined;
    if (indexed !== undefined) {
      if (!manifestMatches(indexed, manifest)) {
        throw new Error("the indexed setup-prefix generation does not match the requested manifest");
      }
      domain.db.exec("COMMIT");
      domain.db.close();
      return {
        _tag: "Contended",
        setupPrefixKey: manifest.value.setupPrefixKey,
        reason: "indexed-generation",
      };
    }
    const activeWriter = domain.db.prepare(`
      SELECT * FROM setup_prefix_entries
      WHERE setup_prefix_key = ? AND state IN ('reserved','building','published','deleting')
      ORDER BY generation DESC LIMIT 1
    `).get(manifest.value.setupPrefixKey) as unknown as SetupPrefixEntryRow | undefined;
    if (activeWriter !== undefined) {
      if (activeWriter.operation_id === input.operationId && !manifestMatches(activeWriter, manifest)) {
        throw new Error("operation id was reused with different setup-prefix metadata");
      }
      if (
        activeWriter.state === "published" ||
        activeWriter.state === "deleting" ||
        reconcileLeaseCount(domain.db, activeWriter.entry_id) > 0
      ) {
        domain.db.exec("COMMIT");
        domain.db.close();
        return {
          _tag: "Contended",
          setupPrefixKey: manifest.value.setupPrefixKey,
          reason: "active-writer",
        };
      }
      domain.db.prepare(`
        UPDATE setup_prefix_entries SET state = 'unverified'
        WHERE entry_id = ? AND state IN ('reserved','building')
      `).run(activeWriter.entry_id);
      domain.db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'setupPrefixSafetyRevision'").run();
    }
    const existingOperation = domain.db.prepare(`
      SELECT * FROM setup_prefix_entries WHERE setup_prefix_key = ? AND operation_id = ?
      ORDER BY generation DESC LIMIT 1
    `).get(manifest.value.setupPrefixKey, input.operationId) as unknown as SetupPrefixEntryRow | undefined;
    if (existingOperation !== undefined && existingOperation.entry_id !== activeWriter?.entry_id) {
      if (!manifestMatches(existingOperation, manifest)) throw new Error("operation id was reused with different setup-prefix metadata");
      throw new Error(`operation id already settled as ${existingOperation.state}`);
    }
    const generationRow = domain.db.prepare(`
      SELECT COALESCE(MAX(generation), 0) AS generation FROM setup_prefix_entries WHERE setup_prefix_key = ?
    `).get(manifest.value.setupPrefixKey) as { readonly generation: number };
    const fence = domain.db.prepare(`
      SELECT next_generation FROM setup_prefix_generation_fences WHERE setup_prefix_key = ?
    `).get(manifest.value.setupPrefixKey) as { readonly next_generation: number } | undefined;
    const generation = Math.max(generationRow.generation + 1, fence?.next_generation ?? 1);
    const entryId = `sandbox-setup-prefix:${digest(`${manifest.value.setupPrefixKey}\0${generation}\0${input.operationId}`)}`;
    domain.db.prepare(`
      INSERT INTO setup_prefix_entries(
        entry_id, setup_prefix_key, base_image_id, image_id, declaration_json, declaration_digest,
        setup_manifest_digest, storage_schema_revision, artifact_format_revision,
        dependency, change_frequency, generation, operation_id, created_at,
        last_successful_use_at, protected_until, state
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'parent-backed', ?, ?, ?, ?, NULL, ?, 'reserved')
    `).run(
      entryId,
      manifest.value.setupPrefixKey,
      manifest.value.baseImageId,
      manifest.declarationJson,
      manifest.declarationDigest,
      manifest.value.setupManifestDigest,
      manifest.value.storageSchemaRevision,
      manifest.value.artifactFormatRevision,
      manifest.value.changeFrequency,
      generation,
      input.operationId,
      now.toISOString(),
      new Date(now.getTime() + MINIMUM_AGE_MS).toISOString(),
    );
    domain.db.prepare("UPDATE setup_prefix_entries SET state = 'building' WHERE entry_id = ? AND state = 'reserved'").run(entryId);
    domain.db.prepare(`
      INSERT INTO setup_prefix_leases(
        lease_id, entry_id, setup_prefix_key, generation, kind, operation_id,
        holder_host_id, holder_boot_id, holder_pid, holder_process_start,
        heartbeat_sequence, heartbeat_at, expires_at, state
      ) VALUES (?, ?, ?, ?, 'build', ?, ?, ?, ?, ?, 0, ?, ?, 'active')
    `).run(
      leaseId,
      entryId,
      manifest.value.setupPrefixKey,
      generation,
      input.operationId,
      holder.hostId,
      holder.bootId,
      holder.pid,
      holder.processStart,
      now.toISOString(),
      new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
    );
    domain.db.exec("COMMIT");
    const row = domain.db.prepare("SELECT * FROM setup_prefix_entries WHERE entry_id = ?").get(entryId) as unknown as SetupPrefixEntryRow;
    return { _tag: "Reserved", lease: new SetupPrefixLease(domain, row, leaseId, "build") };
  } catch (cause) {
    domain.db.exec("ROLLBACK");
    domain.db.close();
    throw cause;
  }
}

async function publishEntry(row: SetupPrefixEntryRow, imageId: string, signal: AbortSignal): Promise<void> {
  const domain = await openSetupPrefixDomain();
  try {
    signal.throwIfAborted();
    domain.db.exec("BEGIN IMMEDIATE");
    const gcLock = domain.db.prepare("SELECT cache_kind, plan_id FROM docker_image_gc_locks WHERE image_id = ?")
      .get(imageId) as { readonly cache_kind: string; readonly plan_id: string } | undefined;
    if (gcLock !== undefined) {
      throw new Error(`exact image is fenced by ${gcLock.cache_kind} GC plan ${gcLock.plan_id}`);
    }
    const published = domain.db.prepare(`
      UPDATE setup_prefix_entries SET image_id = ?, state = 'published'
      WHERE entry_id = ? AND operation_id = ? AND generation = ? AND state = 'building'
    `).run(imageId, row.entry_id, row.operation_id, row.generation);
    if (published.changes !== 1) {
      const current = domain.db.prepare(`
        SELECT image_id, state FROM setup_prefix_entries
        WHERE entry_id = ? AND operation_id = ? AND generation = ?
      `).get(row.entry_id, row.operation_id, row.generation) as {
        readonly image_id: string | null;
        readonly state: SetupPrefixEntryState;
      } | undefined;
      if (current?.image_id !== imageId || (current.state !== "published" && current.state !== "indexed")) {
        throw new Error("setup-prefix publication lost its operation/generation fence");
      }
    }
    domain.db.exec("COMMIT");

    domain.db.exec("BEGIN IMMEDIATE");
    const current = domain.db.prepare("SELECT state, image_id FROM setup_prefix_entries WHERE entry_id = ?")
      .get(row.entry_id) as { readonly state: string; readonly image_id: string | null } | undefined;
    if (current?.state === "indexed" && current.image_id === imageId) {
      const indexed = domain.db.prepare("SELECT entry_id FROM setup_prefix_index WHERE setup_prefix_key = ?")
        .get(row.setup_prefix_key) as { readonly entry_id: string } | undefined;
      if (indexed?.entry_id !== row.entry_id) throw new Error("indexed setup-prefix identity changed during publication recovery");
      domain.db.exec("COMMIT");
      return;
    }
    if (current?.state !== "published" || current.image_id !== imageId) {
      throw new Error("published setup-prefix identity changed before indexing");
    }
    domain.db.prepare("INSERT INTO setup_prefix_index(setup_prefix_key, entry_id) VALUES (?, ?)")
      .run(row.setup_prefix_key, row.entry_id);
    domain.db.prepare("UPDATE setup_prefix_entries SET state = 'indexed' WHERE entry_id = ? AND state = 'published'")
      .run(row.entry_id);
    domain.db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'setupPrefixSafetyRevision'").run();
    domain.db.exec("COMMIT");
  } catch (cause) {
    try {
      domain.db.exec("ROLLBACK");
    } catch {
      // The caller marks this generation unverified in a new connection.
    }
    throw cause;
  } finally {
    domain.db.close();
  }
}

async function failedCaptureImageCanBeRemoved(imageId: string, entryId: string): Promise<boolean> {
  const domain = await openSetupPrefixDomain();
  try {
    const gcLock = domain.db.prepare("SELECT 1 AS present FROM docker_image_gc_locks WHERE image_id = ?")
      .get(imageId);
    return gcLock === undefined &&
      !taskBuildClaimsImage(domain.db, imageId) &&
      !siblingSetupPrefixClaimsImage(domain.db, entryId, imageId);
  } finally {
    domain.db.close();
  }
}

async function captureAndRebase(
  target: DockerSetupPrefixCacheTarget,
  input: SandboxSetupPrefixCacheOperation,
  signal: AbortSignal,
): Promise<SandboxSetupPrefixCacheCaptureResult> {
  const eligibility = target.eligibility();
  if (eligibility._tag === "Unsupported") return eligibility;
  let manifest: ValidatedManifest;
  try {
    manifest = validateOperation(input);
    if (manifest.value.baseImageId !== eligibility.baseImageId) {
      throw new Error("setup-prefix capture Base image does not match the initialized provider Base");
    }
  } catch (cause) {
    throw new SandboxSetupPrefixCacheValidationError({
      operation: "validate setup-prefix capture",
      reason: errorMessage(cause),
      setupPrefixKey: input.manifest.setupPrefixKey,
      cause,
    });
  }

  let reservation: SetupPrefixLease | undefined;
  let reservedRow: SetupPrefixEntryRow | undefined;
  let imageId: string | undefined;
  try {
    signal.throwIfAborted();
    const reserved = await reserveEntry(input, manifest);
    if (reserved._tag === "Contended") return reserved;
    reservation = reserved.lease;
    reservedRow = reservation.row;
    const labels = labelsFor(reservation.domain, reservedRow);
    imageId = await target.captureExactImage(labels, input.knownSensitiveValues ?? [], signal);
    signal.throwIfAborted();
    const inspection = await inspectExactImage(imageId, signal);
    validateImageLabels(inspection, imageId, labels);
    await publishEntry(reservedRow, imageId, signal);
    signal.throwIfAborted();
    const lease = await acquireIndexedLease(input, manifest, reservedRow.entry_id);
    if (lease === undefined) throw new Error("captured setup-prefix generation was not indexed");
    try {
      // The handoff lease now closes the build-lease-to-root protection window.
      reservation.release();
      reservation = undefined;
      const restored = await restoreLeaseIntoTarget(target, lease, input, signal);
      return {
        _tag: "Captured",
        setupPrefixKey: manifest.value.setupPrefixKey,
        entryId: reservedRow.entry_id,
        generation: reservedRow.generation,
        imageId: restored.imageId,
        sandboxId: restored.sandboxId,
      } as const;
    } finally {
      lease.release();
    }
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    if (reservation !== undefined) {
      try {
        reservation.release();
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
      throw new SandboxSetupPrefixCacheCleanupError({
        operation: "clean failed setup-prefix capture",
        reason: "capture failed and its unindexed image/registry claim could not be fully retired",
        setupPrefixKey: manifest.value.setupPrefixKey,
        cause: new AggregateError([cause, ...cleanupFailures]),
      });
    }
    if (isSetupPrefixError(cause)) throw cause;
    throw new SandboxSetupPrefixCacheCaptureError({
      operation: "capture and publish setup-prefix image",
      reason: errorMessage(cause),
      setupPrefixKey: manifest.value.setupPrefixKey,
      cause,
    });
  }
}

export function makeDockerSetupPrefixCacheCapability(
  target: DockerSetupPrefixCacheTarget,
): SandboxSetupPrefixCacheCapability {
  const scopedOperation = <A>(
    run: (signal: AbortSignal) => Promise<A>,
    mapError: (cause: unknown) => SandboxSetupPrefixCacheError,
  ): Effect.Effect<A, SandboxSetupPrefixCacheError> => Effect.acquireUseRelease(
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
      new DOMException("setup-prefix cache operation scope closed", "AbortError"),
    )).pipe(Effect.zipRight(Effect.promise(() => settled))),
  );

  return Object.freeze({
    eligibility: target.eligibility,
    lookupAndRebase: (input: SandboxSetupPrefixCacheOperation) => scopedOperation(
      (signal) => lookupAndRebase(target, input, signal),
      (cause) => isSetupPrefixError(cause)
        ? cause
        : new SandboxSetupPrefixCacheLookupError({
            operation: "lookup and restore setup-prefix cache",
            reason: errorMessage(cause),
            setupPrefixKey: input.manifest.setupPrefixKey,
            cause,
          }),
    ),
    captureAndRebase: (input: SandboxSetupPrefixCacheOperation) => scopedOperation(
      (signal) => captureAndRebase(target, input, signal),
      (cause) => isSetupPrefixError(cause)
        ? cause
        : new SandboxSetupPrefixCacheCaptureError({
            operation: "capture and publish setup-prefix cache",
            reason: errorMessage(cause),
            setupPrefixKey: input.manifest.setupPrefixKey,
            cause,
          }),
    ),
    recoverCleanBase: () => scopedOperation(
      async (signal) => {
        const eligibility = target.eligibility();
        if (eligibility._tag === "Unsupported") return eligibility;
        const recovered = await target.recoverCleanBase(signal);
        if (!exactImageId(recovered.baseImageId)) throw new Error("clean Base recovery did not use an exact image id");
        return { _tag: "RecoveredCleanBase", ...recovered } as const;
      },
      (cause) => isSetupPrefixError(cause)
        ? cause
        : new SandboxSetupPrefixCacheRestoreError({
            operation: "recover a clean exact Base",
            reason: errorMessage(cause),
            cause,
          }),
    ),
  });
}

function reconcileLeaseCount(db: DatabaseSync, entryId: string): number {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT lease_id, holder_host_id, holder_boot_id, holder_pid, holder_process_start, expires_at, state
    FROM setup_prefix_leases WHERE entry_id = ? AND state IN ('active','expired-unverified')
  `).all(entryId) as unknown as Array<{
    readonly lease_id: string;
    readonly holder_host_id: string;
    readonly holder_boot_id: string;
    readonly holder_pid: number;
    readonly holder_process_start: string;
    readonly expires_at: string;
    readonly state: "active" | "expired-unverified";
  }>;
  let active = 0;
  for (const row of rows) {
    if (Date.parse(row.expires_at) + LEASE_RECONCILE_GRACE_MS >= now) {
      active += 1;
      continue;
    }
    if (
      row.holder_host_id !== hostname() ||
      processIdentityIsLive(row.holder_pid, row.holder_boot_id, row.holder_process_start)
    ) {
      db.prepare("UPDATE setup_prefix_leases SET state = 'expired-unverified' WHERE lease_id = ?")
        .run(row.lease_id);
      active += 1;
    } else {
      db.prepare("DELETE FROM setup_prefix_leases WHERE lease_id = ?").run(row.lease_id);
    }
  }
  return active;
}

function taskBuildClaimsImage(db: DatabaseSync, imageId: string): boolean {
  return db.prepare(`
    SELECT 1 AS present FROM entries WHERE image_id = ? AND state != 'tombstoned' LIMIT 1
  `).get(imageId) !== undefined;
}

function siblingSetupPrefixClaimsImage(db: DatabaseSync, entryId: string, imageId: string): boolean {
  return db.prepare(`
    SELECT 1 AS present FROM setup_prefix_entries
    WHERE image_id = ? AND entry_id != ? AND state != 'tombstoned' LIMIT 1
  `).get(imageId, entryId) !== undefined;
}
