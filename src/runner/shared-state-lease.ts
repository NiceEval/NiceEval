// Shared-state leases protect an author's external mutable state. They are
// deliberately *not* case locks: a lease never expires and is never taken
// over by a waiter. A crashed or failed cleanup path stays visible until an
// operator performs the explicit, owner-token-checked recovery flow.
//
// The durable authority is an append-only generation chain. A transition may
// only publish generation N + 1 after observing exact generation N, and uses
// a same-directory hard-link to occupy that fixed N + 1 name. Consequently a
// stale actor cannot delete, replace, or otherwise reach a newer generation.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Deferred, Effect, Fiber } from "effect";
import {
  fsyncDirEffect,
  readEntryFileEffect,
  slugHashEntryId,
  writeEntryFileEffect,
} from "../shared/entry-file-store.ts";

const SHARED_STATE_LEASE_NAMESPACE = "niceeval/shared-state/v3";
const SHARED_STATE_GENERATION_FORMAT = "niceeval.shared-state-generation/v1";
const SHARED_STATE_HEARTBEAT_FORMAT = "niceeval.shared-state-heartbeat/v1";
const GENERATION_FILE_PREFIX = "generation-";
const GENERATION_FILE_SUFFIX = ".json";
const GENERATION_WIDTH = 20;

export const SHARED_STATE_LEASE_HEARTBEAT_INTERVAL_MS = 10_000;

export type SharedStateLeaseStatus = "active" | "recovering";

/** The process currently running an explicit recovery hook. */
export interface SharedStateRecoveryActor {
  readonly pid: number;
  readonly host: string;
  readonly processIdentity: string;
  readonly startedAt: string;
}

/** Durable, human-readable ownership evidence. The owner token is immutable. */
export interface SharedStateLeaseRecord {
  readonly key: string;
  readonly experimentId: string;
  readonly ownerToken: string;
  readonly pid: number;
  readonly host: string;
  readonly processIdentity: string;
  readonly acquiredAt: string;
  /**
   * Public diagnostic heartbeat time. The immutable generation starts it at
   * acquisition; public reads may overlay a matching non-authoritative
   * sidecar. Heartbeats never grant authority.
   */
  readonly heartbeatAt: string;
  readonly status: SharedStateLeaseStatus;
  /** Immutable transition generation which made this record authoritative. */
  readonly generation: number;
  /** The exact prior authoritative generation (zero for a fresh chain). */
  readonly parentGeneration: number;
  /** Present only while an explicit CLI recovery is holding the lease closed. */
  readonly recoveryId?: string;
  readonly recoveryActor?: SharedStateRecoveryActor;
}

export interface SharedStateLeaseIdentity {
  readonly experimentId: string;
  readonly pid: number;
  readonly host: string;
  readonly processIdentity: string;
}

export class SharedStateLeaseError extends Error {
  constructor(
    readonly code:
      | "shared-state-lease-invalid"
      | "shared-state-lease-owner-mismatch"
      | "shared-state-lease-missing"
      | "shared-state-owner-still-live"
      | "shared-state-process-identity-unavailable"
      | "shared-state-recovery-confirmation-required"
      | "shared-state-recovery-state-mismatch"
      | "shared-state-recovery-in-progress"
      | "shared-state-recovery-identity-unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SharedStateLeaseError";
  }
}

export interface SharedStateLeaseEffectClaim {
  readonly ownerToken: string;
  /** Releases only this exact owner generation. It never deletes a newer holder. */
  readonly release: Effect.Effect<void, SharedStateLeaseError | unknown>;
  /**
   * Stops this process's diagnostic heartbeat without mutating the durable
   * lease. Cleanup failures use this path: the record must survive for an
   * explicit recovery, but it must not keep the finished CLI process alive.
   */
  readonly abandon: Effect.Effect<void>;
}

export interface AcquireSharedStateLeaseEffectResult {
  readonly claim: SharedStateLeaseEffectClaim;
}

/** A recovery either owns a durable recovery marker or found a completed release. */
export type ExplicitSharedStateRecovery =
  | {
      readonly _tag: "Claimed";
      readonly record: SharedStateLeaseRecord;
      readonly recoveryId: string;
    }
  | {
      readonly _tag: "AlreadyReleased";
      readonly record: SharedStateLeaseRecord;
    };

interface SharedStateFreeGeneration {
  readonly kind: "free";
  readonly key: string;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly releasedAt: string;
  /** The exact lease generation which was released. */
  readonly previous: SharedStateLeaseRecord;
}

type SharedStateGeneration =
  | { readonly kind: "lease"; readonly record: SharedStateLeaseRecord }
  | SharedStateFreeGeneration
  | { readonly kind: "legacy"; readonly record: SharedStateLeaseRecord };

interface SharedStateLedger {
  readonly dir: string;
  readonly latest: SharedStateGeneration | undefined;
}

/**
 * Non-authoritative, atomically replaced diagnostic heartbeat. Its filename
 * and payload are pinned to one immutable owner generation, so even a writer
 * that races a later release/recovery can never affect a newer holder.
 */
interface SharedStateLeaseHeartbeat {
  readonly format: typeof SHARED_STATE_HEARTBEAT_FORMAT;
  readonly key: string;
  readonly ownerToken: string;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly heartbeatAt: string;
}

function errnoCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function recordOf(value: unknown): globalThis.Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as globalThis.Record<string, unknown>
    : undefined;
}

function nodeIo<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: operation, catch: (cause) => cause });
}

function nodeSync<A>(operation: () => A): Effect.Effect<A, unknown> {
  return Effect.try({ try: operation, catch: (cause) => cause });
}

function withOpenFile<A>(
  path: string,
  flags: string,
  use: (handle: FileHandle) => Effect.Effect<A, unknown>,
): Effect.Effect<A, unknown> {
  return Effect.scoped(
    Effect.acquireRelease(
      nodeIo(() => open(path, flags)),
      (handle) => nodeIo(() => handle.close()).pipe(Effect.orDie),
    ).pipe(Effect.flatMap(use)),
  );
}

