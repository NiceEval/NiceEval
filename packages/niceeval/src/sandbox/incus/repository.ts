import type { DatabaseSync } from "node:sqlite";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Runtime, Schema, type Scope } from "effect";
import { UserDatabaseInvalid, type UserDatabaseFailure } from "../../user-database/errors.ts";
import { userDatabaseHost, type UserDatabase, type UserDatabaseOpenOptions } from "../../user-database/index.ts";
import { incusError, type IncusProviderError } from "./errors.ts";

export const INCUS_REPOSITORY = "incus" as const;

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

export const ARTIFACT_STATES = Object.freeze([
  "reserved",
  "preparing",
  "publishing",
  "committed",
  "invalid",
  "quarantined",
  "released",
] as const);
export type ArtifactState = (typeof ARTIFACT_STATES)[number];

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

export interface IncusArtifactLocator {
  readonly artifactId: string;
  readonly generation: number;
  readonly project: string;
  readonly instance: string;
  readonly dockerDataVolume: string;
  readonly setupPrefixKey: string;
  readonly manifestDigest: string;
}

export interface ArtifactIntent extends IncusArtifactLocator {
  readonly state: ArtifactState;
  readonly executionDomainId: string;
  readonly runtimeProject: string;
  readonly pool: string;
  readonly baseFingerprint: string;
  readonly providerRevision: string;
  readonly guestInitRevision: string;
  readonly captureRevision: string;
  readonly coverage: string;
  readonly resourcesDigest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IncusAdmissionLease {
  readonly lockId: string;
  readonly fencingToken: number;
  readonly owner: AllocationOwner;
  readonly acquiredAt: string;
}

export type IncusRepositoryRequest =
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "allocation.reserve"; readonly intent: AllocationIntent }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "allocation.get"; readonly allocationId: string }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "allocation.list" }
  | {
      readonly repository: typeof INCUS_REPOSITORY;
      readonly operation: "allocation.transition";
      readonly allocationId: string;
      readonly expectedGeneration: number;
      readonly expectedState: AllocationState;
      readonly intent: AllocationIntent;
    }
  | {
      readonly repository: typeof INCUS_REPOSITORY;
      readonly operation: "artifact.reserve";
      readonly intent: ArtifactIntent;
      readonly maximumActive: number;
    }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "artifact.get"; readonly artifactId: string }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "artifact.list" }
  | {
      readonly repository: typeof INCUS_REPOSITORY;
      readonly operation: "artifact.transition";
      readonly artifactId: string;
      readonly expectedGeneration: number;
      readonly expectedState: ArtifactState;
      readonly intent: ArtifactIntent;
    }
  | {
      readonly repository: typeof INCUS_REPOSITORY;
      readonly operation: "admission.acquire";
      readonly lockId: string;
      readonly owner: AllocationOwner;
      readonly acquiredAt: string;
      readonly expected?: IncusAdmissionLease;
    }
  | {
      readonly repository: typeof INCUS_REPOSITORY;
      readonly operation: "admission.release";
      readonly lockId: string;
      readonly fencingToken: number;
      readonly owner: AllocationOwner;
    };

export type IncusRepositoryResult =
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "allocation.reserve"; readonly intent: AllocationIntent }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "allocation.get"; readonly intent: AllocationIntent | null }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "allocation.list"; readonly intents: readonly AllocationIntent[] }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "allocation.transition"; readonly intent: AllocationIntent }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "artifact.reserve"; readonly intent: ArtifactIntent }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "artifact.get"; readonly intent: ArtifactIntent | null }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "artifact.list"; readonly intents: readonly ArtifactIntent[] }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "artifact.transition"; readonly intent: ArtifactIntent }
  | {
      readonly repository: typeof INCUS_REPOSITORY;
      readonly operation: "admission.acquire";
      readonly acquired: boolean;
      readonly lease: IncusAdmissionLease;
    }
  | { readonly repository: typeof INCUS_REPOSITORY; readonly operation: "admission.release"; readonly released: boolean };

export type IncusRepositoryResultFor<Request extends IncusRepositoryRequest> =
  Extract<IncusRepositoryResult, { readonly operation: Request["operation"] }>;

