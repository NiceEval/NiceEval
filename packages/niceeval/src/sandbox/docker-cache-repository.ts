import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { UserDatabaseInvalid } from "../user-database/errors.ts";
import type { UserDatabaseRepositoryHandler } from "../user-database/repository.ts";

export const DOCKER_CACHE_REPOSITORY = "docker-cache" as const;
export const DOCKER_CACHE_REPOSITORY_REVISION = 1;

export type DockerCacheEntryState = "indexed" | "deleting" | "tombstoned" | "unverified";
export type DockerSetupPrefixEntryState =
  | "reserved"
  | "building"
  | "published"
  | "indexed"
  | "invalidated"
  | "deleting"
  | "tombstoned"
  | "unverified";

export interface DockerCacheDomainRow {
  readonly domainId: string;
  readonly ownerId: string;
  readonly daemonId: string;
  readonly storageDriver: string;
  readonly sentinelId: string;
  readonly backendIdentity: string;
  readonly authorityEpoch: string;
  readonly providerFamily: "docker";
  readonly adminProtocolVersion: 1;
  readonly backendKind: "docker-images";
  readonly firstVerifiedAt: string;
  readonly lastVerifiedAt: string;
  readonly lastState: "verified-managed";
}

export interface DockerTaskBuildEntryRow {
  readonly buildKey: string;
  readonly tag: string;
  readonly imageId: string;
  readonly createdAt: string;
  readonly lastSuccessfulUseAt: string | null;
  readonly protectedUntil: string;
  readonly manifestDigest: string;
  readonly generation: number;
  readonly operationId: string;
  readonly state: DockerCacheEntryState;
}

export interface DockerTaskBuildLeaseRow {
  readonly leaseId: string;
  readonly buildKey: string;
  readonly holderPid: number;
  readonly holderBootId: string;
  readonly holderProcessStart: string;
  readonly generation: number;
  readonly createdAt: string;
  readonly heartbeatAt: string;
}

export interface DockerTaskBuildRootRow {
  readonly rootId: string;
  readonly buildKey: string;
  readonly holderPid: number;
  readonly holderBootId: string;
  readonly holderProcessStart: string;
  readonly generation: number;
  readonly state: "prepared" | "active";
  readonly createdAt: string;
}

export interface DockerImageGcLockRow {
  readonly imageId: string;
  readonly cacheKind: "task-build" | "sandbox-setup-prefix";
  readonly planId: string;
  readonly entryId: string;
  readonly entryGeneration: number;
  readonly holderPid: number;
  readonly holderBootId: string;
  readonly holderProcessStart: string;
  readonly createdAt: string;
}

export interface DockerSetupPrefixEntryRow {
  readonly entryId: string;
  readonly setupPrefixKey: string;
  readonly baseImageId: string;
  readonly imageId: string | null;
  readonly declarationJson: string;
  readonly declarationDigest: string;
  readonly setupManifestDigest: string;
  readonly storageSchemaRevision: string;
  readonly artifactFormatRevision: string;
  readonly dependency: "parent-backed";
  readonly changeFrequency: number;
  readonly generation: number;
  readonly operationId: string;
  readonly createdAt: string;
  readonly lastSuccessfulUseAt: string | null;
  readonly protectedUntil: string;
  readonly state: DockerSetupPrefixEntryState;
}

export interface DockerSetupPrefixLeaseRow {
  readonly leaseId: string;
  readonly entryId: string;
  readonly setupPrefixKey: string;
  readonly generation: number;
  readonly kind: "build" | "read" | "handoff";
  readonly operationId: string;
  readonly holderHostId: string;
  readonly holderBootId: string;
  readonly holderPid: number;
  readonly holderProcessStart: string;
  readonly heartbeatSequence: number;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
  readonly state: "active" | "released" | "expired-unverified" | "ended";
}

export interface DockerSetupPrefixRootRow {
  readonly rootId: string;
  readonly entryId: string;
  readonly setupPrefixKey: string;
  readonly generation: number;
  readonly sandboxId: string;
  readonly sandboxResourceIdentity: string;
  readonly operationId: string;
  readonly state: "prepared" | "active" | "releasing";
  readonly createdAt: string;
}

export interface DockerSetupPrefixManifestFields {
  readonly setupPrefixKey: string;
  readonly baseImageId: string;
  readonly declarationJson: string;
  readonly declarationDigest: string;
  readonly setupManifestDigest: string;
  readonly storageSchemaRevision: string;
  readonly artifactFormatRevision: string;
  readonly changeFrequency: number;
}

export interface DockerHolderIdentity {
  readonly hostId: string;
  readonly bootId: string;
  readonly pid: number;
  readonly processStart: string;
}

interface RepositoryRequestBase {
  readonly repository: typeof DOCKER_CACHE_REPOSITORY;
}

export type DockerCacheRepositoryRequest =
  | RepositoryRequestBase & { readonly operation: "ensure-owner"; readonly candidateOwnerId: string }
  | RepositoryRequestBase & { readonly operation: "verify-domain"; readonly domain: Omit<DockerCacheDomainRow, "authorityEpoch" | "firstVerifiedAt" | "lastVerifiedAt" | "lastState">; readonly candidateAuthorityEpoch: string; readonly verifiedAt: string }
  | RepositoryRequestBase & { readonly operation: "list-domains" }
  | RepositoryRequestBase & { readonly operation: "task-get-indexed"; readonly domainId: string; readonly buildKey: string }
  | RepositoryRequestBase & { readonly operation: "task-mark-unverified"; readonly domainId: string; readonly buildKey: string; readonly generation?: number }
  | RepositoryRequestBase & { readonly operation: "task-publish"; readonly domainId: string; readonly buildKey: string; readonly tag: string; readonly imageId: string; readonly manifestDigest: string; readonly operationId: string; readonly now: string; readonly protectedUntil: string }
  | RepositoryRequestBase & { readonly operation: "task-acquire-use"; readonly domainId: string; readonly buildKey: string; readonly tag: string; readonly imageId: string; readonly manifestDigest: string; readonly leaseId: string; readonly rootId: string; readonly holder: DockerHolderIdentity; readonly now: string }
  | RepositoryRequestBase & { readonly operation: "task-heartbeat"; readonly domainId: string; readonly leaseId: string; readonly heartbeatAt: string }
  | RepositoryRequestBase & { readonly operation: "task-release-use"; readonly domainId: string; readonly leaseId: string; readonly rootId: string }
  | RepositoryRequestBase & { readonly operation: "task-list-entries"; readonly domainId: string; readonly includeTombstoned?: boolean }
  | RepositoryRequestBase & { readonly operation: "task-list-owners"; readonly domainId: string; readonly buildKey?: string }
  | RepositoryRequestBase & { readonly operation: "task-prune-owners"; readonly domainId: string; readonly leaseIds: readonly string[]; readonly rootIds: readonly string[] }
  | RepositoryRequestBase & { readonly operation: "task-read-safety-revision"; readonly domainId: string }
  | RepositoryRequestBase & { readonly operation: "task-save-plan"; readonly domainId: string; readonly planId: string; readonly createdAt: string; readonly expiresAt: string; readonly payload: string; readonly digest: string }
  | RepositoryRequestBase & { readonly operation: "task-get-plan"; readonly domainId: string; readonly planId: string }
  | RepositoryRequestBase & { readonly operation: "task-save-plan-outcome"; readonly domainId: string; readonly planId: string; readonly outcome: string }
  | RepositoryRequestBase & { readonly operation: "task-reserve-delete"; readonly domainId: string; readonly planId: string; readonly entry: DockerTaskBuildEntryRow; readonly evidenceDigest: string; readonly holder: DockerHolderIdentity; readonly createdAt: string }
  | RepositoryRequestBase & { readonly operation: "task-settle-delete"; readonly domainId: string; readonly planId: string; readonly buildKey: string; readonly imageId: string; readonly generation: number; readonly state: "indexed" | "tombstoned" | "unverified" }
  | RepositoryRequestBase & { readonly operation: "task-list-delete-locks"; readonly domainId: string }
  | RepositoryRequestBase & { readonly operation: "task-recover-delete"; readonly domainId: string; readonly lock: DockerImageGcLockRow; readonly buildKey: string; readonly state: "tombstoned" | "unverified" }
  | RepositoryRequestBase & { readonly operation: "setup-startup-snapshot"; readonly domainId: string }
  | RepositoryRequestBase & { readonly operation: "setup-prune-leases"; readonly domainId: string; readonly deleteLeaseIds: readonly string[]; readonly unverifiableLeaseIds: readonly string[] }
  | RepositoryRequestBase & { readonly operation: "setup-startup-isolate"; readonly domainId: string; readonly entryId: string; readonly imageId: string | null }
  | RepositoryRequestBase & { readonly operation: "setup-startup-validate"; readonly domainId: string; readonly entryId: string; readonly valid: boolean }
  | RepositoryRequestBase & { readonly operation: "setup-acquire-indexed"; readonly domainId: string; readonly manifest: DockerSetupPrefixManifestFields; readonly expectedEntryId?: string; readonly leaseId: string; readonly operationId: string; readonly holder: DockerHolderIdentity; readonly now: string; readonly expiresAt: string }
  | RepositoryRequestBase & { readonly operation: "setup-reserve"; readonly domainId: string; readonly manifest: DockerSetupPrefixManifestFields; readonly replacementScope: string; readonly operationId: string; readonly leaseId: string; readonly holder: DockerHolderIdentity; readonly now: string; readonly protectedUntil: string; readonly expiresAt: string }
  | RepositoryRequestBase & { readonly operation: "setup-heartbeat"; readonly domainId: string; readonly leaseId: string; readonly heartbeatAt: string; readonly expiresAt: string }
  | RepositoryRequestBase & { readonly operation: "setup-release-lease"; readonly domainId: string; readonly leaseId: string }
  | RepositoryRequestBase & { readonly operation: "setup-mark-unverified"; readonly domainId: string; readonly entryId: string }
  | RepositoryRequestBase & { readonly operation: "setup-publish-reserve"; readonly domainId: string; readonly entryId: string; readonly operationId: string; readonly generation: number; readonly imageId: string }
  | RepositoryRequestBase & { readonly operation: "setup-publish-settle"; readonly domainId: string; readonly entryId: string; readonly setupPrefixKey: string; readonly imageId: string }
  | RepositoryRequestBase & { readonly operation: "setup-prepare-root"; readonly domainId: string; readonly root: DockerSetupPrefixRootRow }
  | RepositoryRequestBase & { readonly operation: "setup-activate-root"; readonly domainId: string; readonly rootId: string; readonly entryId: string; readonly generation: number; readonly containerId: string }
  | RepositoryRequestBase & { readonly operation: "setup-remove-root"; readonly domainId: string; readonly rootId: string }
  | RepositoryRequestBase & { readonly operation: "setup-begin-root-release"; readonly domainId: string; readonly rootId: string; readonly entryId: string; readonly containerId: string }
  | RepositoryRequestBase & { readonly operation: "setup-finish-root-release"; readonly domainId: string; readonly rootId: string; readonly entryId: string; readonly containerId: string }
  | RepositoryRequestBase & { readonly operation: "setup-mark-used"; readonly domainId: string; readonly entryId: string; readonly generation: number; readonly usedAt: string }
  | RepositoryRequestBase & { readonly operation: "setup-image-claims"; readonly domainId: string; readonly imageId: string; readonly exceptEntryId: string }
  | RepositoryRequestBase & { readonly operation: "setup-list-reclaim-candidates"; readonly domainId: string; readonly replacementScope?: string; readonly exceptEntryId?: string }
  | RepositoryRequestBase & { readonly operation: "setup-reserve-delete"; readonly domainId: string; readonly entryId: string; readonly planId: string; readonly holder: DockerHolderIdentity; readonly createdAt: string }
  | RepositoryRequestBase & { readonly operation: "setup-settle-delete"; readonly domainId: string; readonly entryId: string; readonly imageId: string; readonly generation: number; readonly state: "indexed" | "tombstoned" | "unverified" };