export function sharedStateLeasesDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "shared-state-leases");
}

function sharedStateLeaseEntryId(key: string): string {
  return slugHashEntryId(key, [SHARED_STATE_LEASE_NAMESPACE, key]);
}

function sharedStateLeaseGenerationDirOf(niceevalRoot: string, key: string): string {
  return join(sharedStateLeasesDirOf(niceevalRoot), `${sharedStateLeaseEntryId(key)}.generations`);
}

function sharedStateLeaseHeartbeatDirOf(generationDir: string): string {
  return join(generationDir, "heartbeats");
}

function sharedStateLeaseHeartbeatEntryId(record: SharedStateLeaseRecord): string {
  return slugHashEntryId(
    `generation-${record.generation}`,
    ["niceeval/shared-state-heartbeat/v1", record.key, record.ownerToken, String(record.generation)],
  );
}

/** v2 used a mutable flat entry. We only read it to fail closed or explicitly recover it. */
function legacySharedStateLeasePath(niceevalRoot: string, key: string): string {
  return join(sharedStateLeasesDirOf(niceevalRoot), `${slugHashEntryId(key, ["niceeval/shared-state/v2", key])}.json`);
}

function generationFileName(generation: number): string {
  return `${GENERATION_FILE_PREFIX}${String(generation).padStart(GENERATION_WIDTH, "0")}${GENERATION_FILE_SUFFIX}`;
}

function generationFromFileName(name: string): number | undefined {
  const match = /^generation-(\d+)\.json$/u.exec(name);
  if (match === null) return undefined;
  const generation = Number(match[1]);
  return isPositiveInteger(generation) && name === generationFileName(generation) ? generation : undefined;
}

function decodeRecoveryActor(value: unknown): SharedStateRecoveryActor | undefined {
  const actor = recordOf(value);
  if (
    actor === undefined ||
    !isPositiveInteger(actor.pid) ||
    !isNonEmptyString(actor.host) ||
    !isNonEmptyString(actor.processIdentity) ||
    !isTimestamp(actor.startedAt)
  ) {
    return undefined;
  }
  return Object.freeze({
    pid: actor.pid,
    host: actor.host,
    processIdentity: actor.processIdentity,
    startedAt: actor.startedAt,
  });
}

function decodeSharedStateLeaseRecord(
  key: string,
  value: unknown,
  opts: { readonly legacy?: boolean } = {},
): SharedStateLeaseRecord | undefined {
  const record = recordOf(value);
  if (record === undefined) return undefined;
  const recoveryActor = record.recoveryActor === undefined ? undefined : decodeRecoveryActor(record.recoveryActor);
  const recovering = record.status === "recovering";
  const generation = opts.legacy ? 0 : record.generation;
  const parentGeneration = opts.legacy ? 0 : record.parentGeneration;
  if (
    record.key !== key ||
    !isNonEmptyString(record.experimentId) ||
    !isNonEmptyString(record.ownerToken) ||
    !isPositiveInteger(record.pid) ||
    !isNonEmptyString(record.host) ||
    !isNonEmptyString(record.processIdentity) ||
    !isTimestamp(record.acquiredAt) ||
    !isTimestamp(record.heartbeatAt) ||
    (record.status !== "active" && !recovering) ||
    (!opts.legacy && (!isPositiveInteger(generation) || !isNonNegativeInteger(parentGeneration) || parentGeneration >= generation)) ||
    (recovering && (!isNonEmptyString(record.recoveryId) || recoveryActor === undefined)) ||
    (!recovering && (record.recoveryId !== undefined || record.recoveryActor !== undefined))
  ) {
    return undefined;
  }
  return Object.freeze({
    key,
    experimentId: record.experimentId,
    ownerToken: record.ownerToken,
    pid: record.pid,
    host: record.host,
    processIdentity: record.processIdentity,
    acquiredAt: record.acquiredAt,
    heartbeatAt: record.heartbeatAt,
    status: record.status as SharedStateLeaseStatus,
    generation: generation as number,
    parentGeneration: parentGeneration as number,
    ...(recovering ? { recoveryId: record.recoveryId as string, recoveryActor: recoveryActor! } : {}),
  });
}

function decodeSharedStateLeaseHeartbeat(
  record: SharedStateLeaseRecord,
  value: unknown,
): SharedStateLeaseHeartbeat | undefined {
  const heartbeat = recordOf(value);
  if (
    heartbeat === undefined ||
    heartbeat.format !== SHARED_STATE_HEARTBEAT_FORMAT ||
    heartbeat.key !== record.key ||
    heartbeat.ownerToken !== record.ownerToken ||
    heartbeat.generation !== record.generation ||
    heartbeat.parentGeneration !== record.parentGeneration ||
    !isTimestamp(heartbeat.heartbeatAt) ||
    Date.parse(heartbeat.heartbeatAt) < Date.parse(record.acquiredAt)
  ) {
    return undefined;
  }
  return Object.freeze({
    format: SHARED_STATE_HEARTBEAT_FORMAT,
    key: record.key,
    ownerToken: record.ownerToken,
    generation: record.generation,
    parentGeneration: record.parentGeneration,
    heartbeatAt: heartbeat.heartbeatAt,
  });
}

/**
 * A heartbeat is diagnostic only: unreadable, missing, stale, or malformed
 * sidecars leave the immutable generation record unchanged. Matching all of
 * key/token/generation/parent makes an old owner's sidecar inapplicable after
 * any release, recovery, or later acquisition.
 */
function readDiagnosticHeartbeatEffect(
  generationDir: string,
  record: SharedStateLeaseRecord,
): Effect.Effect<SharedStateLeaseRecord, never> {
  return readEntryFileEffect(
    sharedStateLeaseHeartbeatDirOf(generationDir),
    sharedStateLeaseHeartbeatEntryId(record),
    (value) => decodeSharedStateLeaseHeartbeat(record, value),
  ).pipe(
    Effect.map((heartbeat) => heartbeat === undefined
      ? record
      : Object.freeze({ ...record, heartbeatAt: heartbeat.heartbeatAt })),
    Effect.catchAll(() => Effect.succeed(record)),
  );
}