const ParseOptions = Object.freeze({ errors: "all" as const, exact: true, onExcessProperty: "error" as const });
const OwnerSchema = Schema.Struct({ host: Schema.String, pid: Schema.Number, startedAt: Schema.String });
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
  state: Schema.Literal(...ALLOCATION_STATES),
});
const ArtifactIntentSchema = Schema.Struct({
  artifactId: Schema.String,
  generation: Schema.Number,
  project: Schema.String,
  instance: Schema.String,
  dockerDataVolume: Schema.String,
  setupPrefixKey: Schema.String,
  manifestDigest: Schema.String,
  state: Schema.Literal(...ARTIFACT_STATES),
  executionDomainId: Schema.String,
  runtimeProject: Schema.String,
  pool: Schema.String,
  baseFingerprint: Schema.String,
  providerRevision: Schema.String,
  guestInitRevision: Schema.String,
  captureRevision: Schema.String,
  coverage: Schema.String,
  resourcesDigest: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const AllocationTable = "incus_allocation_intents";
const ArtifactTable = "incus_artifact_intents";
const AdmissionTable = "incus_admission_leases";
const CreateAllocations = `CREATE TABLE ${AllocationTable} (allocation_id TEXT PRIMARY KEY, generation INTEGER NOT NULL CHECK (generation >= 1), state TEXT NOT NULL CHECK (state IN ('reserved','creating','ready','handed-off','destroy-requested','destroyed','lost')), execution_domain_id TEXT NOT NULL, project TEXT NOT NULL, payload TEXT NOT NULL) STRICT`;
const CreateArtifacts = `CREATE TABLE ${ArtifactTable} (artifact_id TEXT PRIMARY KEY, generation INTEGER NOT NULL CHECK (generation >= 1), state TEXT NOT NULL CHECK (state IN ('reserved','preparing','publishing','committed','invalid','quarantined','released')), execution_domain_id TEXT NOT NULL, project TEXT NOT NULL, setup_prefix_key TEXT NOT NULL, manifest_digest TEXT NOT NULL, payload TEXT NOT NULL) STRICT`;
const CreateAdmission = `CREATE TABLE ${AdmissionTable} (lock_id TEXT PRIMARY KEY, fencing_token INTEGER NOT NULL CHECK (fencing_token >= 1), owner_host TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_started_at TEXT NOT NULL, acquired_at TEXT NOT NULL) STRICT`;

type IntentRow = { readonly generation: unknown; readonly state: unknown; readonly payload: unknown };
type SchemaRow = { readonly type: string; readonly name: string; readonly tbl_name: string; readonly sql: string | null };
type LeaseRow = {
  readonly lock_id: unknown;
  readonly fencing_token: unknown;
  readonly owner_host: unknown;
  readonly owner_pid: unknown;
  readonly owner_started_at: unknown;
  readonly acquired_at: unknown;
};

function invalid(message: string, cause?: unknown): UserDatabaseInvalid {
  return new UserDatabaseInvalid({ code: "user-database-invalid", message, repository: INCUS_REPOSITORY, cause });
}

function exactSql(sql: string): string {
  return sql.trim().replace(/;+$/u, "").replace(/\s+/gu, " ");
}

function decodeWith<A>(schema: Schema.Schema<A>, value: unknown, label: string): A {
  const decoded = Schema.decodeUnknownEither(schema, ParseOptions)(value);
  if (Either.isLeft(decoded)) throw invalid(`${label} failed its typed decoder`, decoded.left);
  return decoded.right;
}

function parsePayload(text: unknown, label: string): unknown {
  if (typeof text !== "string") throw invalid(`${label} payload is not text`);
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw invalid(`${label} payload is not valid JSON`, cause);
  }
}

function freezeAllocation(value: unknown): AllocationIntent {
  const decoded = decodeWith(AllocationIntentSchema, value, "Incus allocation");
  if (!Number.isSafeInteger(decoded.generation) || decoded.generation < 1 ||
    !Number.isSafeInteger(decoded.requestedDockerDataBytes) || decoded.requestedDockerDataBytes < 1 ||
    !Number.isSafeInteger(decoded.owner.pid) || decoded.owner.pid < 1) {
    throw invalid("Incus allocation contains an invalid integer field");
  }
  return Object.freeze({
    ...decoded,
    owner: Object.freeze({ ...decoded.owner }),
    ...(decoded.providerLocator === undefined ? {} : { providerLocator: decoded.providerLocator }),
    ...(decoded.dockerDataVolume === undefined ? {} : { dockerDataVolume: decoded.dockerDataVolume }),
    ...(decoded.quarantined === true ? { quarantined: true } : {}),
    ...(decoded.acceptanceUnknown === undefined ? {} : { acceptanceUnknown: decoded.acceptanceUnknown }),
  });
}

function freezeArtifact(value: unknown): ArtifactIntent {
  const decoded = decodeWith(ArtifactIntentSchema, value, "Incus artifact");
  if (!Number.isSafeInteger(decoded.generation) || decoded.generation < 1) {
    throw invalid("Incus artifact generation must be a positive safe integer");
  }
  return Object.freeze({ ...decoded });
}

function decodeAllocationRow(row: unknown): AllocationIntent {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw invalid("Incus allocation query returned a non-object row");
  const generation = Reflect.get(row, "generation");
  const state = Reflect.get(row, "state");
  const intent = freezeAllocation(parsePayload(Reflect.get(row, "payload"), "Incus allocation"));
  if (generation !== intent.generation || state !== intent.state) throw invalid("Incus allocation indexed fields disagree with its typed payload");
  return intent;
}

function decodeArtifactRow(row: unknown): ArtifactIntent {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw invalid("Incus artifact query returned a non-object row");
  const generation = Reflect.get(row, "generation");
  const state = Reflect.get(row, "state");
  const intent = freezeArtifact(parsePayload(Reflect.get(row, "payload"), "Incus artifact"));
  if (generation !== intent.generation || state !== intent.state) throw invalid("Incus artifact indexed fields disagree with its typed payload");
  return intent;
}

function decodeLeaseRow(row: unknown): IncusAdmissionLease {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw invalid("Incus admission query returned a non-object row");
  const lockId = Reflect.get(row, "lock_id");
  const fencingToken = Reflect.get(row, "fencing_token");
  const host = Reflect.get(row, "owner_host");
  const pid = Reflect.get(row, "owner_pid");
  const startedAt = Reflect.get(row, "owner_started_at");
  const acquiredAt = Reflect.get(row, "acquired_at");
  if (typeof lockId !== "string" || !Number.isSafeInteger(fencingToken) || Number(fencingToken) < 1 ||
    typeof host !== "string" || !Number.isSafeInteger(pid) || Number(pid) < 1 ||
    typeof startedAt !== "string" || typeof acquiredAt !== "string") {
    throw invalid("Incus admission row contains invalid typed fields");
  }
  return Object.freeze({
    lockId,
    fencingToken: Number(fencingToken),
    owner: Object.freeze({ host, pid: Number(pid), startedAt }),
    acquiredAt,
  });
}

function transaction<A>(database: DatabaseSync, work: () => A): A {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw cause;
  }
}