type Result<Operation extends DockerCacheRepositoryRequest["operation"], Value extends object = Record<never, never>> = Readonly<{
  repository: typeof DOCKER_CACHE_REPOSITORY;
  operation: Operation;
} & Value>;

export type DockerCacheRepositoryResult =
  | Result<"ensure-owner", { readonly ownerId: string }>
  | Result<"verify-domain", { readonly domain: DockerCacheDomainRow }>
  | Result<"list-domains", { readonly domains: readonly DockerCacheDomainRow[] }>
  | Result<"task-get-indexed", { readonly entry: DockerTaskBuildEntryRow | null }>
  | Result<"task-mark-unverified" | "task-publish" | "task-heartbeat" | "task-release-use" | "task-prune-owners" | "task-save-plan" | "task-save-plan-outcome" | "task-settle-delete" | "task-recover-delete" | "setup-prune-leases" | "setup-startup-isolate" | "setup-startup-validate" | "setup-release-lease" | "setup-mark-unverified" | "setup-publish-reserve" | "setup-publish-settle" | "setup-prepare-root" | "setup-activate-root" | "setup-remove-root" | "setup-begin-root-release" | "setup-finish-root-release" | "setup-mark-used" | "setup-settle-delete", { readonly changes: number }>
  | Result<"task-acquire-use" | "task-reserve-delete" | "setup-reserve-delete", { readonly reserved: boolean; readonly reason?: string }>
  | Result<"task-list-entries", { readonly entries: readonly DockerTaskBuildEntryRow[] }>
  | Result<"task-list-owners", { readonly leases: readonly DockerTaskBuildLeaseRow[]; readonly roots: readonly DockerTaskBuildRootRow[] }>
  | Result<"task-read-safety-revision", { readonly revision: number }>
  | Result<"task-get-plan", { readonly plan: { readonly expiresAt: string; readonly payload: string; readonly digest: string; readonly outcome: string | null } | null }>
  | Result<"task-list-delete-locks", { readonly locks: readonly DockerImageGcLockRow[] }>
  | Result<"setup-startup-snapshot", { readonly entries: readonly DockerSetupPrefixEntryRow[]; readonly leases: readonly DockerSetupPrefixLeaseRow[]; readonly locks: readonly DockerImageGcLockRow[] }>
  | Result<"setup-acquire-indexed", { readonly entry: DockerSetupPrefixEntryRow | null }>
  | Result<"setup-reserve", { readonly state: "reserved"; readonly entry: DockerSetupPrefixEntryRow } | { readonly state: "contended"; readonly reason: "active-writer" | "indexed-generation" }>
  | Result<"setup-heartbeat", { readonly changes: number }>
  | Result<"setup-image-claims", { readonly gcLocked: boolean; readonly taskBuildClaim: boolean; readonly siblingSetupPrefixClaim: boolean }>
  | Result<"setup-list-reclaim-candidates", { readonly entries: readonly DockerSetupPrefixEntryRow[] }>;

export type DockerCacheResultFor<Request extends DockerCacheRepositoryRequest> =
  DockerCacheRepositoryResult extends infer Candidate
    ? Candidate extends { readonly operation: infer Operation }
      ? Request["operation"] extends Operation ? Candidate : never
      : never
    : never;

const TABLES = Object.freeze({
  domains: "docker_cache_domains",
  metadata: "docker_cache_metadata",
  taskEntries: "docker_task_build_entries",
  taskLeases: "docker_task_build_leases",
  taskRoots: "docker_task_build_roots",
  plans: "docker_cache_gc_plans",
  locks: "docker_image_gc_locks",
  setupEntries: "docker_setup_prefix_entries",
  setupIndex: "docker_setup_prefix_index",
  setupFences: "docker_setup_prefix_generation_fences",
  setupScopes: "docker_setup_prefix_replacement_scopes",
  setupHeads: "docker_setup_prefix_replacement_heads",
  setupLeases: "docker_setup_prefix_leases",
  setupRoots: "docker_setup_prefix_roots",
});

const CREATE_SCHEMA = `
CREATE TABLE ${TABLES.domains} (
  domain_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, daemon_id TEXT NOT NULL, storage_driver TEXT NOT NULL,
  sentinel_id TEXT NOT NULL, backend_identity TEXT NOT NULL, authority_epoch TEXT NOT NULL,
  provider_family TEXT NOT NULL CHECK(provider_family = 'docker'), admin_protocol_version INTEGER NOT NULL CHECK(admin_protocol_version = 1),
  backend_kind TEXT NOT NULL CHECK(backend_kind = 'docker-images'), first_verified_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL, last_state TEXT NOT NULL CHECK(last_state = 'verified-managed')
) STRICT;
CREATE TABLE ${TABLES.metadata} (
  domain_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(domain_id, key)
) STRICT;
CREATE TABLE ${TABLES.taskEntries} (
  domain_id TEXT NOT NULL REFERENCES ${TABLES.domains}(domain_id), build_key TEXT NOT NULL, tag TEXT NOT NULL,
  image_id TEXT NOT NULL, created_at TEXT NOT NULL, last_successful_use_at TEXT, protected_until TEXT NOT NULL,
  manifest_digest TEXT NOT NULL, generation INTEGER NOT NULL, operation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('indexed','deleting','tombstoned','unverified')),
  PRIMARY KEY(domain_id, build_key)
) STRICT;
CREATE TABLE ${TABLES.taskLeases} (
  domain_id TEXT NOT NULL, lease_id TEXT NOT NULL, build_key TEXT NOT NULL, holder_pid INTEGER NOT NULL,
  holder_boot_id TEXT NOT NULL, holder_process_start TEXT NOT NULL, generation INTEGER NOT NULL,
  created_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, PRIMARY KEY(domain_id, lease_id),
  FOREIGN KEY(domain_id, build_key) REFERENCES ${TABLES.taskEntries}(domain_id, build_key)
) STRICT;
CREATE TABLE ${TABLES.taskRoots} (
  domain_id TEXT NOT NULL, root_id TEXT NOT NULL, build_key TEXT NOT NULL, generation INTEGER NOT NULL,
  holder_boot_id TEXT NOT NULL, holder_pid INTEGER NOT NULL, holder_process_start TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','active')), created_at TEXT NOT NULL, PRIMARY KEY(domain_id, root_id),
  FOREIGN KEY(domain_id, build_key) REFERENCES ${TABLES.taskEntries}(domain_id, build_key)
) STRICT;
CREATE TABLE ${TABLES.plans} (
  domain_id TEXT NOT NULL REFERENCES ${TABLES.domains}(domain_id), plan_id TEXT NOT NULL, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, outcome TEXT, PRIMARY KEY(domain_id, plan_id)
) STRICT;
CREATE TABLE ${TABLES.locks} (
  domain_id TEXT NOT NULL REFERENCES ${TABLES.domains}(domain_id), image_id TEXT NOT NULL,
  cache_kind TEXT NOT NULL CHECK(cache_kind IN ('task-build','sandbox-setup-prefix')), plan_id TEXT NOT NULL,
  entry_id TEXT NOT NULL, entry_generation INTEGER NOT NULL, holder_pid INTEGER NOT NULL,
  holder_boot_id TEXT NOT NULL, holder_process_start TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(domain_id, image_id)
) STRICT;
CREATE TABLE ${TABLES.setupEntries} (
  domain_id TEXT NOT NULL REFERENCES ${TABLES.domains}(domain_id), entry_id TEXT NOT NULL, setup_prefix_key TEXT NOT NULL,
  base_image_id TEXT NOT NULL, image_id TEXT, declaration_json TEXT NOT NULL, declaration_digest TEXT NOT NULL,
  setup_manifest_digest TEXT NOT NULL, storage_schema_revision TEXT NOT NULL, artifact_format_revision TEXT NOT NULL,
  dependency TEXT NOT NULL CHECK(dependency = 'parent-backed'), change_frequency REAL NOT NULL, generation INTEGER NOT NULL,
  operation_id TEXT NOT NULL, created_at TEXT NOT NULL, last_successful_use_at TEXT, protected_until TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','building','published','indexed','invalidated','deleting','tombstoned','unverified')),
  PRIMARY KEY(domain_id, entry_id), UNIQUE(domain_id, setup_prefix_key, generation)
) STRICT;
CREATE UNIQUE INDEX docker_setup_prefix_writer ON ${TABLES.setupEntries}(domain_id, setup_prefix_key)
  WHERE state IN ('reserved','building','published','deleting');
CREATE TABLE ${TABLES.setupIndex} (
  domain_id TEXT NOT NULL, setup_prefix_key TEXT NOT NULL, entry_id TEXT NOT NULL,
  PRIMARY KEY(domain_id, setup_prefix_key), UNIQUE(domain_id, entry_id),
  FOREIGN KEY(domain_id, entry_id) REFERENCES ${TABLES.setupEntries}(domain_id, entry_id)
) STRICT;
CREATE TABLE ${TABLES.setupFences} (
  domain_id TEXT NOT NULL REFERENCES ${TABLES.domains}(domain_id), setup_prefix_key TEXT NOT NULL,
  next_generation INTEGER NOT NULL, PRIMARY KEY(domain_id, setup_prefix_key)
) STRICT;
CREATE TABLE ${TABLES.setupScopes} (
  domain_id TEXT NOT NULL, entry_id TEXT NOT NULL, replacement_scope TEXT NOT NULL, PRIMARY KEY(domain_id, entry_id),
  FOREIGN KEY(domain_id, entry_id) REFERENCES ${TABLES.setupEntries}(domain_id, entry_id)
) STRICT;
CREATE INDEX docker_setup_prefix_replacement_scope ON ${TABLES.setupScopes}(domain_id, replacement_scope);
CREATE TABLE ${TABLES.setupHeads} (
  domain_id TEXT NOT NULL, replacement_scope TEXT NOT NULL, entry_id TEXT NOT NULL,
  PRIMARY KEY(domain_id, replacement_scope),
  FOREIGN KEY(domain_id, entry_id) REFERENCES ${TABLES.setupEntries}(domain_id, entry_id)
) STRICT;
CREATE TABLE ${TABLES.setupLeases} (
  domain_id TEXT NOT NULL, lease_id TEXT NOT NULL, entry_id TEXT NOT NULL, setup_prefix_key TEXT NOT NULL,
  generation INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('build','read','handoff')), operation_id TEXT NOT NULL,
  holder_host_id TEXT NOT NULL, holder_boot_id TEXT NOT NULL, holder_pid INTEGER NOT NULL,
  holder_process_start TEXT NOT NULL, heartbeat_sequence INTEGER NOT NULL, heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','released','expired-unverified','ended')),
  PRIMARY KEY(domain_id, lease_id), FOREIGN KEY(domain_id, entry_id) REFERENCES ${TABLES.setupEntries}(domain_id, entry_id)
) STRICT;
CREATE TABLE ${TABLES.setupRoots} (
  domain_id TEXT NOT NULL, root_id TEXT NOT NULL, entry_id TEXT NOT NULL, setup_prefix_key TEXT NOT NULL,
  generation INTEGER NOT NULL, sandbox_id TEXT NOT NULL, sandbox_resource_identity TEXT NOT NULL,
  operation_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','active','releasing')),
  created_at TEXT NOT NULL, PRIMARY KEY(domain_id, root_id),
  FOREIGN KEY(domain_id, entry_id) REFERENCES ${TABLES.setupEntries}(domain_id, entry_id)
) STRICT;
CREATE TRIGGER docker_setup_prefix_exact_base_insert BEFORE INSERT ON ${TABLES.setupEntries}
WHEN length(NEW.base_image_id) != 71 OR substr(NEW.base_image_id, 1, 7) != 'sha256:' OR substr(NEW.base_image_id, 8) GLOB '*[^0-9a-f]*'
BEGIN SELECT RAISE(ABORT, 'setup-prefix exact Base identity is required'); END;
CREATE TRIGGER docker_setup_prefix_exact_base_update BEFORE UPDATE OF base_image_id ON ${TABLES.setupEntries}
WHEN length(NEW.base_image_id) != 71 OR substr(NEW.base_image_id, 1, 7) != 'sha256:' OR substr(NEW.base_image_id, 8) GLOB '*[^0-9a-f]*'
BEGIN SELECT RAISE(ABORT, 'setup-prefix exact Base identity is required'); END;
`;