function writeDiagnosticHeartbeatEffect(
  generationDir: string,
  record: SharedStateLeaseRecord,
  heartbeatAt: string,
): Effect.Effect<void, unknown> {
  const heartbeat: SharedStateLeaseHeartbeat = Object.freeze({
    format: SHARED_STATE_HEARTBEAT_FORMAT,
    key: record.key,
    ownerToken: record.ownerToken,
    generation: record.generation,
    parentGeneration: record.parentGeneration,
    heartbeatAt,
  });
  return writeEntryFileEffect(
    sharedStateLeaseHeartbeatDirOf(generationDir),
    sharedStateLeaseHeartbeatEntryId(record),
    heartbeat,
  );
}

function decodeGeneration(key: string, value: unknown): SharedStateGeneration | undefined {
  const generation = recordOf(value);
  if (generation === undefined || generation.format !== SHARED_STATE_GENERATION_FORMAT) return undefined;
  if (generation.kind === "lease") {
    const record = decodeSharedStateLeaseRecord(key, generation);
    return record === undefined ? undefined : Object.freeze({ kind: "lease" as const, record });
  }
  if (generation.kind !== "free") return undefined;
  const previous = decodeSharedStateLeaseRecord(key, generation.previous);
  if (
    previous === undefined ||
    generation.key !== key ||
    !isPositiveInteger(generation.generation) ||
    !isNonNegativeInteger(generation.parentGeneration) ||
    generation.parentGeneration >= generation.generation ||
    generation.parentGeneration !== previous.generation ||
    !isTimestamp(generation.releasedAt)
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: "free" as const,
    key,
    generation: generation.generation,
    parentGeneration: generation.parentGeneration,
    releasedAt: generation.releasedAt,
    previous,
  });
}

function durableLeaseGeneration(record: SharedStateLeaseRecord): globalThis.Record<string, unknown> {
  return { format: SHARED_STATE_GENERATION_FORMAT, kind: "lease", ...record };
}

function durableFreeGeneration(record: SharedStateFreeGeneration): globalThis.Record<string, unknown> {
  return {
    format: SHARED_STATE_GENERATION_FORMAT,
    kind: "free",
    key: record.key,
    generation: record.generation,
    parentGeneration: record.parentGeneration,
    releasedAt: record.releasedAt,
    previous: record.previous,
  };
}

function generationNumber(generation: SharedStateGeneration | undefined): number {
  if (generation === undefined) return 0;
  return generation.kind === "free" ? generation.generation : generation.record.generation;
}

function leaseRecordOf(generation: SharedStateGeneration | undefined): SharedStateLeaseRecord | undefined {
  return generation?.kind === "lease" || generation?.kind === "legacy" ? generation.record : undefined;
}

function sameRecoveryActor(left: SharedStateRecoveryActor, right: SharedStateRecoveryActor): boolean {
  return left.pid === right.pid &&
    left.host === right.host &&
    left.processIdentity === right.processIdentity &&
    left.startedAt === right.startedAt;
}

function sameLeaseRecord(left: SharedStateLeaseRecord, right: SharedStateLeaseRecord): boolean {
  return left.key === right.key &&
    left.experimentId === right.experimentId &&
    left.ownerToken === right.ownerToken &&
    left.pid === right.pid &&
    left.host === right.host &&
    left.processIdentity === right.processIdentity &&
    left.acquiredAt === right.acquiredAt &&
    left.heartbeatAt === right.heartbeatAt &&
    left.status === right.status &&
    left.generation === right.generation &&
    left.parentGeneration === right.parentGeneration &&
    left.recoveryId === right.recoveryId &&
    (left.recoveryActor === undefined
      ? right.recoveryActor === undefined
      : right.recoveryActor !== undefined && sameRecoveryActor(left.recoveryActor, right.recoveryActor));
}

/** The immutable holder evidence must survive a recovery-to-recovery transition. */
function sameLeaseOwnerEvidence(left: SharedStateLeaseRecord, right: SharedStateLeaseRecord): boolean {
  return left.key === right.key &&
    left.experimentId === right.experimentId &&
    left.ownerToken === right.ownerToken &&
    left.pid === right.pid &&
    left.host === right.host &&
    left.processIdentity === right.processIdentity &&
    left.acquiredAt === right.acquiredAt &&
    left.heartbeatAt === right.heartbeatAt;
}

function legalFirstGeneration(
  first: SharedStateGeneration,
  legacy: SharedStateLeaseRecord | undefined,
): boolean {
  if (first.kind !== "lease") return false;
  if (first.record.status === "active") return legacy === undefined;
  // The only allowed v2 migration is explicit recovery: legacy has no v3
  // transition slot, so it becomes immutable recovering generation 1.
  return legacy !== undefined && sameLeaseOwnerEvidence(first.record, legacy);
}

function legalGenerationTransition(previous: SharedStateGeneration, next: SharedStateGeneration): boolean {
  if (previous.kind === "free") {
    // Only a normal acquisition may follow a released generation.
    return next.kind === "lease" && next.record.status === "active";
  }
  const previousRecord = previous.record;
  if (next.kind === "free") {
    // A free record is a compare-owner release, not a newly invented history.
    return sameLeaseRecord(next.previous, previousRecord);
  }
  // An active holder cannot be replaced by another active holder. The sole
  // lease-to-lease transition is explicit recovery, retaining the original
  // owner evidence while assigning a new recovery actor/id.
  if (next.record.status !== "recovering" || !sameLeaseOwnerEvidence(next.record, previousRecord)) return false;
  if (previousRecord.status !== "recovering") return true;
  // Recovering -> recovering is a new, separately identified recovery after
  // the prior actor stopped. Reusing either identity would make a stale actor
  // indistinguishable from the new operation.
  return next.record.recoveryId !== previousRecord.recoveryId &&
    next.record.recoveryActor !== undefined &&
    previousRecord.recoveryActor !== undefined &&
    !sameRecoveryActor(next.record.recoveryActor, previousRecord.recoveryActor);
}