function sameOwner(left: AllocationOwner, right: AllocationOwner): boolean {
  return left.host === right.host && left.pid === right.pid && left.startedAt === right.startedAt;
}

function sameLease(left: IncusAdmissionLease, right: IncusAdmissionLease): boolean {
  return left.lockId === right.lockId && left.fencingToken === right.fencingToken && sameOwner(left.owner, right.owner);
}

function sameAllocationIdentity(left: AllocationIntent, right: AllocationIntent): boolean {
  return left.allocationId === right.allocationId && left.executionId === right.executionId &&
    left.provider === right.provider && left.generation === right.generation &&
    left.requirementDigest === right.requirementDigest && left.artifactDigest === right.artifactDigest &&
    left.requestedDockerDataBytes === right.requestedDockerDataBytes &&
    left.executionDomainId === right.executionDomainId && left.project === right.project &&
    left.storagePool === right.storagePool && left.provisionToken === right.provisionToken &&
    sameOwner(left.owner, right.owner) && left.expectedTerminal === right.expectedTerminal;
}

function sameArtifactIdentity(left: ArtifactIntent, right: ArtifactIntent): boolean {
  return left.artifactId === right.artifactId && left.generation === right.generation &&
    left.project === right.project && left.instance === right.instance &&
    left.dockerDataVolume === right.dockerDataVolume && left.setupPrefixKey === right.setupPrefixKey &&
    left.manifestDigest === right.manifestDigest && left.executionDomainId === right.executionDomainId &&
    left.runtimeProject === right.runtimeProject && left.pool === right.pool &&
    left.baseFingerprint === right.baseFingerprint && left.providerRevision === right.providerRevision &&
    left.guestInitRevision === right.guestInitRevision && left.captureRevision === right.captureRevision &&
    left.coverage === right.coverage && left.resourcesDigest === right.resourcesDigest &&
    left.createdAt === right.createdAt;
}