interface SchemaObject {
  readonly type: string;
  readonly name: string;
  readonly table: string;
  readonly sql: string | null;
}

let canonicalRevisionOneSchema: readonly SchemaObject[] | undefined;

function normalizeSchemaSql(sql: string): string {
  return sql.trim().replace(/;+$/u, "").replace(/\s+/gu, " ");
}

function readSchemaObjects(database: DatabaseSync): readonly SchemaObject[] {
  return Object.freeze(database.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name, tbl_name",
  ).all().map((row) => {
    const value = record(row, "schema object");
    const sql = value.sql;
    if (sql !== null && typeof sql !== "string") throw invalid("docker-cache schema object SQL is invalid");
    return Object.freeze({
      type: exactString(value.type, "schema object type"),
      name: exactString(value.name, "schema object name"),
      table: exactString(value.tbl_name, "schema object table"),
      sql: sql === null ? null : normalizeSchemaSql(sql),
    });
  }));
}

function canonicalSchemaForRevisionOne(): readonly SchemaObject[] {
  if (canonicalRevisionOneSchema !== undefined) return canonicalRevisionOneSchema;
  const database = new DatabaseSync(":memory:", {
    allowExtension: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    database.enableLoadExtension(false);
    database.enableDefensive(true);
    database.exec(CREATE_SCHEMA);
    canonicalRevisionOneSchema = readSchemaObjects(database);
    return canonicalRevisionOneSchema;
  } finally {
    database.close();
  }
}

function schemaObjectIdentity(object: SchemaObject): string {
  return JSON.stringify([object.type, object.name, object.table, object.sql]);
}

function invalid(message: string, cause?: unknown): UserDatabaseInvalid {
  return new UserDatabaseInvalid({ code: "user-database-invalid", message, repository: DOCKER_CACHE_REPOSITORY, cause });
}

function exactInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw invalid(`docker-cache ${field} is not a safe integer`);
  return Number(value);
}

function exactString(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalid(`docker-cache ${field} is not a string`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return exactString(value, field);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`docker-cache ${label} is not an object`);
  return value as Record<string, unknown>;
}

function taskEntry(row: unknown): DockerTaskBuildEntryRow {
  const value = record(row, "task-build row");
  const state = exactString(value.state, "task-build state");
  if (!["indexed", "deleting", "tombstoned", "unverified"].includes(state)) throw invalid(`docker-cache task-build state ${state} is invalid`);
  return Object.freeze({
    buildKey: exactString(value.build_key, "build_key"), tag: exactString(value.tag, "tag"),
    imageId: exactString(value.image_id, "image_id"), createdAt: exactString(value.created_at, "created_at"),
    lastSuccessfulUseAt: nullableString(value.last_successful_use_at, "last_successful_use_at"),
    protectedUntil: exactString(value.protected_until, "protected_until"),
    manifestDigest: exactString(value.manifest_digest, "manifest_digest"), generation: exactInteger(value.generation, "generation"),
    operationId: exactString(value.operation_id, "operation_id"), state: state as DockerCacheEntryState,
  });
}

function setupEntry(row: unknown): DockerSetupPrefixEntryRow {
  const value = record(row, "setup-prefix row");
  const state = exactString(value.state, "setup-prefix state") as DockerSetupPrefixEntryState;
  if (!["reserved", "building", "published", "indexed", "invalidated", "deleting", "tombstoned", "unverified"].includes(state)) {
    throw invalid(`docker-cache setup-prefix state ${state} is invalid`);
  }
  const dependency = exactString(value.dependency, "dependency");
  if (dependency !== "parent-backed") throw invalid(`docker-cache setup-prefix dependency ${dependency} is invalid`);
  const changeFrequency = value.change_frequency;
  if (typeof changeFrequency !== "number" || !Number.isFinite(changeFrequency) || changeFrequency < 0) {
    throw invalid("docker-cache change_frequency is invalid");
  }
  return Object.freeze({
    entryId: exactString(value.entry_id, "entry_id"), setupPrefixKey: exactString(value.setup_prefix_key, "setup_prefix_key"),
    baseImageId: exactString(value.base_image_id, "base_image_id"), imageId: nullableString(value.image_id, "image_id"),
    declarationJson: exactString(value.declaration_json, "declaration_json"), declarationDigest: exactString(value.declaration_digest, "declaration_digest"),
    setupManifestDigest: exactString(value.setup_manifest_digest, "setup_manifest_digest"),
    storageSchemaRevision: exactString(value.storage_schema_revision, "storage_schema_revision"),
    artifactFormatRevision: exactString(value.artifact_format_revision, "artifact_format_revision"),
    dependency, changeFrequency, generation: exactInteger(value.generation, "generation"),
    operationId: exactString(value.operation_id, "operation_id"), createdAt: exactString(value.created_at, "created_at"),
    lastSuccessfulUseAt: nullableString(value.last_successful_use_at, "last_successful_use_at"),
    protectedUntil: exactString(value.protected_until, "protected_until"), state,
  });
}

function taskLease(row: unknown): DockerTaskBuildLeaseRow {
  const value = record(row, "task-build lease");
  return Object.freeze({
    leaseId: exactString(value.lease_id, "lease_id"), buildKey: exactString(value.build_key, "build_key"),
    holderPid: exactInteger(value.holder_pid, "holder_pid"), holderBootId: exactString(value.holder_boot_id, "holder_boot_id"),
    holderProcessStart: exactString(value.holder_process_start, "holder_process_start"), generation: exactInteger(value.generation, "generation"),
    createdAt: exactString(value.created_at, "created_at"), heartbeatAt: exactString(value.heartbeat_at, "heartbeat_at"),
  });
}

function taskRoot(row: unknown): DockerTaskBuildRootRow {
  const value = record(row, "task-build root");
  const state = exactString(value.state, "root state");
  if (state !== "prepared" && state !== "active") throw invalid(`docker-cache task root state ${state} is invalid`);
  return Object.freeze({
    rootId: exactString(value.root_id, "root_id"), buildKey: exactString(value.build_key, "build_key"),
    holderPid: exactInteger(value.holder_pid, "holder_pid"), holderBootId: exactString(value.holder_boot_id, "holder_boot_id"),
    holderProcessStart: exactString(value.holder_process_start, "holder_process_start"), generation: exactInteger(value.generation, "generation"),
    state, createdAt: exactString(value.created_at, "created_at"),
  });
}

function setupLease(row: unknown): DockerSetupPrefixLeaseRow {
  const value = record(row, "setup-prefix lease");
  const kind = exactString(value.kind, "kind");
  if (kind !== "build" && kind !== "read" && kind !== "handoff") throw invalid(`docker-cache setup-prefix lease kind ${kind} is invalid`);
  const state = exactString(value.state, "state");
  if (state !== "active" && state !== "released" && state !== "expired-unverified" && state !== "ended") {
    throw invalid(`docker-cache setup-prefix lease state ${state} is invalid`);
  }
  return Object.freeze({
    leaseId: exactString(value.lease_id, "lease_id"), entryId: exactString(value.entry_id, "entry_id"),
    setupPrefixKey: exactString(value.setup_prefix_key, "setup_prefix_key"), generation: exactInteger(value.generation, "generation"),
    kind, operationId: exactString(value.operation_id, "operation_id"),
    holderHostId: exactString(value.holder_host_id, "holder_host_id"), holderBootId: exactString(value.holder_boot_id, "holder_boot_id"),
    holderPid: exactInteger(value.holder_pid, "holder_pid"), holderProcessStart: exactString(value.holder_process_start, "holder_process_start"),
    heartbeatSequence: exactInteger(value.heartbeat_sequence, "heartbeat_sequence"), heartbeatAt: exactString(value.heartbeat_at, "heartbeat_at"),
    expiresAt: exactString(value.expires_at, "expires_at"), state,
  });
}

function gcLock(row: unknown): DockerImageGcLockRow {
  const value = record(row, "GC lock");
  const cacheKind = exactString(value.cache_kind, "cache_kind");
  if (cacheKind !== "task-build" && cacheKind !== "sandbox-setup-prefix") throw invalid(`docker-cache kind ${cacheKind} is invalid`);
  return Object.freeze({
    imageId: exactString(value.image_id, "image_id"), cacheKind, planId: exactString(value.plan_id, "plan_id"),
    entryId: exactString(value.entry_id, "entry_id"), entryGeneration: exactInteger(value.entry_generation, "entry_generation"),
    holderPid: exactInteger(value.holder_pid, "holder_pid"), holderBootId: exactString(value.holder_boot_id, "holder_boot_id"),
    holderProcessStart: exactString(value.holder_process_start, "holder_process_start"), createdAt: exactString(value.created_at, "created_at"),
  });
}