function validateGenerationTransitions(
  key: string,
  entries: readonly { readonly generation: number; readonly state: SharedStateGeneration }[],
  legacy: SharedStateLeaseRecord | undefined,
): SharedStateLeaseError | undefined {
  let previousGeneration = 0;
  let previous: SharedStateGeneration | undefined;
  for (const entry of entries) {
    const stateGeneration = generationNumber(entry.state);
    const parentGeneration = entry.state.kind === "free"
      ? entry.state.parentGeneration
      : entry.state.record.parentGeneration;
    if (entry.generation !== previousGeneration + 1 || stateGeneration !== entry.generation || parentGeneration !== previousGeneration) {
      return invalidLeaseError(key, "generations are not a contiguous exact-parent chain");
    }
    if (previous === undefined) {
      if (!legalFirstGeneration(entry.state, legacy)) {
        return invalidLeaseError(
          key,
          "generation 1 must be an active fresh lease or a recovery of the exact v2 legacy owner",
        );
      }
    } else if (!legalGenerationTransition(previous, entry.state)) {
      return invalidLeaseError(
        key,
        `generation ${entry.generation} is not a legal transition from generation ${previousGeneration}`,
      );
    }
    previous = entry.state;
    previousGeneration = entry.generation;
  }
  return undefined;
}

function invalidLeaseError(key: string, message: string): SharedStateLeaseError {
  return new SharedStateLeaseError(
    "shared-state-lease-invalid",
    `sharedState generation chain for ${JSON.stringify(key)} is invalid: ${message}. Recovery fails closed.`,
  );
}

function readLegacySharedStateLeaseEffect(
  niceevalRoot: string,
  key: string,
): Effect.Effect<SharedStateLeaseRecord | undefined, SharedStateLeaseError | unknown> {
  return nodeIo(() => readFile(legacySharedStateLeasePath(niceevalRoot, key), "utf8")).pipe(
    Effect.flatMap((raw) => nodeSync(() => JSON.parse(raw))),
    Effect.flatMap((value) => {
      const record = decodeSharedStateLeaseRecord(key, value, { legacy: true });
      return record === undefined
        ? Effect.fail(invalidLeaseError(key, "the legacy mutable record cannot be decoded"))
        : Effect.succeed(record);
    }),
    Effect.catchAll((cause) => errnoCode(cause) === "ENOENT" ? Effect.succeed(undefined) : Effect.fail(cause)),
  );
}

/**
 * Read a contiguous immutable generation chain. Proposal files are ignored:
 * they are not authoritative until the hard-link has occupied a generation
 * filename. A malformed committed filename or record is an explicit fail
 * closed condition, never an opportunity to silently start a new holder.
 */
function readSharedStateLedgerEffect(
  niceevalRoot: string,
  key: string,
): Effect.Effect<SharedStateLedger, SharedStateLeaseError | unknown> {
  const dir = sharedStateLeaseGenerationDirOf(niceevalRoot, key);
  return nodeIo(() => readdir(dir)).pipe(
    Effect.catchAll((cause) => errnoCode(cause) === "ENOENT" ? Effect.succeed([] as string[]) : Effect.fail(cause)),
    Effect.flatMap((names): Effect.Effect<SharedStateLedger, SharedStateLeaseError | unknown> => {
      const generationNames = names.filter((name) => name.startsWith(GENERATION_FILE_PREFIX));
      const ordered: { name: string; generation: number }[] = [];
      for (const name of generationNames) {
        const generation = generationFromFileName(name);
        if (generation === undefined) {
          return Effect.fail(invalidLeaseError(key, `committed filename ${JSON.stringify(name)} is not canonical`));
        }
        ordered.push({ name, generation });
      }
      ordered.sort((left, right) => left.generation - right.generation);
      if (ordered.length === 0) {
        return readLegacySharedStateLeaseEffect(niceevalRoot, key).pipe(
          Effect.map((legacy): SharedStateLedger => Object.freeze({
            dir,
            latest: legacy === undefined ? undefined : Object.freeze({ kind: "legacy" as const, record: legacy }),
          })),
        );
      }
      return Effect.forEach(ordered, ({ name, generation }) =>
        nodeIo(() => readFile(join(dir, name), "utf8")).pipe(
          Effect.flatMap((raw) => nodeSync(() => JSON.parse(raw))),
          Effect.flatMap((value) => {
            const decoded = decodeGeneration(key, value);
            return decoded === undefined
              ? Effect.fail(invalidLeaseError(key, `generation ${generation} cannot be decoded`))
              : Effect.succeed({ generation, state: decoded });
          }),
        ),
      ).pipe(
        Effect.flatMap((entries) => readLegacySharedStateLeaseEffect(niceevalRoot, key).pipe(
          Effect.flatMap((legacy): Effect.Effect<SharedStateLedger, SharedStateLeaseError> => {
            const invalid = validateGenerationTransitions(key, entries, legacy);
            return invalid === undefined
              ? Effect.succeed(Object.freeze({ dir, latest: entries.at(-1)!.state }))
              : Effect.fail(invalid);
          }),
        )),
      );
    }),
  );
}

/**
 * Publish one immutable generation. `link(proposal, generation-N)` is the
 * linearization point: it succeeds only if no other transition has occupied
 * the same next-generation slot. The proposal is unique and non-authoritative
 * before the link, so a crash cannot leave a reusable fence or an ABA target.
 */