const AllocationTransitions: Readonly<Record<AllocationState, ReadonlySet<AllocationState>>> = Object.freeze({
  reserved: new Set<AllocationState>(["reserved", "creating", "destroy-requested", "destroyed"]),
  creating: new Set<AllocationState>(["creating", "ready", "destroy-requested", "destroyed", "lost"]),
  ready: new Set<AllocationState>(["ready", "handed-off", "destroy-requested", "lost"]),
  "handed-off": new Set<AllocationState>(["handed-off", "destroy-requested", "lost"]),
  "destroy-requested": new Set<AllocationState>(["destroy-requested", "destroyed", "lost"]),
  destroyed: new Set<AllocationState>(["destroyed"]),
  lost: new Set<AllocationState>(["lost", "destroy-requested", "destroyed"]),
});
const ArtifactTransitions: Readonly<Record<ArtifactState, ReadonlySet<ArtifactState>>> = Object.freeze({
  reserved: new Set<ArtifactState>(["reserved", "preparing", "publishing", "invalid", "quarantined", "released"]),
  preparing: new Set<ArtifactState>(["preparing", "publishing", "invalid", "quarantined", "released"]),
  publishing: new Set<ArtifactState>(["publishing", "committed", "invalid", "quarantined", "released"]),
  committed: new Set<ArtifactState>(["committed", "invalid", "quarantined"]),
  invalid: new Set<ArtifactState>(["invalid", "quarantined", "released"]),
  quarantined: new Set<ArtifactState>(["quarantined", "released"]),
  released: new Set<ArtifactState>(["released"]),
});

function assertCurrentSchema(database: DatabaseSync): void {
  const rows = database.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE tbl_name IN (?, ?, ?) OR name IN (?, ?, ?) ORDER BY type, name",
  ).all(AllocationTable, ArtifactTable, AdmissionTable, AllocationTable, ArtifactTable, AdmissionTable) as SchemaRow[];
  const expected = new Map([
    [AllocationTable, CreateAllocations],
    [ArtifactTable, CreateArtifacts],
    [AdmissionTable, CreateAdmission],
  ]);
  const tables = rows.filter((row) => row.type === "table" && row.name === row.tbl_name && expected.has(row.name));
  const automaticIndexes = rows.filter((row) => row.type === "index" && expected.has(row.tbl_name) && row.sql === null);
  if (rows.length !== 6 || tables.length !== 3 || automaticIndexes.length !== 3 ||
    tables.some((row) => exactSql(row.sql ?? "") !== exactSql(expected.get(row.name) ?? ""))) {
    throw invalid("Incus repository schema does not match revision 1");
  }
}

function migrateAdjacent(database: DatabaseSync, fromRevision: number): number {
  if (fromRevision !== 0) throw invalid(`Incus repository has no migration from revision ${fromRevision}`);
  database.exec(`${CreateAllocations}; ${CreateArtifacts}; ${CreateAdmission};`);
  assertCurrentSchema(database);
  return 1;
}

function getAllocation(database: DatabaseSync, allocationId: string): AllocationIntent | null {
  const row = database.prepare(`SELECT generation, state, payload FROM ${AllocationTable} WHERE allocation_id = ?`).get(allocationId);
  return row === undefined ? null : decodeAllocationRow(row);
}

function getArtifact(database: DatabaseSync, artifactId: string): ArtifactIntent | null {
  const row = database.prepare(`SELECT generation, state, payload FROM ${ArtifactTable} WHERE artifact_id = ?`).get(artifactId);
  return row === undefined ? null : decodeArtifactRow(row);
}