function transaction<A>(database: DatabaseSync, run: () => A): A {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw cause;
  }
}

function bump(database: DatabaseSync, domainId: string, key: "taskSafetyRevision" | "setupPrefixSafetyRevision"): void {
  const changed = database.prepare(`UPDATE ${TABLES.metadata} SET value = CAST(value AS INTEGER) + 1 WHERE domain_id = ? AND key = ?`)
    .run(domainId, key);
  if (changed.changes !== 1) throw invalid(`docker-cache ${key} is missing`);
}

function manifestMatches(row: DockerSetupPrefixEntryRow, manifest: DockerSetupPrefixManifestFields): boolean {
  return row.setupPrefixKey === manifest.setupPrefixKey && row.baseImageId === manifest.baseImageId &&
    row.declarationJson === manifest.declarationJson && row.declarationDigest === manifest.declarationDigest &&
    row.setupManifestDigest === manifest.setupManifestDigest && row.storageSchemaRevision === manifest.storageSchemaRevision &&
    row.artifactFormatRevision === manifest.artifactFormatRevision && row.changeFrequency === manifest.changeFrequency &&
    row.dependency === "parent-backed";
}

function changes(value: number | bigint): number {
  return exactInteger(Number(value), "change count");
}

function assertCurrentSchema(database: DatabaseSync): void {
  const expected = canonicalSchemaForRevisionOne();
  const expectedNames = new Set(expected.map((object) => object.name));
  const expectedTables = new Set(expected.filter((object) => object.type === "table").map((object) => object.table));
  const actual = readSchemaObjects(database).filter((object) =>
    expectedNames.has(object.name) || expectedTables.has(object.table));
  if (actual.length !== expected.length || actual.some((object, index) =>
    schemaObjectIdentity(object) !== schemaObjectIdentity(expected[index]!))) {
    throw invalid(`docker-cache schema does not match revision ${DOCKER_CACHE_REPOSITORY_REVISION}`);
  }
}

function migrateAdjacent(database: DatabaseSync, fromRevision: number): number {
  if (fromRevision !== 0) throw invalid(`docker-cache has no migration from revision ${fromRevision}`);
  database.exec(CREATE_SCHEMA);
  assertCurrentSchema(database);
  return DOCKER_CACHE_REPOSITORY_REVISION;
}

function domainRow(row: unknown): DockerCacheDomainRow {
  const value = record(row, "domain row");
  return Object.freeze({
    domainId: exactString(value.domain_id, "domain_id"), ownerId: exactString(value.owner_id, "owner_id"),
    daemonId: exactString(value.daemon_id, "daemon_id"), storageDriver: exactString(value.storage_driver, "storage_driver"),
    sentinelId: exactString(value.sentinel_id, "sentinel_id"), backendIdentity: exactString(value.backend_identity, "backend_identity"),
    authorityEpoch: exactString(value.authority_epoch, "authority_epoch"), providerFamily: "docker", adminProtocolVersion: 1,
    backendKind: "docker-images", firstVerifiedAt: exactString(value.first_verified_at, "first_verified_at"),
    lastVerifiedAt: exactString(value.last_verified_at, "last_verified_at"), lastState: "verified-managed",
  });
}