function publishGenerationExclusiveEffect(
  dir: string,
  generation: number,
  state: SharedStateGeneration,
): Effect.Effect<"published" | "occupied", SharedStateLeaseError | unknown> {
  const name = generationFileName(generation);
  const proposalPath = join(dir, `.${name}.${process.pid}.${randomUUID()}.proposal`);
  const targetPath = join(dir, name);
  const data = state.kind === "lease"
    ? durableLeaseGeneration(state.record)
    : state.kind === "free"
    ? durableFreeGeneration(state)
    : undefined;
  if (data === undefined) {
    return Effect.fail(new SharedStateLeaseError(
      "shared-state-lease-invalid",
      "A legacy sharedState record cannot be republished without explicit recovery.",
    ));
  }
  const writeProposal = withOpenFile(
    proposalPath,
    "wx",
    (handle) => nodeIo(() => handle.writeFile(JSON.stringify(data, null, 2), "utf8")).pipe(
      Effect.zipRight(nodeIo(() => handle.sync())),
    ),
  );
  return nodeIo(() => mkdir(dir, { recursive: true })).pipe(
    Effect.zipRight(writeProposal),
    Effect.zipRight(nodeIo(() => link(proposalPath, targetPath)).pipe(
      Effect.as("published" as const),
      Effect.catchAll((cause) => errnoCode(cause) === "EEXIST" ? Effect.succeed("occupied" as const) : Effect.fail(cause)),
    )),
    Effect.flatMap((result) => result === "published"
      ? fsyncDirEffect(dir).pipe(Effect.as(result))
      : Effect.succeed(result)),
    // Only this caller's random proposal is removed. Published generation
    // files are intentionally never deleted, renamed, or reused.
    Effect.ensuring(nodeIo(() => rm(proposalPath, { force: true })).pipe(Effect.ignore)),
  );
}

export function readSharedStateLeaseEffect(
  niceevalRoot: string,
  key: string,
): Effect.Effect<SharedStateLeaseRecord | undefined, SharedStateLeaseError | unknown> {
  return readSharedStateLedgerEffect(niceevalRoot, key).pipe(
    Effect.flatMap((ledger) => {
      const record = leaseRecordOf(ledger.latest);
      return record === undefined
        ? Effect.succeed(undefined)
        // Sidecar I/O is deliberately non-authoritative. A bad/missing read
        // cannot hide or invalidate the immutable lease generation.
        : readDiagnosticHeartbeatEffect(ledger.dir, record).pipe(Effect.catchAll(() => Effect.succeed(record)));
    }),
  );
}

/**
 * The public recovery command may show the prior owner after a completed
 * release. This lets it report `AlreadyReleased` without asking users to look
 * at private files; a new active generation still takes precedence and makes
 * an old token fail exact-owner validation.
 */
export function readSharedStateLeaseRecoveryTargetEffect(
  niceevalRoot: string,
  key: string,
): Effect.Effect<SharedStateLeaseRecord | undefined, SharedStateLeaseError | unknown> {
  return readSharedStateLedgerEffect(niceevalRoot, key).pipe(
    Effect.flatMap((ledger) => {
      const record = ledger.latest?.kind === "free" ? ledger.latest.previous : leaseRecordOf(ledger.latest);
      return record === undefined
        ? Effect.succeed(undefined)
        : readDiagnosticHeartbeatEffect(ledger.dir, record).pipe(Effect.catchAll(() => Effect.succeed(record)));
    }),
  );
}

function makeAbortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("aborted while waiting for shared-state recovery");
  error.name = "AbortError";
  return error;
}

function awaitAbort(signal: AbortSignal | undefined): Effect.Effect<never, Error> {
  if (signal === undefined) return Effect.never;
  return Effect.async((resume, effectSignal) => {
    let completed = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      effectSignal.removeEventListener("abort", onEffectAbort);
    };
    const complete = (): void => {
      if (completed) return;
      completed = true;
      cleanup();
    };
    const onAbort = (): void => {
      if (completed) return;
      complete();
      resume(Effect.fail(makeAbortError(signal)));
    };
    const onEffectAbort = (): void => complete();
    signal.addEventListener("abort", onAbort, { once: true });
    effectSignal.addEventListener("abort", onEffectAbort, { once: true });
    // Both listeners must be live before inspecting either signal: otherwise
    // an abort between inspection and registration could strand the waiter.
    if (effectSignal.aborted) onEffectAbort();
    else if (signal.aborted) onAbort();
    return Effect.sync(complete);
  });
}

function delayOrAbortEffect(ms: number, signal: AbortSignal | undefined): Effect.Effect<void, Error> {
  if (signal?.aborted) return Effect.fail(makeAbortError(signal));
  return Effect.raceFirst(Effect.sleep(ms), awaitAbort(signal)).pipe(Effect.asVoid);
}

/**
 * Returns a host-local process identity that distinguishes a PID reuse. Linux
 * uses the kernel start tick; other POSIX hosts use `ps`'s process start time.
 * A missing process returns undefined; inability to inspect it fails closed.
 */
export function processIdentityForPidEffect(pid: number): Effect.Effect<string | undefined, unknown> {
  return Effect.tryPromise({
    try: async () => {
      if (process.platform === "linux") {
        try {
          const raw = await readFile(`/proc/${pid}/stat`, "utf8");
          const closing = raw.lastIndexOf(")");
          const fields = closing < 0 ? [] : raw.slice(closing + 2).trim().split(/\s+/u);
          // /proc/<pid>/stat field 22 is starttime; `fields[0]` is field 3.
          const started = fields[19];
          if (started !== undefined && /^\d+$/u.test(started)) return `linux-starttime:${started}`;
          throw new Error("Could not parse /proc/<pid>/stat process identity.");
        } catch (cause) {
          if (errnoCode(cause) === "ENOENT") return undefined;
          throw cause;
        }
      }
      return await new Promise<string | undefined>((resolve, reject) => {
        execFile("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }, (error, stdout) => {
          if (error !== null) {
            if (stdout.trim().length === 0) resolve(undefined);
            else reject(error);
            return;
          }
          const started = stdout.trim();
          resolve(started.length === 0 ? undefined : `ps-lstart:${started}`);
        });
      });
    },
    catch: (cause) => cause,
  });
}