function dispatch(database: DatabaseSync, request: IncusRepositoryRequest): IncusRepositoryResult {
  if (request.operation === "allocation.reserve") {
    const intent = freezeAllocation(request.intent);
    if (intent.state !== "reserved") throw invalid("Incus allocation reservation must begin in reserved state");
    return transaction(database, () => {
      const receipt = database.prepare(
        `INSERT INTO ${AllocationTable}(allocation_id, generation, state, execution_domain_id, project, payload) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(intent.allocationId, intent.generation, intent.state, intent.executionDomainId, intent.project, JSON.stringify(intent));
      if (receipt.changes !== 1) throw invalid("Incus allocation reservation did not insert exactly one row");
      return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intent });
    });
  }
  if (request.operation === "allocation.get") {
    return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intent: getAllocation(database, request.allocationId) });
  }
  if (request.operation === "allocation.list") {
    const intents = database.prepare(`SELECT generation, state, payload FROM ${AllocationTable} ORDER BY allocation_id`).all().map(decodeAllocationRow);
    return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intents: Object.freeze(intents) });
  }
  if (request.operation === "allocation.transition") {
    const next = freezeAllocation(request.intent);
    return transaction(database, () => {
      const current = getAllocation(database, request.allocationId);
      if (current === null || current.generation !== request.expectedGeneration || current.state !== request.expectedState) {
        throw invalid(`Incus allocation ${request.allocationId} transition lost its generation/state fence`);
      }
      if (!sameAllocationIdentity(current, next) || !AllocationTransitions[current.state].has(next.state)) {
        throw invalid(`Incus allocation ${request.allocationId} attempted an invalid ${current.state} -> ${next.state} transition`);
      }
      const receipt = database.prepare(
        `UPDATE ${AllocationTable} SET state = ?, payload = ? WHERE allocation_id = ? AND generation = ? AND state = ?`,
      ).run(next.state, JSON.stringify(next), request.allocationId, request.expectedGeneration, request.expectedState);
      if (receipt.changes !== 1) throw invalid(`Incus allocation ${request.allocationId} transition failed its compare-and-swap`);
      return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intent: next });
    });
  }
  if (request.operation === "artifact.reserve") {
    const intent = freezeArtifact(request.intent);
    if (intent.state !== "reserved" || !Number.isSafeInteger(request.maximumActive) || request.maximumActive < 1) {
      throw invalid("Incus artifact reservation has invalid initial state or capacity");
    }
    return transaction(database, () => {
      const exact = database.prepare(
        `SELECT artifact_id FROM ${ArtifactTable} WHERE execution_domain_id = ? AND setup_prefix_key = ? AND manifest_digest = ? AND state IN ('reserved','preparing','publishing','committed') LIMIT 1`,
      ).get(intent.executionDomainId, intent.setupPrefixKey, intent.manifestDigest);
      if (exact !== undefined) throw invalid("Incus artifact exact-prefix reservation is already owned");
      const count = database.prepare(
        `SELECT COUNT(*) AS count FROM ${ArtifactTable} WHERE execution_domain_id = ? AND project = ? AND state NOT IN ('released','quarantined','invalid')`,
      ).get(intent.executionDomainId, intent.project) as { readonly count?: unknown } | undefined;
      if (count === undefined || !Number.isSafeInteger(count.count) || Number(count.count) >= request.maximumActive) {
        throw invalid("Incus artifact repository has no free reservation capacity");
      }
      const receipt = database.prepare(
        `INSERT INTO ${ArtifactTable}(artifact_id, generation, state, execution_domain_id, project, setup_prefix_key, manifest_digest, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(intent.artifactId, intent.generation, intent.state, intent.executionDomainId, intent.project,
        intent.setupPrefixKey, intent.manifestDigest, JSON.stringify(intent));
      if (receipt.changes !== 1) throw invalid("Incus artifact reservation did not insert exactly one row");
      return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intent });
    });
  }
  if (request.operation === "artifact.get") {
    return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intent: getArtifact(database, request.artifactId) });
  }
  if (request.operation === "artifact.list") {
    const intents = database.prepare(`SELECT generation, state, payload FROM ${ArtifactTable} ORDER BY artifact_id`).all().map(decodeArtifactRow);
    return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intents: Object.freeze(intents) });
  }
  if (request.operation === "artifact.transition") {
    const next = freezeArtifact(request.intent);
    return transaction(database, () => {
      const current = getArtifact(database, request.artifactId);
      if (current === null || current.generation !== request.expectedGeneration || current.state !== request.expectedState) {
        throw invalid(`Incus artifact ${request.artifactId} transition lost its generation/state fence`);
      }
      if (!sameArtifactIdentity(current, next) || !ArtifactTransitions[current.state].has(next.state)) {
        throw invalid(`Incus artifact ${request.artifactId} attempted an invalid ${current.state} -> ${next.state} transition`);
      }
      if (next.state === "committed") {
        const duplicate = database.prepare(
          `SELECT artifact_id FROM ${ArtifactTable} WHERE execution_domain_id = ? AND setup_prefix_key = ? AND manifest_digest = ? AND state = 'committed' AND artifact_id <> ? LIMIT 1`,
        ).get(next.executionDomainId, next.setupPrefixKey, next.manifestDigest, next.artifactId);
        if (duplicate !== undefined) throw invalid("Incus artifact commit conflicts with another committed exact prefix");
      }
      const receipt = database.prepare(
        `UPDATE ${ArtifactTable} SET state = ?, payload = ? WHERE artifact_id = ? AND generation = ? AND state = ?`,
      ).run(next.state, JSON.stringify(next), request.artifactId, request.expectedGeneration, request.expectedState);
      if (receipt.changes !== 1) throw invalid(`Incus artifact ${request.artifactId} transition failed its compare-and-swap`);
      return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, intent: next });
    });
  }
  if (request.operation === "admission.acquire") {
    if (request.lockId.length === 0) throw invalid("Incus admission lock id must not be empty");
    const owner = decodeWith(OwnerSchema, request.owner, "Incus admission owner");
    return transaction(database, () => {
      const row = database.prepare(
        `SELECT lock_id, fencing_token, owner_host, owner_pid, owner_started_at, acquired_at FROM ${AdmissionTable} WHERE lock_id = ?`,
      ).get(request.lockId);
      if (row === undefined) {
        const lease = Object.freeze({ lockId: request.lockId, fencingToken: 1, owner: Object.freeze({ ...owner }), acquiredAt: request.acquiredAt });
        database.prepare(
          `INSERT INTO ${AdmissionTable}(lock_id, fencing_token, owner_host, owner_pid, owner_started_at, acquired_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(lease.lockId, lease.fencingToken, lease.owner.host, lease.owner.pid, lease.owner.startedAt, lease.acquiredAt);
        return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, acquired: true, lease });
      }
      const current = decodeLeaseRow(row);
      if (request.expected === undefined || !sameLease(current, request.expected)) {
        return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, acquired: false, lease: current });
      }
      if (current.fencingToken >= Number.MAX_SAFE_INTEGER) {
        throw invalid(`Incus admission ${request.lockId} exhausted its safe fencing-token range`);
      }
      const lease = Object.freeze({
        lockId: request.lockId,
        fencingToken: current.fencingToken + 1,
        owner: Object.freeze({ ...owner }),
        acquiredAt: request.acquiredAt,
      });
      const receipt = database.prepare(
        `UPDATE ${AdmissionTable} SET fencing_token = ?, owner_host = ?, owner_pid = ?, owner_started_at = ?, acquired_at = ? WHERE lock_id = ? AND fencing_token = ? AND owner_host = ? AND owner_pid = ? AND owner_started_at = ?`,
      ).run(lease.fencingToken, lease.owner.host, lease.owner.pid, lease.owner.startedAt, lease.acquiredAt,
        current.lockId, current.fencingToken, current.owner.host, current.owner.pid, current.owner.startedAt);
      if (receipt.changes !== 1) throw invalid(`Incus admission ${request.lockId} takeover failed its compare-and-swap`);
      return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, acquired: true, lease });
    });
  }
  return transaction(database, () => {
    const receipt = database.prepare(
      `DELETE FROM ${AdmissionTable} WHERE lock_id = ? AND fencing_token = ? AND owner_host = ? AND owner_pid = ? AND owner_started_at = ?`,
    ).run(request.lockId, request.fencingToken, request.owner.host, request.owner.pid, request.owner.startedAt);
    return Object.freeze({ repository: INCUS_REPOSITORY, operation: request.operation, released: receipt.changes === 1 });
  });
}

export const incusRepositoryHandler = Object.freeze({
  id: INCUS_REPOSITORY,
  currentRevision: 1,
  migrateAdjacent,
  assertCurrentSchema,
  dispatch,
});

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysAre(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isOwner(value: unknown): value is AllocationOwner {
  return record(value) && keysAre(value, ["host", "pid", "startedAt"]) && typeof value.host === "string" &&
    Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && typeof value.startedAt === "string";
}

function isAllocationIntent(value: unknown): value is AllocationIntent {
  if (!record(value)) return false;
  try { freezeAllocation(value); return true; } catch { return false; }
}

function isArtifactIntent(value: unknown): value is ArtifactIntent {
  if (!record(value)) return false;
  try { freezeArtifact(value); return true; } catch { return false; }
}

function isLease(value: unknown): value is IncusAdmissionLease {
  return record(value) && keysAre(value, ["lockId", "fencingToken", "owner", "acquiredAt"]) &&
    typeof value.lockId === "string" && Number.isSafeInteger(value.fencingToken) && Number(value.fencingToken) > 0 &&
    isOwner(value.owner) && typeof value.acquiredAt === "string";
}

/** Worker-side hostile-message decoder. It accepts no SQL, table, or dynamic operation. */
export function isIncusRepositoryRequest(value: unknown): value is IncusRepositoryRequest {
  if (!record(value) || value.repository !== INCUS_REPOSITORY || typeof value.operation !== "string") return false;
  if (value.operation === "allocation.list" || value.operation === "artifact.list") {
    return keysAre(value, ["repository", "operation"]);
  }
  if (value.operation === "allocation.get") {
    return keysAre(value, ["repository", "operation", "allocationId"]) && typeof value.allocationId === "string";
  }
  if (value.operation === "artifact.get") {
    return keysAre(value, ["repository", "operation", "artifactId"]) && typeof value.artifactId === "string";
  }
  if (value.operation === "allocation.reserve") {
    return keysAre(value, ["repository", "operation", "intent"]) && isAllocationIntent(value.intent);
  }
  if (value.operation === "artifact.reserve") {
    return keysAre(value, ["repository", "operation", "intent", "maximumActive"]) && isArtifactIntent(value.intent) &&
      Number.isSafeInteger(value.maximumActive) && Number(value.maximumActive) > 0;
  }
  if (value.operation === "allocation.transition") {
    return keysAre(value, ["repository", "operation", "allocationId", "expectedGeneration", "expectedState", "intent"]) &&
      typeof value.allocationId === "string" && Number.isSafeInteger(value.expectedGeneration) && Number(value.expectedGeneration) > 0 &&
      (ALLOCATION_STATES as readonly unknown[]).includes(value.expectedState) && isAllocationIntent(value.intent);
  }
  if (value.operation === "artifact.transition") {
    return keysAre(value, ["repository", "operation", "artifactId", "expectedGeneration", "expectedState", "intent"]) &&
      typeof value.artifactId === "string" && Number.isSafeInteger(value.expectedGeneration) && Number(value.expectedGeneration) > 0 &&
      (ARTIFACT_STATES as readonly unknown[]).includes(value.expectedState) && isArtifactIntent(value.intent);
  }
  if (value.operation === "admission.acquire") {
    return (keysAre(value, ["repository", "operation", "lockId", "owner", "acquiredAt"]) ||
      keysAre(value, ["repository", "operation", "lockId", "owner", "acquiredAt", "expected"])) &&
      typeof value.lockId === "string" && isOwner(value.owner) && typeof value.acquiredAt === "string" &&
      (value.expected === undefined || isLease(value.expected));
  }
  return value.operation === "admission.release" &&
    keysAre(value, ["repository", "operation", "lockId", "fencingToken", "owner"]) &&
    typeof value.lockId === "string" && Number.isSafeInteger(value.fencingToken) && Number(value.fencingToken) > 0 &&
    isOwner(value.owner);
}

export function isIncusRepositoryResult(value: unknown): value is IncusRepositoryResult {
  if (!record(value) || value.repository !== INCUS_REPOSITORY || typeof value.operation !== "string") return false;
  if (value.operation === "allocation.reserve" || value.operation === "allocation.transition") {
    return keysAre(value, ["repository", "operation", "intent"]) && isAllocationIntent(value.intent);
  }
  if (value.operation === "allocation.get") {
    return keysAre(value, ["repository", "operation", "intent"]) &&
      (value.intent === null || isAllocationIntent(value.intent));
  }
  if (value.operation === "allocation.list") {
    return keysAre(value, ["repository", "operation", "intents"]) &&
      Array.isArray(value.intents) && value.intents.every(isAllocationIntent);
  }
  if (value.operation === "artifact.reserve" || value.operation === "artifact.transition") {
    return keysAre(value, ["repository", "operation", "intent"]) && isArtifactIntent(value.intent);
  }
  if (value.operation === "artifact.get") {
    return keysAre(value, ["repository", "operation", "intent"]) &&
      (value.intent === null || isArtifactIntent(value.intent));
  }
  if (value.operation === "artifact.list") {
    return keysAre(value, ["repository", "operation", "intents"]) &&
      Array.isArray(value.intents) && value.intents.every(isArtifactIntent);
  }
  if (value.operation === "admission.acquire") {
    return keysAre(value, ["repository", "operation", "acquired", "lease"]) &&
      typeof value.acquired === "boolean" && isLease(value.lease);
  }
  return value.operation === "admission.release" && keysAre(value, ["repository", "operation", "released"]) &&
    typeof value.released === "boolean";
}

export interface IncusRepository {
  readonly reserveAllocation: (intent: AllocationIntent) => Promise<AllocationIntent>;
  readonly getAllocation: (allocationId: string) => Promise<AllocationIntent | undefined>;
  readonly listAllocations: () => Promise<readonly AllocationIntent[]>;
  readonly transitionAllocation: (current: AllocationIntent, next: AllocationIntent) => Promise<AllocationIntent>;
  readonly reserveArtifact: (intent: ArtifactIntent, maximumActive: number) => Promise<ArtifactIntent>;
  readonly getArtifact: (artifactId: string) => Promise<ArtifactIntent | undefined>;
  readonly listArtifacts: () => Promise<readonly ArtifactIntent[]>;
  readonly transitionArtifact: (current: ArtifactIntent, next: ArtifactIntent) => Promise<ArtifactIntent>;
  readonly acquireAdmission: (lockId: string, owner: AllocationOwner, expected?: IncusAdmissionLease) => Promise<{ readonly acquired: boolean; readonly lease: IncusAdmissionLease }>;
  readonly releaseAdmission: (lease: IncusAdmissionLease) => Promise<boolean>;
}

type RunRepositoryEffect = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
type CentralDispatch = <Request extends IncusRepositoryRequest>(
  request: Request,
) => Effect.Effect<IncusRepositoryResultFor<Request>, UserDatabaseFailure>;

function makeIncusRepository(database: UserDatabase, run: RunRepositoryEffect): IncusRepository {
  const centralDispatch = database.dispatch as unknown as CentralDispatch;
  const call = async <Request extends IncusRepositoryRequest>(request: Request): Promise<IncusRepositoryResultFor<Request>> => {
    const result = await run(centralDispatch(request));
    if (!isIncusRepositoryResult(result) || result.operation !== request.operation) {
      throw invalid(`Incus repository worker returned the wrong result for ${request.operation}`);
    }
    return result as IncusRepositoryResultFor<Request>;
  };
  const facade: IncusRepository = {
    reserveAllocation: async (intent: AllocationIntent) => (await call({ repository: INCUS_REPOSITORY, operation: "allocation.reserve", intent })).intent,
    getAllocation: async (allocationId: string) => (await call({ repository: INCUS_REPOSITORY, operation: "allocation.get", allocationId })).intent ?? undefined,
    listAllocations: async () => (await call({ repository: INCUS_REPOSITORY, operation: "allocation.list" })).intents,
    transitionAllocation: async (current: AllocationIntent, intent: AllocationIntent) => (await call({
      repository: INCUS_REPOSITORY,
      operation: "allocation.transition",
      allocationId: current.allocationId,
      expectedGeneration: current.generation,
      expectedState: current.state,
      intent,
    })).intent,
    reserveArtifact: async (intent: ArtifactIntent, maximumActive: number) => (await call({ repository: INCUS_REPOSITORY, operation: "artifact.reserve", intent, maximumActive })).intent,
    getArtifact: async (artifactId: string) => (await call({ repository: INCUS_REPOSITORY, operation: "artifact.get", artifactId })).intent ?? undefined,
    listArtifacts: async () => (await call({ repository: INCUS_REPOSITORY, operation: "artifact.list" })).intents,
    transitionArtifact: async (current: ArtifactIntent, intent: ArtifactIntent) => (await call({
      repository: INCUS_REPOSITORY,
      operation: "artifact.transition",
      artifactId: current.artifactId,
      expectedGeneration: current.generation,
      expectedState: current.state,
      intent,
    })).intent,
    acquireAdmission: async (lockId: string, owner: AllocationOwner, expected?: IncusAdmissionLease) => {
      const result = await call({
        repository: INCUS_REPOSITORY,
        operation: "admission.acquire",
        lockId,
        owner,
        acquiredAt: new Date().toISOString(),
        ...(expected === undefined ? {} : { expected }),
      });
      return Object.freeze({ acquired: result.acquired, lease: result.lease });
    },
    releaseAdmission: async (lease: IncusAdmissionLease) => (await call({
      repository: INCUS_REPOSITORY,
      operation: "admission.release",
      lockId: lease.lockId,
      fencingToken: lease.fencingToken,
      owner: lease.owner,
    })).released,
  };
  return Object.freeze(facade);
}

function legacyDirs(env: NodeJS.ProcessEnv): readonly string[] {
  const state = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return Object.freeze([
    join(state, "niceeval", "sandbox-allocations"),
    join(state, "niceeval", "incus-artifacts"),
  ]);
}

async function assertNoLegacyIncusLedger(env: NodeJS.ProcessEnv): Promise<void> {
  const found: string[] = [];
  for (const path of legacyDirs(env)) {
    try {
      await readdir(path);
      found.push(path);
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") continue;
      throw cause;
    }
  }
  if (found.length !== 0) {
    throw incusError(
      "sandbox-artifact-unverified",
      `Legacy Incus JSON/lock ledger bytes exist at ${found.map((path) => JSON.stringify(path)).join(", ")}.`,
      ["Do not open or migrate legacy ledger bytes. Remove them only through named maintenance after Incus inventory proves there are no active allocations or artifacts."],
    );
  }
}

export interface IncusRepositoryOpenOptions extends UserDatabaseOpenOptions {
  readonly env?: NodeJS.ProcessEnv;
}

export const incusRepositoryHost = Object.freeze({
  open: (options: IncusRepositoryOpenOptions = {}): Effect.Effect<IncusRepository, UserDatabaseFailure | IncusProviderError, Scope.Scope> =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => assertNoLegacyIncusLedger(options.env ?? process.env),
        catch: (cause) => cause instanceof Error && Reflect.get(cause, "code") === "sandbox-artifact-unverified"
          ? cause as IncusProviderError
          : incusError("sandbox-artifact-unverified", `Could not inspect legacy Incus ledger paths: ${cause instanceof Error ? cause.message : String(cause)}`, ["Restore access to the legacy ledger parent directory and retry."], cause),
      });
      const home = options.home ?? options.env?.NICEEVAL_HOME;
      const database = yield* userDatabaseHost.open({
        ...(home === undefined ? {} : { home }),
        ...(options.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
      });
      const runtime = yield* Effect.runtime<never>();
      return makeIncusRepository(database, Runtime.runPromise(runtime));
    }),
});