function dispatch(database: DatabaseSync, request: DockerCacheRepositoryRequest): DockerCacheRepositoryResult {
  const result = <Operation extends DockerCacheRepositoryRequest["operation"], Value extends object>(operation: Operation, value: Value) =>
    Object.freeze({ repository: DOCKER_CACHE_REPOSITORY, operation, ...value }) as Result<Operation, Value>;

  switch (request.operation) {
    case "ensure-owner": {
      const ownerId = transaction(database, () => {
        database.prepare(`INSERT OR IGNORE INTO ${TABLES.metadata}(domain_id, key, value) VALUES ('repository', 'ownerId', ?)`)
          .run(request.candidateOwnerId);
        const row = database.prepare(`SELECT value FROM ${TABLES.metadata} WHERE domain_id = 'repository' AND key = 'ownerId'`).get();
        return exactString(record(row, "owner row").value, "ownerId");
      });
      return result(request.operation, { ownerId });
    }
    case "verify-domain": {
      const row = transaction(database, () => {
        database.prepare(`
          INSERT INTO ${TABLES.domains}(
            domain_id, owner_id, daemon_id, storage_driver, sentinel_id, backend_identity, authority_epoch,
            provider_family, admin_protocol_version, backend_kind, first_verified_at, last_verified_at, last_state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'docker', 1, 'docker-images', ?, ?, 'verified-managed')
          ON CONFLICT(domain_id) DO UPDATE SET
            last_verified_at=excluded.last_verified_at, last_state='verified-managed'
          WHERE owner_id=excluded.owner_id AND daemon_id=excluded.daemon_id AND storage_driver=excluded.storage_driver
            AND sentinel_id=excluded.sentinel_id AND backend_identity=excluded.backend_identity
        `).run(
          request.domain.domainId, request.domain.ownerId, request.domain.daemonId, request.domain.storageDriver,
          request.domain.sentinelId, request.domain.backendIdentity, request.candidateAuthorityEpoch,
          request.verifiedAt, request.verifiedAt,
        );
        const stored = database.prepare(`SELECT * FROM ${TABLES.domains} WHERE domain_id = ?`).get(request.domain.domainId);
        const decoded = domainRow(stored);
        if (decoded.ownerId !== request.domain.ownerId || decoded.backendIdentity !== request.domain.backendIdentity) {
          throw invalid(`docker-cache domain identity collision for ${request.domain.domainId}`);
        }
        database.prepare(`INSERT OR IGNORE INTO ${TABLES.metadata}(domain_id, key, value) VALUES (?, 'taskSafetyRevision', '1')`)
          .run(request.domain.domainId);
        database.prepare(`INSERT OR IGNORE INTO ${TABLES.metadata}(domain_id, key, value) VALUES (?, 'setupPrefixSafetyRevision', '1')`)
          .run(request.domain.domainId);
        return decoded;
      });
      return result(request.operation, { domain: row });
    }
    case "list-domains":
      return result(request.operation, {
        domains: Object.freeze(database.prepare(`SELECT * FROM ${TABLES.domains} ORDER BY first_verified_at, domain_id`).all().map(domainRow)),
      });
    case "task-get-indexed": {
      const row = database.prepare(`SELECT * FROM ${TABLES.taskEntries} WHERE domain_id = ? AND build_key = ? AND state = 'indexed'`)
        .get(request.domainId, request.buildKey);
      return result(request.operation, { entry: row === undefined ? null : taskEntry(row) });
    }
    case "task-mark-unverified": {
      const receipt = database.prepare(`UPDATE ${TABLES.taskEntries} SET state = 'unverified' WHERE domain_id = ? AND build_key = ? AND state != 'tombstoned' AND (? IS NULL OR generation = ?)`)
        .run(request.domainId, request.buildKey, request.generation ?? null, request.generation ?? null);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "task-publish": {
      const count = transaction(database, () => {
        const lock = database.prepare(`SELECT cache_kind, plan_id FROM ${TABLES.locks} WHERE domain_id = ? AND image_id = ?`)
          .get(request.domainId, request.imageId);
        if (lock !== undefined) {
          const value = record(lock, "GC lock");
          throw invalid(`built image is fenced by ${exactString(value.cache_kind, "cache_kind")} GC plan ${exactString(value.plan_id, "plan_id")}`);
        }
        const receipt = database.prepare(`
          INSERT INTO ${TABLES.taskEntries}(
            domain_id, build_key, tag, image_id, created_at, last_successful_use_at, protected_until,
            manifest_digest, generation, operation_id, state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'indexed')
          ON CONFLICT(domain_id, build_key) DO UPDATE SET
            tag=excluded.tag, image_id=excluded.image_id, created_at=excluded.created_at,
            last_successful_use_at=excluded.last_successful_use_at, protected_until=excluded.protected_until,
            manifest_digest=excluded.manifest_digest,
            generation=CASE WHEN ${TABLES.taskEntries}.operation_id=excluded.operation_id THEN ${TABLES.taskEntries}.generation ELSE ${TABLES.taskEntries}.generation+1 END,
            operation_id=excluded.operation_id, state='indexed'
        `).run(
          request.domainId, request.buildKey, request.tag, request.imageId, request.now, request.now,
          request.protectedUntil, request.manifestDigest, request.operationId,
        );
        bump(database, request.domainId, "taskSafetyRevision");
        return changes(receipt.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "task-acquire-use": {
      const reserved = transaction(database, () => {
        const row = database.prepare(`SELECT * FROM ${TABLES.taskEntries} WHERE domain_id = ? AND build_key = ? AND state = 'indexed'`)
          .get(request.domainId, request.buildKey);
        if (row === undefined) return false;
        const entry = taskEntry(row);
        if (entry.tag !== request.tag || entry.imageId !== request.imageId || entry.manifestDigest !== request.manifestDigest) return false;
        database.prepare(`INSERT INTO ${TABLES.taskLeases}(
          domain_id, lease_id, build_key, holder_pid, holder_boot_id, holder_process_start, generation, created_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(request.domainId, request.leaseId, request.buildKey, request.holder.pid, request.holder.bootId, request.holder.processStart, entry.generation, request.now, request.now);
        database.prepare(`INSERT INTO ${TABLES.taskRoots}(
          domain_id, root_id, build_key, generation, holder_boot_id, holder_pid, holder_process_start, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
          .run(request.domainId, request.rootId, request.buildKey, entry.generation, request.holder.bootId, request.holder.pid, request.holder.processStart, request.now);
        database.prepare(`UPDATE ${TABLES.taskEntries} SET last_successful_use_at = ? WHERE domain_id = ? AND build_key = ?`)
          .run(request.now, request.domainId, request.buildKey);
        return true;
      });
      return result(request.operation, reserved ? { reserved } : { reserved, reason: "entry-changed" });
    }
    case "task-heartbeat": {
      const receipt = database.prepare(`UPDATE ${TABLES.taskLeases} SET heartbeat_at = ? WHERE domain_id = ? AND lease_id = ?`)
        .run(request.heartbeatAt, request.domainId, request.leaseId);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "task-release-use": {
      const count = transaction(database, () => {
        const root = database.prepare(`DELETE FROM ${TABLES.taskRoots} WHERE domain_id = ? AND root_id = ?`).run(request.domainId, request.rootId);
        const lease = database.prepare(`DELETE FROM ${TABLES.taskLeases} WHERE domain_id = ? AND lease_id = ?`).run(request.domainId, request.leaseId);
        return changes(root.changes) + changes(lease.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "task-list-entries": {
      const where = request.includeTombstoned === true ? "" : "AND state != 'tombstoned'";
      const entries = database.prepare(`SELECT * FROM ${TABLES.taskEntries} WHERE domain_id = ? ${where} ORDER BY COALESCE(last_successful_use_at, created_at), created_at, build_key`)
        .all(request.domainId).map(taskEntry);
      return result(request.operation, { entries: Object.freeze(entries) });
    }
    case "task-list-owners": {
      const suffix = request.buildKey === undefined ? "" : "AND build_key = ?";
      const args = request.buildKey === undefined ? [request.domainId] : [request.domainId, request.buildKey];
      return result(request.operation, {
        leases: Object.freeze(database.prepare(`SELECT * FROM ${TABLES.taskLeases} WHERE domain_id = ? ${suffix} ORDER BY lease_id`).all(...args).map(taskLease)),
        roots: Object.freeze(database.prepare(`SELECT * FROM ${TABLES.taskRoots} WHERE domain_id = ? ${suffix} ORDER BY root_id`).all(...args).map(taskRoot)),
      });
    }
    case "task-prune-owners": {
      const count = transaction(database, () => {
        let removed = 0;
        for (const leaseId of request.leaseIds) removed += changes(database.prepare(`DELETE FROM ${TABLES.taskLeases} WHERE domain_id = ? AND lease_id = ?`).run(request.domainId, leaseId).changes);
        for (const rootId of request.rootIds) removed += changes(database.prepare(`DELETE FROM ${TABLES.taskRoots} WHERE domain_id = ? AND root_id = ?`).run(request.domainId, rootId).changes);
        return removed;
      });
      return result(request.operation, { changes: count });
    }
    case "task-read-safety-revision": {
      const row = database.prepare(`SELECT value FROM ${TABLES.metadata} WHERE domain_id = ? AND key = 'taskSafetyRevision'`).get(request.domainId);
      return result(request.operation, { revision: exactInteger(Number(exactString(record(row, "revision row").value, "revision")), "revision") });
    }
    case "task-save-plan": {
      const receipt = database.prepare(`INSERT INTO ${TABLES.plans}(domain_id, plan_id, created_at, expires_at, payload, digest) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(request.domainId, request.planId, request.createdAt, request.expiresAt, request.payload, request.digest);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "task-get-plan": {
      const row = database.prepare(`SELECT expires_at, payload, digest, outcome FROM ${TABLES.plans} WHERE domain_id = ? AND plan_id = ?`)
        .get(request.domainId, request.planId);
      if (row === undefined) return result(request.operation, { plan: null });
      const value = record(row, "GC plan");
      return result(request.operation, { plan: Object.freeze({
        expiresAt: exactString(value.expires_at, "expires_at"), payload: exactString(value.payload, "payload"),
        digest: exactString(value.digest, "digest"), outcome: nullableString(value.outcome, "outcome"),
      }) });
    }
    case "task-save-plan-outcome": {
      const receipt = database.prepare(`UPDATE ${TABLES.plans} SET outcome = ? WHERE domain_id = ? AND plan_id = ? AND outcome IS NULL`)
        .run(request.outcome, request.domainId, request.planId);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "task-reserve-delete": {
      const outcome = transaction(database, () => {
        const row = database.prepare(`SELECT * FROM ${TABLES.taskEntries} WHERE domain_id = ? AND build_key = ?`).get(request.domainId, request.entry.buildKey);
        if (row === undefined) return { reserved: false, reason: "entry-missing" } as const;
        const entry = taskEntry(row);
        if (entry.state !== "indexed" || JSON.stringify(entry) !== JSON.stringify(request.entry)) return { reserved: false, reason: "entry-changed" } as const;
        const lease = database.prepare(`SELECT 1 FROM ${TABLES.taskLeases} WHERE domain_id = ? AND build_key = ? LIMIT 1`).get(request.domainId, entry.buildKey);
        const root = database.prepare(`SELECT 1 FROM ${TABLES.taskRoots} WHERE domain_id = ? AND build_key = ? LIMIT 1`).get(request.domainId, entry.buildKey);
        const setupClaim = database.prepare(`SELECT 1 FROM ${TABLES.setupEntries} WHERE domain_id = ? AND image_id = ? AND state != 'tombstoned' LIMIT 1`).get(request.domainId, entry.imageId);
        if (lease !== undefined || root !== undefined || setupClaim !== undefined) return { reserved: false, reason: "entry-lease-root-or-cross-kind-claim" } as const;
        const lock = database.prepare(`SELECT 1 FROM ${TABLES.locks} WHERE domain_id = ? AND image_id = ?`).get(request.domainId, entry.imageId);
        if (lock !== undefined) return { reserved: false, reason: "active-delete-conflict" } as const;
        database.prepare(`INSERT INTO ${TABLES.locks}(
          domain_id, image_id, cache_kind, plan_id, entry_id, entry_generation,
          holder_pid, holder_boot_id, holder_process_start, created_at
        ) VALUES (?, ?, 'task-build', ?, ?, ?, ?, ?, ?, ?)`)
          .run(request.domainId, entry.imageId, request.planId, `task-build:${entry.buildKey}`, entry.generation, request.holder.pid, request.holder.bootId, request.holder.processStart, request.createdAt);
        const marked = database.prepare(`UPDATE ${TABLES.taskEntries} SET state = 'deleting' WHERE domain_id = ? AND build_key = ? AND generation = ? AND state = 'indexed'`)
          .run(request.domainId, entry.buildKey, entry.generation);
        if (marked.changes !== 1) throw invalid("task-build generation changed before deleting transition");
        return { reserved: true } as const;
      });
      return result(request.operation, outcome);
    }
    case "task-settle-delete": {
      const count = transaction(database, () => {
        const updated = database.prepare(`UPDATE ${TABLES.taskEntries} SET state = ? WHERE domain_id = ? AND build_key = ? AND generation = ? AND image_id = ? AND state = 'deleting'`)
          .run(request.state, request.domainId, request.buildKey, request.generation, request.imageId);
        database.prepare(`DELETE FROM ${TABLES.locks} WHERE domain_id = ? AND image_id = ? AND cache_kind = 'task-build' AND plan_id = ?`)
          .run(request.domainId, request.imageId, request.planId);
        bump(database, request.domainId, "taskSafetyRevision");
        return changes(updated.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "task-list-delete-locks":
      return result(request.operation, {
        locks: Object.freeze(database.prepare(`SELECT * FROM ${TABLES.locks} WHERE domain_id = ? AND cache_kind = 'task-build' ORDER BY created_at, image_id LIMIT 128`).all(request.domainId).map(gcLock)),
      });
    case "task-recover-delete": {
      const count = transaction(database, () => {
        const updated = database.prepare(`UPDATE ${TABLES.taskEntries} SET state = ? WHERE domain_id = ? AND build_key = ? AND generation = ? AND image_id = ? AND state = 'deleting'`)
          .run(request.state, request.domainId, request.buildKey, request.lock.entryGeneration, request.lock.imageId);
        database.prepare(`DELETE FROM ${TABLES.locks} WHERE domain_id = ? AND image_id = ? AND cache_kind = 'task-build' AND plan_id = ? AND entry_id = ? AND entry_generation = ?`)
          .run(request.domainId, request.lock.imageId, request.lock.planId, request.lock.entryId, request.lock.entryGeneration);
        bump(database, request.domainId, "taskSafetyRevision");
        return changes(updated.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "setup-startup-snapshot":
      return result(request.operation, {
        entries: Object.freeze(database.prepare(`SELECT * FROM ${TABLES.setupEntries} WHERE domain_id = ? AND state IN ('reserved','building','published','indexed','deleting') ORDER BY setup_prefix_key, generation`).all(request.domainId).map(setupEntry)),
        leases: Object.freeze(database.prepare(`SELECT * FROM ${TABLES.setupLeases} WHERE domain_id = ? AND state IN ('active','expired-unverified') ORDER BY lease_id`).all(request.domainId).map(setupLease)),
        locks: Object.freeze(database.prepare(`SELECT * FROM ${TABLES.locks} WHERE domain_id = ? AND cache_kind = 'sandbox-setup-prefix' ORDER BY created_at, image_id LIMIT 128`).all(request.domainId).map(gcLock)),
      });
    case "setup-prune-leases": {
      const count = transaction(database, () => {
        let changed = 0;
        for (const leaseId of request.deleteLeaseIds) changed += changes(database.prepare(`DELETE FROM ${TABLES.setupLeases} WHERE domain_id = ? AND lease_id = ?`).run(request.domainId, leaseId).changes);
        for (const leaseId of request.unverifiableLeaseIds) changed += changes(database.prepare(`UPDATE ${TABLES.setupLeases} SET state = 'expired-unverified' WHERE domain_id = ? AND lease_id = ? AND state = 'active'`).run(request.domainId, leaseId).changes);
        return changed;
      });
      return result(request.operation, { changes: count });
    }
    case "setup-startup-isolate": {
      const count = transaction(database, () => {
        database.prepare(`DELETE FROM ${TABLES.setupIndex} WHERE domain_id = ? AND entry_id = ?`).run(request.domainId, request.entryId);
        const updated = database.prepare(`UPDATE ${TABLES.setupEntries} SET image_id = ?, state = 'unverified' WHERE domain_id = ? AND entry_id = ? AND state IN ('reserved','building')`)
          .run(request.imageId, request.domainId, request.entryId);
        bump(database, request.domainId, "setupPrefixSafetyRevision");
        return changes(updated.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "setup-startup-validate": {
      const count = transaction(database, () => {
        const found = database.prepare(`SELECT * FROM ${TABLES.setupEntries} WHERE domain_id = ? AND entry_id = ?`).get(request.domainId, request.entryId);
        if (found === undefined) return 0;
        const entry = setupEntry(found);
        if (!request.valid) {
          database.prepare(`DELETE FROM ${TABLES.setupIndex} WHERE domain_id = ? AND entry_id = ?`).run(request.domainId, entry.entryId);
          return changes(database.prepare(`UPDATE ${TABLES.setupEntries} SET state = 'unverified' WHERE domain_id = ? AND entry_id = ?`).run(request.domainId, entry.entryId).changes);
        }
        if (entry.state === "published") {
          const active = database.prepare(`SELECT entry_id FROM ${TABLES.setupIndex} WHERE domain_id = ? AND setup_prefix_key = ?`).get(request.domainId, entry.setupPrefixKey);
          if (active === undefined || exactString(record(active, "setup index").entry_id, "entry_id") === entry.entryId) {
            database.prepare(`INSERT OR IGNORE INTO ${TABLES.setupIndex}(domain_id, setup_prefix_key, entry_id) VALUES (?, ?, ?)`).run(request.domainId, entry.setupPrefixKey, entry.entryId);
            return changes(database.prepare(`UPDATE ${TABLES.setupEntries} SET state = 'indexed' WHERE domain_id = ? AND entry_id = ? AND state = 'published'`).run(request.domainId, entry.entryId).changes);
          }
        }
        const active = database.prepare(`SELECT entry_id FROM ${TABLES.setupIndex} WHERE domain_id = ? AND setup_prefix_key = ?`).get(request.domainId, entry.setupPrefixKey);
        if (active === undefined || exactString(record(active, "setup index").entry_id, "entry_id") !== entry.entryId) {
          return changes(database.prepare(`UPDATE ${TABLES.setupEntries} SET state = 'unverified' WHERE domain_id = ? AND entry_id = ?`).run(request.domainId, entry.entryId).changes);
        }
        return 0;
      });
      return result(request.operation, { changes: count });
    }
    case "setup-acquire-indexed": {
      const entry = transaction(database, () => {
        const found = database.prepare(`SELECT entry.* FROM ${TABLES.setupIndex} active JOIN ${TABLES.setupEntries} entry ON entry.domain_id=active.domain_id AND entry.entry_id=active.entry_id WHERE active.domain_id=? AND active.setup_prefix_key=?`)
          .get(request.domainId, request.manifest.setupPrefixKey);
        if (found === undefined) return null;
        const row = setupEntry(found);
        if (row.state !== "indexed" || (request.expectedEntryId !== undefined && row.entryId !== request.expectedEntryId) || !manifestMatches(row, request.manifest)) return null;
        database.prepare(`INSERT INTO ${TABLES.setupLeases}(
          domain_id, lease_id, entry_id, setup_prefix_key, generation, kind, operation_id,
          holder_host_id, holder_boot_id, holder_pid, holder_process_start,
          heartbeat_sequence, heartbeat_at, expires_at, state
        ) VALUES (?, ?, ?, ?, ?, 'handoff', ?, ?, ?, ?, ?, 0, ?, ?, 'active')`)
          .run(request.domainId, request.leaseId, row.entryId, row.setupPrefixKey, row.generation, request.operationId, request.holder.hostId, request.holder.bootId, request.holder.pid, request.holder.processStart, request.now, request.expiresAt);
        return row;
      });
      return result(request.operation, { entry });
    }
    case "setup-reserve": {
      const reserved = transaction(database, () => {
        const indexedRow = database.prepare(`SELECT entry.* FROM ${TABLES.setupIndex} active JOIN ${TABLES.setupEntries} entry ON entry.domain_id=active.domain_id AND entry.entry_id=active.entry_id WHERE active.domain_id=? AND active.setup_prefix_key=?`)
          .get(request.domainId, request.manifest.setupPrefixKey);
        if (indexedRow !== undefined) {
          if (!manifestMatches(setupEntry(indexedRow), request.manifest)) throw invalid("indexed setup-prefix generation does not match requested manifest");
          return { state: "contended", reason: "indexed-generation" } as const;
        }
        const writerRow = database.prepare(`SELECT * FROM ${TABLES.setupEntries} WHERE domain_id=? AND setup_prefix_key=? AND state IN ('reserved','building','published','deleting') ORDER BY generation DESC LIMIT 1`)
          .get(request.domainId, request.manifest.setupPrefixKey);
        const writer = writerRow === undefined ? undefined : setupEntry(writerRow);
        if (writer !== undefined) {
          if (writer.operationId === request.operationId && !manifestMatches(writer, request.manifest)) throw invalid("operation id was reused with different setup-prefix metadata");
          const lease = database.prepare(`SELECT 1 FROM ${TABLES.setupLeases} WHERE domain_id=? AND entry_id=? AND state IN ('active','expired-unverified') LIMIT 1`).get(request.domainId, writer.entryId);
          if (writer.state === "published" || writer.state === "deleting" || lease !== undefined) return { state: "contended", reason: "active-writer" } as const;
          database.prepare(`UPDATE ${TABLES.setupEntries} SET state='unverified' WHERE domain_id=? AND entry_id=? AND state IN ('reserved','building')`).run(request.domainId, writer.entryId);
          bump(database, request.domainId, "setupPrefixSafetyRevision");
        }
        const existingOperation = database.prepare(`SELECT * FROM ${TABLES.setupEntries} WHERE domain_id=? AND setup_prefix_key=? AND operation_id=? ORDER BY generation DESC LIMIT 1`)
          .get(request.domainId, request.manifest.setupPrefixKey, request.operationId);
        if (existingOperation !== undefined && setupEntry(existingOperation).entryId !== writer?.entryId) throw invalid("operation id already settled for setup-prefix key");
        const maximum = database.prepare(`SELECT COALESCE(MAX(generation),0) generation FROM ${TABLES.setupEntries} WHERE domain_id=? AND setup_prefix_key=?`)
          .get(request.domainId, request.manifest.setupPrefixKey);
        const fence = database.prepare(`SELECT next_generation FROM ${TABLES.setupFences} WHERE domain_id=? AND setup_prefix_key=?`)
          .get(request.domainId, request.manifest.setupPrefixKey);
        const generation = Math.max(exactInteger(record(maximum, "generation").generation, "generation") + 1, fence === undefined ? 1 : exactInteger(record(fence, "generation fence").next_generation, "next_generation"));
        const entryIdentity = createHash("sha256")
          .update(`${request.manifest.setupPrefixKey}\0${generation}\0${request.operationId}`)
          .digest("hex");
        const entryId = `sandbox-setup-prefix:${entryIdentity}`;
        database.prepare(`INSERT INTO ${TABLES.setupEntries}(
          domain_id, entry_id, setup_prefix_key, base_image_id, image_id, declaration_json, declaration_digest,
          setup_manifest_digest, storage_schema_revision, artifact_format_revision, dependency, change_frequency,
          generation, operation_id, created_at, last_successful_use_at, protected_until, state
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'parent-backed', ?, ?, ?, ?, NULL, ?, 'building')`)
          .run(request.domainId, entryId, request.manifest.setupPrefixKey, request.manifest.baseImageId, request.manifest.declarationJson, request.manifest.declarationDigest, request.manifest.setupManifestDigest, request.manifest.storageSchemaRevision, request.manifest.artifactFormatRevision, request.manifest.changeFrequency, generation, request.operationId, request.now, request.protectedUntil);
        database.prepare(`INSERT INTO ${TABLES.setupScopes}(domain_id, entry_id, replacement_scope) VALUES (?, ?, ?)`).run(request.domainId, entryId, request.replacementScope);
        database.prepare(`INSERT INTO ${TABLES.setupLeases}(
          domain_id, lease_id, entry_id, setup_prefix_key, generation, kind, operation_id,
          holder_host_id, holder_boot_id, holder_pid, holder_process_start,
          heartbeat_sequence, heartbeat_at, expires_at, state
        ) VALUES (?, ?, ?, ?, ?, 'build', ?, ?, ?, ?, ?, 0, ?, ?, 'active')`)
          .run(request.domainId, request.leaseId, entryId, request.manifest.setupPrefixKey, generation, request.operationId, request.holder.hostId, request.holder.bootId, request.holder.pid, request.holder.processStart, request.now, request.expiresAt);
        const row = database.prepare(`SELECT * FROM ${TABLES.setupEntries} WHERE domain_id=? AND entry_id=?`).get(request.domainId, entryId);
        return { state: "reserved", entry: setupEntry(row) } as const;
      });
      return result(request.operation, reserved);
    }
    case "setup-heartbeat": {
      const receipt = database.prepare(`UPDATE ${TABLES.setupLeases} SET heartbeat_sequence=heartbeat_sequence+1, heartbeat_at=?, expires_at=? WHERE domain_id=? AND lease_id=? AND state='active'`)
        .run(request.heartbeatAt, request.expiresAt, request.domainId, request.leaseId);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-release-lease": {
      const receipt = database.prepare(`DELETE FROM ${TABLES.setupLeases} WHERE domain_id=? AND lease_id=?`).run(request.domainId, request.leaseId);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-mark-unverified": {
      const count = transaction(database, () => {
        database.prepare(`DELETE FROM ${TABLES.setupIndex} WHERE domain_id=? AND entry_id=?`).run(request.domainId, request.entryId);
        const receipt = database.prepare(`UPDATE ${TABLES.setupEntries} SET state='unverified' WHERE domain_id=? AND entry_id=? AND state NOT IN ('tombstoned','deleting')`).run(request.domainId, request.entryId);
        bump(database, request.domainId, "setupPrefixSafetyRevision");
        return changes(receipt.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "setup-publish-reserve": {
      const count = transaction(database, () => {
        const lock = database.prepare(`SELECT cache_kind, plan_id FROM ${TABLES.locks} WHERE domain_id=? AND image_id=?`).get(request.domainId, request.imageId);
        if (lock !== undefined) throw invalid("exact setup-prefix image is fenced by an active GC plan");
        const receipt = database.prepare(`UPDATE ${TABLES.setupEntries} SET image_id=?, state='published' WHERE domain_id=? AND entry_id=? AND operation_id=? AND generation=? AND state='building'`)
          .run(request.imageId, request.domainId, request.entryId, request.operationId, request.generation);
        if (receipt.changes !== 1) {
          const current = database.prepare(`SELECT image_id,state FROM ${TABLES.setupEntries} WHERE domain_id=? AND entry_id=? AND operation_id=? AND generation=?`)
            .get(request.domainId, request.entryId, request.operationId, request.generation);
          const value = current === undefined ? undefined : record(current, "setup publication");
          if (value === undefined || value.image_id !== request.imageId || !["published", "indexed"].includes(String(value.state))) throw invalid("setup-prefix publication lost operation/generation fence");
        }
        return changes(receipt.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "setup-publish-settle": {
      const count = transaction(database, () => {
        const current = database.prepare(`SELECT state,image_id FROM ${TABLES.setupEntries} WHERE domain_id=? AND entry_id=?`).get(request.domainId, request.entryId);
        if (current === undefined) throw invalid("setup-prefix publication entry disappeared");
        const value = record(current, "setup publication");
        if (value.state === "indexed" && value.image_id === request.imageId) return 0;
        if (value.state !== "published" || value.image_id !== request.imageId) throw invalid("published setup-prefix identity changed before indexing");
        database.prepare(`INSERT INTO ${TABLES.setupIndex}(domain_id,setup_prefix_key,entry_id) VALUES (?,?,?)`).run(request.domainId, request.setupPrefixKey, request.entryId);
        const updated = database.prepare(`UPDATE ${TABLES.setupEntries} SET state='indexed' WHERE domain_id=? AND entry_id=? AND state='published'`).run(request.domainId, request.entryId);
        database.prepare(`INSERT INTO ${TABLES.setupHeads}(domain_id,replacement_scope,entry_id) SELECT domain_id,replacement_scope,entry_id FROM ${TABLES.setupScopes} WHERE domain_id=? AND entry_id=? ON CONFLICT(domain_id,replacement_scope) DO UPDATE SET entry_id=excluded.entry_id`)
          .run(request.domainId, request.entryId);
        bump(database, request.domainId, "setupPrefixSafetyRevision");
        return changes(updated.changes);
      });
      return result(request.operation, { changes: count });
    }
    case "setup-prepare-root": {
      const root = request.root;
      const receipt = database.prepare(`INSERT INTO ${TABLES.setupRoots}(
        domain_id,root_id,entry_id,setup_prefix_key,generation,sandbox_id,sandbox_resource_identity,operation_id,state,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(request.domainId, root.rootId, root.entryId, root.setupPrefixKey, root.generation, root.sandboxId, root.sandboxResourceIdentity, root.operationId, root.state, root.createdAt);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-activate-root": {
      const receipt = database.prepare(`UPDATE ${TABLES.setupRoots} SET sandbox_id=?,sandbox_resource_identity=?,state='active' WHERE domain_id=? AND root_id=? AND entry_id=? AND generation=? AND state='prepared'`)
        .run(request.containerId, request.containerId, request.domainId, request.rootId, request.entryId, request.generation);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-remove-root": {
      const receipt = database.prepare(`DELETE FROM ${TABLES.setupRoots} WHERE domain_id=? AND root_id=?`).run(request.domainId, request.rootId);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-begin-root-release": {
      const receipt = database.prepare(`UPDATE ${TABLES.setupRoots} SET state='releasing' WHERE domain_id=? AND root_id=? AND entry_id=? AND sandbox_resource_identity=? AND state IN ('prepared','active','releasing')`)
        .run(request.domainId, request.rootId, request.entryId, request.containerId);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-finish-root-release": {
      const receipt = database.prepare(`DELETE FROM ${TABLES.setupRoots} WHERE domain_id=? AND root_id=? AND entry_id=? AND sandbox_resource_identity=? AND state='releasing'`)
        .run(request.domainId, request.rootId, request.entryId, request.containerId);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-mark-used": {
      const receipt = database.prepare(`UPDATE ${TABLES.setupEntries} SET last_successful_use_at=? WHERE domain_id=? AND entry_id=? AND generation=? AND state='indexed'`)
        .run(request.usedAt, request.domainId, request.entryId, request.generation);
      return result(request.operation, { changes: changes(receipt.changes) });
    }
    case "setup-image-claims": {
      const gcLocked = database.prepare(`SELECT 1 FROM ${TABLES.locks} WHERE domain_id=? AND image_id=?`).get(request.domainId, request.imageId) !== undefined;
      const taskBuildClaim = database.prepare(`SELECT 1 FROM ${TABLES.taskEntries} WHERE domain_id=? AND image_id=? AND state!='tombstoned' LIMIT 1`).get(request.domainId, request.imageId) !== undefined;
      const siblingSetupPrefixClaim = database.prepare(`SELECT 1 FROM ${TABLES.setupEntries} WHERE domain_id=? AND image_id=? AND entry_id!=? AND state!='tombstoned' LIMIT 1`).get(request.domainId, request.imageId, request.exceptEntryId) !== undefined;
      return result(request.operation, { gcLocked, taskBuildClaim, siblingSetupPrefixClaim });
    }
    case "setup-list-reclaim-candidates": {
      const entries = database.prepare(`SELECT entry.* FROM ${TABLES.setupEntries} entry JOIN ${TABLES.setupScopes} scope ON scope.domain_id=entry.domain_id AND scope.entry_id=entry.entry_id JOIN ${TABLES.setupHeads} head ON head.domain_id=scope.domain_id AND head.replacement_scope=scope.replacement_scope WHERE entry.domain_id=? AND entry.state='indexed' AND (? IS NULL OR scope.replacement_scope=?) AND (? IS NULL OR entry.entry_id!=?) AND entry.entry_id!=head.entry_id ORDER BY entry.created_at,entry.entry_id`)
        .all(request.domainId, request.replacementScope ?? null, request.replacementScope ?? null, request.exceptEntryId ?? null, request.exceptEntryId ?? null)
        .map(setupEntry);
      return result(request.operation, { entries: Object.freeze(entries) });
    }
    case "setup-reserve-delete": {
      const outcome = transaction(database, () => {
        const found = database.prepare(`SELECT * FROM ${TABLES.setupEntries} WHERE domain_id=? AND entry_id=?`).get(request.domainId, request.entryId);
        if (found === undefined) return { reserved: false, reason: "entry-missing" } as const;
        const entry = setupEntry(found);
        if (entry.state !== "indexed" || entry.imageId === null) return { reserved: false, reason: "entry-changed" } as const;
        const activeLease = database.prepare(`SELECT 1 FROM ${TABLES.setupLeases} WHERE domain_id=? AND entry_id=? AND state IN ('active','expired-unverified') LIMIT 1`).get(request.domainId, entry.entryId);
        const activeRoot = database.prepare(`SELECT 1 FROM ${TABLES.setupRoots} WHERE domain_id=? AND entry_id=? AND state IN ('prepared','active','releasing') LIMIT 1`).get(request.domainId, entry.entryId);
        const taskClaim = database.prepare(`SELECT 1 FROM ${TABLES.taskEntries} WHERE domain_id=? AND image_id=? AND state!='tombstoned' LIMIT 1`).get(request.domainId, entry.imageId);
        const siblingClaim = database.prepare(`SELECT 1 FROM ${TABLES.setupEntries} WHERE domain_id=? AND image_id=? AND entry_id!=? AND state!='tombstoned' LIMIT 1`).get(request.domainId, entry.imageId, entry.entryId);
        if (activeLease !== undefined || activeRoot !== undefined || taskClaim !== undefined || siblingClaim !== undefined) return { reserved: false, reason: "active-owner-or-cross-kind-claim" } as const;
        if (database.prepare(`SELECT 1 FROM ${TABLES.locks} WHERE domain_id=? AND image_id=?`).get(request.domainId, entry.imageId) !== undefined) return { reserved: false, reason: "active-delete-conflict" } as const;
        database.prepare(`INSERT INTO ${TABLES.locks}(domain_id,image_id,cache_kind,plan_id,entry_id,entry_generation,holder_pid,holder_boot_id,holder_process_start,created_at) VALUES (?,?,'sandbox-setup-prefix',?,?,?,?,?,?,?)`)
          .run(request.domainId, entry.imageId, request.planId, entry.entryId, entry.generation, request.holder.pid, request.holder.bootId, request.holder.processStart, request.createdAt);
        const marked = database.prepare(`UPDATE ${TABLES.setupEntries} SET state='deleting' WHERE domain_id=? AND entry_id=? AND generation=? AND state='indexed'`).run(request.domainId, entry.entryId, entry.generation);
        if (marked.changes !== 1) throw invalid("setup-prefix generation changed before deleting transition");
        database.prepare(`DELETE FROM ${TABLES.setupIndex} WHERE domain_id=? AND entry_id=?`).run(request.domainId, entry.entryId);
        return { reserved: true } as const;
      });
      return result(request.operation, outcome);
    }
    case "setup-settle-delete": {
      const count = transaction(database, () => {
        const updated = database.prepare(`UPDATE ${TABLES.setupEntries} SET state=? WHERE domain_id=? AND entry_id=? AND generation=? AND image_id=? AND state='deleting'`)
          .run(request.state, request.domainId, request.entryId, request.generation, request.imageId);
        database.prepare(`DELETE FROM ${TABLES.locks} WHERE domain_id=? AND image_id=? AND cache_kind='sandbox-setup-prefix' AND entry_id=? AND entry_generation=?`)
          .run(request.domainId, request.imageId, request.entryId, request.generation);
        if (request.state === "indexed") {
          const row = database.prepare(`SELECT setup_prefix_key FROM ${TABLES.setupEntries} WHERE domain_id=? AND entry_id=?`).get(request.domainId, request.entryId);
          if (row !== undefined) database.prepare(`INSERT OR IGNORE INTO ${TABLES.setupIndex}(domain_id,setup_prefix_key,entry_id) VALUES (?,?,?)`).run(request.domainId, exactString(record(row, "setup key").setup_prefix_key, "setup_prefix_key"), request.entryId);
        }
        bump(database, request.domainId, "setupPrefixSafetyRevision");
        return changes(updated.changes);
      });
      return result(request.operation, { changes: count });
    }
  }
}

export const dockerCacheRepositoryHandler: UserDatabaseRepositoryHandler<
  DockerCacheRepositoryRequest,
  DockerCacheRepositoryResult
> = Object.freeze({
  id: DOCKER_CACHE_REPOSITORY,
  currentRevision: DOCKER_CACHE_REPOSITORY_REVISION,
  migrateAdjacent,
  assertCurrentSchema,
  dispatch,
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function holderValue(value: unknown): value is DockerHolderIdentity {
  return isObject(value) && strings(value, ["hostId", "bootId", "processStart"]) && Number.isSafeInteger(value.pid);
}

function manifestValue(value: unknown): value is DockerSetupPrefixManifestFields {
  return isObject(value) && strings(value, [
    "setupPrefixKey", "baseImageId", "declarationJson", "declarationDigest", "setupManifestDigest",
    "storageSchemaRevision", "artifactFormatRevision",
  ]) && typeof value.changeFrequency === "number" && Number.isFinite(value.changeFrequency) && value.changeFrequency >= 0;
}

function taskEntryValue(value: unknown): value is DockerTaskBuildEntryRow {
  return isObject(value) && strings(value, [
    "buildKey", "tag", "imageId", "createdAt", "protectedUntil", "manifestDigest", "operationId", "state",
  ]) && (value.lastSuccessfulUseAt === null || typeof value.lastSuccessfulUseAt === "string") &&
    Number.isSafeInteger(value.generation) && ["indexed", "deleting", "tombstoned", "unverified"].includes(String(value.state));
}

function setupEntryValue(value: unknown): value is DockerSetupPrefixEntryRow {
  return isObject(value) && strings(value, [
    "entryId", "setupPrefixKey", "baseImageId", "declarationJson", "declarationDigest", "setupManifestDigest",
    "storageSchemaRevision", "artifactFormatRevision", "dependency", "operationId", "createdAt", "protectedUntil", "state",
  ]) && (value.imageId === null || typeof value.imageId === "string") &&
    (value.lastSuccessfulUseAt === null || typeof value.lastSuccessfulUseAt === "string") &&
    value.dependency === "parent-backed" && typeof value.changeFrequency === "number" && Number.isFinite(value.changeFrequency) &&
    Number.isSafeInteger(value.generation) &&
    ["reserved", "building", "published", "indexed", "invalidated", "deleting", "tombstoned", "unverified"].includes(String(value.state));
}

function setupRootValue(value: unknown): value is DockerSetupPrefixRootRow {
  return isObject(value) && strings(value, [
    "rootId", "entryId", "setupPrefixKey", "sandboxId", "sandboxResourceIdentity", "operationId", "state", "createdAt",
  ]) && Number.isSafeInteger(value.generation) && ["prepared", "active", "releasing"].includes(String(value.state));
}

function gcLockValue(value: unknown): value is DockerImageGcLockRow {
  return isObject(value) && strings(value, [
    "imageId", "cacheKind", "planId", "entryId", "holderBootId", "holderProcessStart", "createdAt",
  ]) && ["task-build", "sandbox-setup-prefix"].includes(String(value.cacheKind)) &&
    Number.isSafeInteger(value.entryGeneration) && Number.isSafeInteger(value.holderPid);
}

export function isDockerCacheRepositoryRequest(value: unknown): value is DockerCacheRepositoryRequest {
  if (!isObject(value) || value.repository !== DOCKER_CACHE_REPOSITORY || typeof value.operation !== "string") return false;
  switch (value.operation) {
    case "list-domains":
      return true;
    case "ensure-owner":
      return strings(value, ["candidateOwnerId"]);
    case "verify-domain": {
      if (!isObject(value.domain) || !strings(value, ["candidateAuthorityEpoch", "verifiedAt"])) return false;
      const domain = value.domain;
      return strings(domain, ["domainId", "ownerId", "daemonId", "storageDriver", "sentinelId", "backendIdentity", "providerFamily", "backendKind"]) &&
        domain.providerFamily === "docker" && domain.adminProtocolVersion === 1 && domain.backendKind === "docker-images";
    }
    case "task-get-indexed":
      return strings(value, ["domainId", "buildKey"]);
    case "task-mark-unverified":
      return strings(value, ["domainId", "buildKey"]) && (value.generation === undefined || Number.isSafeInteger(value.generation));
    case "task-publish":
      return strings(value, ["domainId", "buildKey", "tag", "imageId", "manifestDigest", "operationId", "now", "protectedUntil"]);
    case "task-acquire-use":
      return strings(value, ["domainId", "buildKey", "tag", "imageId", "manifestDigest", "leaseId", "rootId", "now"]) && holderValue(value.holder);
    case "task-heartbeat":
      return strings(value, ["domainId", "leaseId", "heartbeatAt"]);
    case "task-release-use":
      return strings(value, ["domainId", "leaseId", "rootId"]);
    case "task-list-entries":
      return strings(value, ["domainId"]) && (value.includeTombstoned === undefined || typeof value.includeTombstoned === "boolean");
    case "task-list-owners":
      return strings(value, ["domainId"]) && optionalString(value.buildKey);
    case "task-prune-owners":
      return strings(value, ["domainId"]) && stringArray(value.leaseIds) && stringArray(value.rootIds);
    case "task-read-safety-revision":
    case "task-list-delete-locks":
    case "setup-startup-snapshot":
      return strings(value, ["domainId"]);
    case "task-save-plan":
      return strings(value, ["domainId", "planId", "createdAt", "expiresAt", "payload", "digest"]);
    case "task-get-plan":
      return strings(value, ["domainId", "planId"]);
    case "task-save-plan-outcome":
      return strings(value, ["domainId", "planId", "outcome"]);
    case "task-reserve-delete":
      return strings(value, ["domainId", "planId", "evidenceDigest", "createdAt"]) && taskEntryValue(value.entry) && holderValue(value.holder);
    case "task-settle-delete":
      return strings(value, ["domainId", "planId", "buildKey", "imageId", "state"]) && Number.isSafeInteger(value.generation) &&
        ["indexed", "tombstoned", "unverified"].includes(String(value.state));
    case "task-recover-delete":
      return strings(value, ["domainId", "buildKey", "state"]) && gcLockValue(value.lock) &&
        ["tombstoned", "unverified"].includes(String(value.state));
    case "setup-prune-leases":
      return strings(value, ["domainId"]) && stringArray(value.deleteLeaseIds) && stringArray(value.unverifiableLeaseIds);
    case "setup-startup-isolate":
      return strings(value, ["domainId", "entryId"]) && (value.imageId === null || typeof value.imageId === "string");
    case "setup-startup-validate":
      return strings(value, ["domainId", "entryId"]) && typeof value.valid === "boolean";
    case "setup-acquire-indexed":
      return strings(value, ["domainId", "leaseId", "operationId", "now", "expiresAt"]) && optionalString(value.expectedEntryId) &&
        manifestValue(value.manifest) && holderValue(value.holder);
    case "setup-reserve":
      return strings(value, ["domainId", "replacementScope", "operationId", "leaseId", "now", "protectedUntil", "expiresAt"]) &&
        manifestValue(value.manifest) && holderValue(value.holder);
    case "setup-heartbeat":
      return strings(value, ["domainId", "leaseId", "heartbeatAt", "expiresAt"]);
    case "setup-release-lease":
    case "setup-mark-unverified":
    case "setup-remove-root":
      return strings(value, ["domainId", value.operation === "setup-remove-root" ? "rootId" : value.operation === "setup-release-lease" ? "leaseId" : "entryId"]);
    case "setup-publish-reserve":
      return strings(value, ["domainId", "entryId", "operationId", "imageId"]) && Number.isSafeInteger(value.generation);
    case "setup-publish-settle":
      return strings(value, ["domainId", "entryId", "setupPrefixKey", "imageId"]);
    case "setup-prepare-root":
      return strings(value, ["domainId"]) && setupRootValue(value.root);
    case "setup-activate-root":
      return strings(value, ["domainId", "rootId", "entryId", "containerId"]) && Number.isSafeInteger(value.generation);
    case "setup-begin-root-release":
    case "setup-finish-root-release":
      return strings(value, ["domainId", "rootId", "entryId", "containerId"]);
    case "setup-mark-used":
      return strings(value, ["domainId", "entryId", "usedAt"]) && Number.isSafeInteger(value.generation);
    case "setup-image-claims":
      return strings(value, ["domainId", "imageId", "exceptEntryId"]);
    case "setup-list-reclaim-candidates":
      return strings(value, ["domainId"]) && optionalString(value.replacementScope) && optionalString(value.exceptEntryId);
    case "setup-reserve-delete":
      return strings(value, ["domainId", "entryId", "planId", "createdAt"]) && holderValue(value.holder);
    case "setup-settle-delete":
      return strings(value, ["domainId", "entryId", "imageId", "state"]) && Number.isSafeInteger(value.generation) &&
        ["indexed", "tombstoned", "unverified"].includes(String(value.state));
    default:
      return false;
  }
}

export function isDockerCacheRepositoryResult(value: unknown): value is DockerCacheRepositoryResult {
  if (!isObject(value) || value.repository !== DOCKER_CACHE_REPOSITORY || typeof value.operation !== "string") return false;
  switch (value.operation) {
    case "ensure-owner":
      return strings(value, ["ownerId"]);
    case "verify-domain":
      return isObject(value.domain) && strings(value.domain, [
        "domainId", "ownerId", "daemonId", "storageDriver", "sentinelId", "backendIdentity", "authorityEpoch",
        "providerFamily", "backendKind", "firstVerifiedAt", "lastVerifiedAt", "lastState",
      ]) && value.domain.providerFamily === "docker" && value.domain.adminProtocolVersion === 1;
    case "list-domains":
      return Array.isArray(value.domains) && value.domains.every((domain) =>
        isObject(domain) && strings(domain, ["domainId", "ownerId", "backendIdentity", "authorityEpoch"]));
    case "task-get-indexed":
      return value.entry === null || taskEntryValue(value.entry);
    case "task-list-entries":
      return Array.isArray(value.entries) && value.entries.every(taskEntryValue);
    case "task-list-owners":
      return Array.isArray(value.leases) && value.leases.every((lease) =>
        isObject(lease) && strings(lease, ["leaseId", "buildKey", "holderBootId", "holderProcessStart", "createdAt", "heartbeatAt"]) &&
          Number.isSafeInteger(lease.holderPid) && Number.isSafeInteger(lease.generation)) &&
        Array.isArray(value.roots) && value.roots.every((root) =>
          isObject(root) && strings(root, ["rootId", "buildKey", "holderBootId", "holderProcessStart", "state", "createdAt"]) &&
          Number.isSafeInteger(root.holderPid) && Number.isSafeInteger(root.generation));
    case "task-read-safety-revision":
      return Number.isSafeInteger(value.revision);
    case "task-get-plan":
      return value.plan === null || (isObject(value.plan) && strings(value.plan, ["expiresAt", "payload", "digest"]) &&
        (value.plan.outcome === null || typeof value.plan.outcome === "string"));
    case "task-list-delete-locks":
      return Array.isArray(value.locks) && value.locks.every(gcLockValue);
    case "setup-startup-snapshot":
      return Array.isArray(value.entries) && value.entries.every(setupEntryValue) && Array.isArray(value.leases) &&
        value.leases.every((lease) => isObject(lease) && strings(lease, [
          "leaseId", "entryId", "setupPrefixKey", "kind", "operationId", "holderHostId", "holderBootId",
          "holderProcessStart", "heartbeatAt", "expiresAt", "state",
        ]) && Number.isSafeInteger(lease.generation) && Number.isSafeInteger(lease.holderPid) && Number.isSafeInteger(lease.heartbeatSequence)) &&
        Array.isArray(value.locks) && value.locks.every(gcLockValue);
    case "setup-acquire-indexed":
      return value.entry === null || setupEntryValue(value.entry);
    case "setup-reserve":
      return value.state === "reserved" ? setupEntryValue(value.entry) :
        value.state === "contended" && ["active-writer", "indexed-generation"].includes(String(value.reason));
    case "setup-image-claims":
      return typeof value.gcLocked === "boolean" && typeof value.taskBuildClaim === "boolean" && typeof value.siblingSetupPrefixClaim === "boolean";
    case "setup-list-reclaim-candidates":
      return Array.isArray(value.entries) && value.entries.every(setupEntryValue);
    case "task-acquire-use":
    case "task-reserve-delete":
    case "setup-reserve-delete":
      return typeof value.reserved === "boolean" && optionalString(value.reason);
    case "task-mark-unverified":
    case "task-publish":
    case "task-heartbeat":
    case "task-release-use":
    case "task-prune-owners":
    case "task-save-plan":
    case "task-save-plan-outcome":
    case "task-settle-delete":
    case "task-recover-delete":
    case "setup-prune-leases":
    case "setup-startup-isolate":
    case "setup-startup-validate":
    case "setup-heartbeat":
    case "setup-release-lease":
    case "setup-mark-unverified":
    case "setup-publish-reserve":
    case "setup-publish-settle":
    case "setup-prepare-root":
    case "setup-activate-root":
    case "setup-remove-root":
    case "setup-begin-root-release":
    case "setup-finish-root-release":
    case "setup-mark-used":
    case "setup-settle-delete":
      return Number.isSafeInteger(value.changes);
    default:
      return false;
  }
}