export function currentProcessIdentityEffect(): Effect.Effect<string, SharedStateLeaseError | unknown> {
  return processIdentityForPidEffect(process.pid).pipe(
    Effect.flatMap((identity) => identity === undefined
      ? Effect.fail(new SharedStateLeaseError(
          "shared-state-process-identity-unavailable",
          "NiceEval could not establish this process identity; sharedState fails closed rather than coordinating from a PID alone.",
        ))
      : Effect.succeed(identity)),
  );
}

function recoveryActor(host: string, processIdentity: string): SharedStateRecoveryActor {
  return Object.freeze({
    pid: process.pid,
    host,
    processIdentity,
    startedAt: new Date().toISOString(),
  });
}

/**
 * Heartbeats intentionally make no authority transition. They verify that the
 * exact immutable generation/token is still current, then atomically replace
 * only that generation's diagnostic sidecar. A sidecar failure is ignored and
 * cannot expire, take over, or resurrect any owner.
 */
function heartbeatEffect(
  niceevalRoot: string,
  key: string,
  expected: SharedStateLeaseRecord,
): Effect.Effect<"confirmed" | "lost", SharedStateLeaseError | unknown> {
  return readSharedStateLedgerEffect(niceevalRoot, key).pipe(
    Effect.flatMap((ledger) => {
      const current = leaseRecordOf(ledger.latest);
      if (current === undefined || !sameLeaseRecord(current, expected)) return Effect.succeed("lost" as const);
      return Clock.currentTimeMillis.pipe(
        Effect.flatMap((nowMs) => writeDiagnosticHeartbeatEffect(
          ledger.dir,
          expected,
          new Date(nowMs).toISOString(),
        ).pipe(
          // This write is merely user-facing evidence. The immutable head is
          // still authoritative even if the filesystem rejects the sidecar.
          Effect.catchAll(() => Effect.void),
          Effect.as("confirmed" as const),
        )),
      );
    }),
  );
}

function makeActiveLeaseRecord(input: {
  readonly key: string;
  readonly identity: SharedStateLeaseIdentity;
  readonly ownerToken: string;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly now: string;
}): SharedStateLeaseRecord {
  return Object.freeze({
    key: input.key,
    experimentId: input.identity.experimentId,
    ownerToken: input.ownerToken,
    pid: input.identity.pid,
    host: input.identity.host,
    processIdentity: input.identity.processIdentity,
    acquiredAt: input.now,
    heartbeatAt: input.now,
    status: "active",
    generation: input.generation,
    parentGeneration: input.parentGeneration,
  });
}

function freeGenerationFrom(record: SharedStateLeaseRecord, generation: number, releasedAt: string): SharedStateFreeGeneration {
  return Object.freeze({
    kind: "free",
    key: record.key,
    generation,
    parentGeneration: record.generation,
    releasedAt,
    previous: record,
  });
}

function releaseError(key: string, latest: SharedStateGeneration | undefined): SharedStateLeaseError {
  return new SharedStateLeaseError(
    latest === undefined ? "shared-state-lease-missing" : "shared-state-lease-owner-mismatch",
    `sharedState lease ${JSON.stringify(key)} was not released because its exact owner generation no longer matches; explicit recovery is required.`,
  );
}

/**
 * Advance exactly this active generation to a free generation. A competing
 * transition can only occupy the same next slot; after that happens we inspect
 * the new immutable head and accept it only if it is this exact release.
 */
function releaseExactLeaseEffect(
  niceevalRoot: string,
  key: string,
  expected: SharedStateLeaseRecord,
): Effect.Effect<void, SharedStateLeaseError | unknown> {
  return Effect.suspend(() => readSharedStateLedgerEffect(niceevalRoot, key).pipe(
    Effect.flatMap((ledger) => {
      if (ledger.latest?.kind === "free" && sameLeaseRecord(ledger.latest.previous, expected)) return Effect.void;
      const current = leaseRecordOf(ledger.latest);
      if (current === undefined || !sameLeaseRecord(current, expected)) return Effect.fail(releaseError(key, ledger.latest));
      const next = freeGenerationFrom(expected, expected.generation + 1, new Date().toISOString());
      return publishGenerationExclusiveEffect(ledger.dir, next.generation, next).pipe(
        Effect.flatMap((published) => published === "published" ? Effect.void : releaseExactLeaseEffect(niceevalRoot, key, expected)),
      );
    }),
  ));
}

/**
 * Acquires only a free/absent generation head. Existing active/recovering
 * leases are waited on indefinitely; heartbeat age and PID liveness are
 * diagnostic facts, never authority to take ownership.
 */
export function acquireSharedStateLeaseEffect(
  niceevalRoot: string,
  key: string,
  identity: SharedStateLeaseIdentity,
  opts: {
    readonly signal?: AbortSignal;
    readonly pollIntervalMs?: number;
    readonly heartbeatIntervalMs?: number;
    readonly onWaitStart?: (holder: SharedStateLeaseRecord) => void;
  } = {},
): Effect.Effect<AcquireSharedStateLeaseEffectResult, SharedStateLeaseError | unknown> {
  const ownerToken = randomUUID();
  const pollIntervalMs = opts.pollIntervalMs ?? SHARED_STATE_LEASE_HEARTBEAT_INTERVAL_MS;
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? SHARED_STATE_LEASE_HEARTBEAT_INTERVAL_MS;
  let waitReported = false;
  const acquire = (): Effect.Effect<SharedStateLeaseRecord, SharedStateLeaseError | unknown> => Effect.suspend(() => {
    if (opts.signal?.aborted) return Effect.fail(makeAbortError(opts.signal));
    return readSharedStateLedgerEffect(niceevalRoot, key).pipe(
      Effect.flatMap((ledger) => {
        const holder = leaseRecordOf(ledger.latest);
        if (holder !== undefined) {
          const reportWait = waitReported
            ? Effect.void
            : readDiagnosticHeartbeatEffect(ledger.dir, holder).pipe(
                Effect.flatMap((displayHolder) => Effect.sync(() => {
                  waitReported = true;
                  opts.onWaitStart?.(displayHolder);
                })),
              );
          return reportWait.pipe(
            Effect.zipRight(delayOrAbortEffect(pollIntervalMs, opts.signal)),
            Effect.zipRight(acquire()),
          );
        }
        return Clock.currentTimeMillis.pipe(
          Effect.flatMap((nowMs) => {
            const parentGeneration = generationNumber(ledger.latest);
            const record = makeActiveLeaseRecord({
              key,
              identity,
              ownerToken,
              generation: parentGeneration + 1,
              parentGeneration,
              now: new Date(nowMs).toISOString(),
            });
            const next: SharedStateGeneration = Object.freeze({ kind: "lease" as const, record });
            return publishGenerationExclusiveEffect(ledger.dir, record.generation, next).pipe(
              Effect.flatMap((published) => published === "published" ? Effect.succeed(record) : acquire()),
            );
          }),
        );
      }),
    );
  });

  return Effect.uninterruptibleMask((restore) =>
    restore(acquire()).pipe(
      Effect.flatMap((record) => {
        let heartbeatStopped = false;
        let lostOwnership = false;
        const heartbeat = Effect.forever(
          Effect.sleep(heartbeatIntervalMs).pipe(
            Effect.zipRight(heartbeatEffect(niceevalRoot, key, record).pipe(
              Effect.tap((outcome) => Effect.sync(() => {
                if (outcome === "lost") lostOwnership = true;
              })),
              // A diagnostic probe failure does not silently abandon an
              // otherwise-owned lease; release still performs the exact CAS.
              Effect.ignore,
            )),
          ),
        );
        return Effect.forkDaemon(restore(heartbeat)).pipe(
          Effect.flatMap((fiber) => Deferred.make<void, SharedStateLeaseError | unknown>().pipe(
            Effect.map((releaseCompletion) => {
              const stopHeartbeat = Effect.uninterruptible(Effect.suspend(() => {
                if (heartbeatStopped) return Effect.void;
                heartbeatStopped = true;
                return Fiber.interrupt(fiber).pipe(Effect.asVoid);
              }));
              const releaseOperation = stopHeartbeat.pipe(
                Effect.zipRight(releaseExactLeaseEffect(niceevalRoot, key, record)),
                Effect.catchAll((cause) => {
                  // Keep the exact failure visible to the caller. `lostOwnership`
                  // only improves the diagnosis; it never changes authority.
                  if (cause instanceof SharedStateLeaseError) return Effect.fail(cause);
                  return Effect.fail(lostOwnership
                    ? new SharedStateLeaseError(
                        "shared-state-lease-owner-mismatch",
                        `sharedState lease ${JSON.stringify(key)} changed while this owner was active; explicit recovery is required.`,
                      )
                    : cause);
                }),
              );
              const release = Effect.uninterruptible(
                Deferred.complete(releaseCompletion, releaseOperation).pipe(
                  Effect.zipRight(Deferred.await(releaseCompletion)),
                ),
              );
              return Object.freeze({ claim: Object.freeze({ ownerToken, release, abandon: stopHeartbeat }) });
            }),
          )),
        );
      }),
    ),
  );
}

function assertRecoveryConfirmed(input: {
  readonly confirmOwnerTerminated: boolean;
  readonly confirmRemoteQuiesced: boolean;
}): Effect.Effect<void, SharedStateLeaseError> {
  return input.confirmOwnerTerminated && input.confirmRemoteQuiesced
    ? Effect.void
    : Effect.fail(new SharedStateLeaseError(
        "shared-state-recovery-confirmation-required",
        "Shared-state recovery requires explicit confirmation that the owner terminated and remote state is quiesced.",
      ));
}

/** A local identity mismatch proves PID reuse; an unreadable identity fails closed. */
function assertActorStoppedEffect(
  actor: Pick<SharedStateRecoveryActor, "pid" | "host" | "processIdentity">,
  localHost: string,
  code: "shared-state-owner-still-live" | "shared-state-recovery-in-progress",
  remoteQuiesced: boolean,
): Effect.Effect<void, SharedStateLeaseError | unknown> {
  if (actor.host !== localHost) {
    return remoteQuiesced
      ? Effect.void
      : Effect.fail(new SharedStateLeaseError(
          "shared-state-recovery-identity-unavailable",
          `NiceEval cannot verify remote owner ${actor.host} without an explicit remote-quiesced acknowledgement.`,
        ));
  }
  return processIdentityForPidEffect(actor.pid).pipe(
    Effect.mapError(() => new SharedStateLeaseError(
      "shared-state-recovery-identity-unavailable",
      `NiceEval could not verify local process identity for PID ${actor.pid}; recovery fails closed.`,
    )),
    Effect.flatMap((current) => {
      if (current === undefined || current !== actor.processIdentity) return Effect.void;
      return Effect.fail(new SharedStateLeaseError(
        code,
        code === "shared-state-owner-still-live"
          ? `sharedState owner is still live on ${actor.host} as PID ${actor.pid}; recovery is refused.`
          : `A prior sharedState recovery is still live on ${actor.host} as PID ${actor.pid}; recovery is refused.`,
      ));
    }),
  );
}

function recoveryRecordFrom(
  source: SharedStateLeaseRecord,
  recoveryId: string,
  actor: SharedStateRecoveryActor,
): SharedStateLeaseRecord {
  return Object.freeze({
    ...source,
    status: "recovering",
    generation: source.generation + 1,
    parentGeneration: source.generation,
    recoveryId,
    recoveryActor: actor,
  });
}

function isExactRecoveringSource(
  record: SharedStateLeaseRecord,
  recoveryId: string,
  actor: SharedStateRecoveryActor,
): boolean {
  return record.status === "recovering" &&
    record.recoveryId === recoveryId &&
    record.recoveryActor !== undefined &&
    // Do not reduce this to processIdentity: PID, host, and the immutable
    // recovery id are all part of the replacement compare-owner predicate.
    sameRecoveryActor(record.recoveryActor, actor);
}

/**
 * Claims a failed holder for one recovery command without releasing it. The
 * recovery record is an immutable next generation. If two operators recover
 * concurrently, only one can publish that exact next slot; the loser never
 * clears or reuses a coordination path and must re-inspect/retry explicitly.
 */
export function beginExplicitSharedStateRecoveryEffect(input: {
  readonly niceevalRoot: string;
  readonly key: string;
  readonly ownerToken: string;
  readonly localHost: string;
  readonly confirmOwnerTerminated: boolean;
  readonly confirmRemoteQuiesced: boolean;
}): Effect.Effect<ExplicitSharedStateRecovery, SharedStateLeaseError | unknown> {
  return Effect.gen(function* () {
    yield* assertRecoveryConfirmed(input);
    const processIdentity = yield* currentProcessIdentityEffect();
    const actor = recoveryActor(input.localHost, processIdentity);
    const ledger = yield* readSharedStateLedgerEffect(input.niceevalRoot, input.key);
    if (ledger.latest === undefined) {
      return yield* Effect.fail(new SharedStateLeaseError(
        "shared-state-lease-missing",
        `No decodable sharedState lease exists for ${JSON.stringify(input.key)}.`,
      ));
    }
    if (ledger.latest.kind === "free") {
      if (ledger.latest.previous.ownerToken === input.ownerToken) {
        return Object.freeze({ _tag: "AlreadyReleased" as const, record: ledger.latest.previous });
      }
      return yield* Effect.fail(new SharedStateLeaseError(
        "shared-state-lease-owner-mismatch",
        `The supplied owner token does not own sharedState key ${JSON.stringify(input.key)}.`,
      ));
    }
    const observed = ledger.latest.record;
    if (observed.ownerToken !== input.ownerToken) {
      return yield* Effect.fail(new SharedStateLeaseError(
        "shared-state-lease-owner-mismatch",
        `The supplied owner token does not own sharedState key ${JSON.stringify(input.key)}.`,
      ));
    }
    yield* assertActorStoppedEffect(observed, input.localHost, "shared-state-owner-still-live", input.confirmRemoteQuiesced);
    if (observed.status === "recovering") {
      const observedRecoveryId = observed.recoveryId!;
      const observedRecoveryActor = observed.recoveryActor!;
      // The observed immutable parent itself is the exact compare-owner input.
      // Keep the full predicate explicit so a PID/processIdentity coincidence
      // cannot replace a different recovery operation.
      if (!isExactRecoveringSource(observed, observedRecoveryId, observedRecoveryActor)) {
        return yield* Effect.fail(invalidLeaseError(input.key, "recovering generation lacks an exact recovery actor"));
      }
      yield* assertActorStoppedEffect(
        observedRecoveryActor,
        input.localHost,
        "shared-state-recovery-in-progress",
        input.confirmRemoteQuiesced,
      );
    }
    const recoveryId = randomUUID();
    const recovered = recoveryRecordFrom(observed, recoveryId, actor);
    const next: SharedStateGeneration = Object.freeze({ kind: "lease" as const, record: recovered });
    const published = yield* publishGenerationExclusiveEffect(ledger.dir, recovered.generation, next);
    if (published === "published") return Object.freeze({ _tag: "Claimed" as const, record: recovered, recoveryId });
    return yield* Effect.fail(new SharedStateLeaseError(
      "shared-state-recovery-state-mismatch",
      `sharedState lease ${JSON.stringify(input.key)} changed before explicit recovery could claim its exact generation.`,
    ));
  });
}

function exactRecoveryActorMatchesCurrentProcess(
  actor: SharedStateRecoveryActor,
  localHost: string,
  processIdentity: string,
): boolean {
  return actor.pid === process.pid && actor.host === localHost && actor.processIdentity === processIdentity;
}

/**
 * Final recovery transition: exactly owner token + recovery id + recovery
 * actor host/PID/process identity advances its observed generation to free.
 * It does not unlink anything and therefore cannot erase a later holder.
 */
export function completeExplicitSharedStateRecoveryEffect(input: {
  readonly niceevalRoot: string;
  readonly key: string;
  readonly ownerToken: string;
  readonly recoveryId: string;
  readonly localHost: string;
}): Effect.Effect<void, SharedStateLeaseError | unknown> {
  const complete = (
    expected?: SharedStateLeaseRecord,
  ): Effect.Effect<void, SharedStateLeaseError | unknown> => Effect.suspend(() =>
    readSharedStateLedgerEffect(input.niceevalRoot, input.key).pipe(
      Effect.flatMap((ledger) => {
        if (ledger.latest?.kind === "free" && expected !== undefined && sameLeaseRecord(ledger.latest.previous, expected)) {
          return Effect.void;
        }
        const current = leaseRecordOf(ledger.latest);
        if (
          current === undefined ||
          (expected !== undefined && !sameLeaseRecord(current, expected)) ||
          current.ownerToken !== input.ownerToken ||
          current.status !== "recovering" ||
          current.recoveryId !== input.recoveryId ||
          current.recoveryActor === undefined
        ) {
          return Effect.fail(new SharedStateLeaseError(
            ledger.latest === undefined ? "shared-state-lease-missing" : "shared-state-recovery-state-mismatch",
            `sharedState lease ${JSON.stringify(input.key)} no longer matches this explicit recovery operation.`,
          ));
        }
        return currentProcessIdentityEffect().pipe(
          Effect.flatMap((processIdentity) => {
            if (!exactRecoveryActorMatchesCurrentProcess(current.recoveryActor!, input.localHost, processIdentity)) {
              return Effect.fail(new SharedStateLeaseError(
                "shared-state-recovery-state-mismatch",
                `sharedState lease ${JSON.stringify(input.key)} is not owned by this exact recovery actor.`,
              ));
            }
            const next = freeGenerationFrom(current, current.generation + 1, new Date().toISOString());
            return publishGenerationExclusiveEffect(ledger.dir, next.generation, next).pipe(
              Effect.flatMap((published) => published === "published" ? Effect.void : complete(current)),
            );
          }),
        );
      }),
    ));
  return complete();
}
