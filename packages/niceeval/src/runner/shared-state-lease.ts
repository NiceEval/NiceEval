// The immutable per-key chains and their lease-set owner advance together in SQLite.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Clock, Deferred, Effect, Fiber } from "effect";
import type {
  SharedStateGenerationAppend,
  SharedStateGenerationRow,
  TeardownObligationRow,
} from "../record/sqlite/registry-repository.ts";
import type {
  StateLeaseAuthority,
  StateLeaseOwner,
  StateLeaseRegistryCommand,
  StateLeaseSet,
} from "../record/sqlite/state-lease-repository.ts";
import type { StorageWorkerResult } from "../record/sqlite/worker-protocol.ts";
import { ProjectStateDatabase, type ProjectStateFacets } from "../record/sqlite/project-state-database.ts";

function registryEffect<A>(
  root: string,
  operation: (facets: ProjectStateFacets) => Promise<A>,
): Effect.Effect<A, unknown, ProjectStateDatabase> {
  return Effect.flatMap(ProjectStateDatabase, (database) =>
    Effect.flatMap(database.bind(root), (facets) =>
      Effect.tryPromise({ try: () => operation(facets), catch: (cause) => cause }),
    ),
  );
}

function listSharedStateGenerations(
  root: string,
  key: string,
): Effect.Effect<readonly SharedStateGenerationRow[], unknown, ProjectStateDatabase> {
  return registryEffect(root, (facets) => facets.sharedState.list(key));
}

function leaseSetCommand<A extends StorageWorkerResult>(root: string, command: StateLeaseRegistryCommand) {
  return registryEffect(root, (facets) => facets.sharedState.set<A>(command));
}

const SHARED_STATE_GENERATION_FORMAT = "niceeval.shared-state-generation/v1";

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
  readonly leaseSetId: string;
  readonly experimentId: string;
  readonly ownerToken: string;
  readonly pid: number;
  readonly host: string;
  readonly processIdentity: string;
  readonly acquiredAt: string;
  /**
   * Public diagnostic heartbeat time. The immutable generation starts it at
   * acquisition; public reads may overlay a matching non-authoritative
   * ProjectDatabase heartbeat. Heartbeats never grant authority.
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

export class SharedStateLeaseError extends Error {
  readonly code:
    | "shared-state-lease-invalid"
    | "shared-state-lease-owner-mismatch"
    | "shared-state-lease-missing"
    | "shared-state-owner-still-live"
    | "shared-state-process-identity-unavailable"
    | "shared-state-recovery-confirmation-required"
    | "shared-state-recovery-state-mismatch"
    | "shared-state-recovery-in-progress"
    | "shared-state-recovery-identity-unavailable";
  constructor(
    code:
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
    this.code = code;
    this.name = "SharedStateLeaseError";
  }
}

export interface SharedStateLeaseEffectClaim {
  readonly set: StateLeaseAuthority;
  readonly release: (retirement?: TeardownObligationRow) => Effect.Effect<void, unknown, ProjectStateDatabase>;
  readonly abandon: Effect.Effect<void>;
}

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
  | SharedStateFreeGeneration;

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
    ? (value as globalThis.Record<string, unknown>)
    : undefined;
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
  return {
    pid: actor.pid,
    host: actor.host,
    processIdentity: actor.processIdentity,
    startedAt: actor.startedAt,
  };
}

function decodeSharedStateLeaseRecord(key: string, value: unknown): SharedStateLeaseRecord | undefined {
  const record = recordOf(value);
  if (record === undefined) return undefined;
  const recoveryActor = record.recoveryActor === undefined ? undefined : decodeRecoveryActor(record.recoveryActor);
  const recovering = record.status === "recovering";
  const generation = record.generation;
  const parentGeneration = record.parentGeneration;
  if (
    record.key !== key ||
    !isNonEmptyString(record.leaseSetId) ||
    !isNonEmptyString(record.experimentId) ||
    !isNonEmptyString(record.ownerToken) ||
    !isPositiveInteger(record.pid) ||
    !isNonEmptyString(record.host) ||
    !isNonEmptyString(record.processIdentity) ||
    !isTimestamp(record.acquiredAt) ||
    !isTimestamp(record.heartbeatAt) ||
    (record.status !== "active" && !recovering) ||
    !isPositiveInteger(generation) ||
    !isNonNegativeInteger(parentGeneration) ||
    parentGeneration >= generation ||
    (recovering && (!isNonEmptyString(record.recoveryId) || recoveryActor === undefined)) ||
    (!recovering && (record.recoveryId !== undefined || record.recoveryActor !== undefined))
  ) {
    return undefined;
  }
  return {
    key,
    leaseSetId: record.leaseSetId,
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
  };
}

function decodeGeneration(key: string, value: unknown): SharedStateGeneration | undefined {
  const generation = recordOf(value);
  if (generation === undefined || generation.format !== SHARED_STATE_GENERATION_FORMAT) return undefined;
  if (generation.kind === "lease") {
    const record = decodeSharedStateLeaseRecord(key, generation);
    return record === undefined ? undefined : { kind: "lease" as const, record };
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
  return {
    kind: "free" as const,
    key,
    generation: generation.generation,
    parentGeneration: generation.parentGeneration,
    releasedAt: generation.releasedAt,
    previous,
  };
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
  return generation?.kind === "lease" ? generation.record : undefined;
}

function sameRecoveryActor(left: SharedStateRecoveryActor, right: SharedStateRecoveryActor): boolean {
  return (
    left.pid === right.pid &&
    left.host === right.host &&
    left.processIdentity === right.processIdentity &&
    left.startedAt === right.startedAt
  );
}

function sameLeaseRecord(left: SharedStateLeaseRecord, right: SharedStateLeaseRecord): boolean {
  return (
    left.key === right.key &&
    left.leaseSetId === right.leaseSetId &&
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
      : right.recoveryActor !== undefined && sameRecoveryActor(left.recoveryActor, right.recoveryActor))
  );
}

/** The immutable holder evidence must survive a recovery-to-recovery transition. */
function sameLeaseOwnerEvidence(left: SharedStateLeaseRecord, right: SharedStateLeaseRecord): boolean {
  return (
    left.key === right.key &&
    left.leaseSetId === right.leaseSetId &&
    left.experimentId === right.experimentId &&
    left.ownerToken === right.ownerToken &&
    left.pid === right.pid &&
    left.host === right.host &&
    left.processIdentity === right.processIdentity &&
    left.acquiredAt === right.acquiredAt &&
    left.heartbeatAt === right.heartbeatAt
  );
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
  return (
    next.record.recoveryId !== previousRecord.recoveryId &&
    next.record.recoveryActor !== undefined &&
    previousRecord.recoveryActor !== undefined &&
    !sameRecoveryActor(next.record.recoveryActor, previousRecord.recoveryActor)
  );
}

function validateGenerationTransitions(
  key: string,
  entries: readonly { readonly generation: number; readonly state: SharedStateGeneration }[],
): SharedStateLeaseError | undefined {
  let previousGeneration = 0;
  let previous: SharedStateGeneration | undefined;
  for (const entry of entries) {
    const stateGeneration = generationNumber(entry.state);
    const parentGeneration =
      entry.state.kind === "free" ? entry.state.parentGeneration : entry.state.record.parentGeneration;
    if (
      entry.generation !== previousGeneration + 1 ||
      stateGeneration !== entry.generation ||
      parentGeneration !== previousGeneration
    ) {
      return invalidLeaseError(key, "generations are not a contiguous exact-parent chain");
    }
    if (previous === undefined) {
      if (entry.state.kind !== "lease" || entry.state.record.status !== "active") {
        return invalidLeaseError(key, "generation 1 must be an active lease");
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

/**
 * Read and validate the complete immutable generation chain from canonical
 * SQLite. A malformed committed row fails closed rather than becoming an
 * opportunity to silently start a new holder.
 */
function readSharedStateLedgerEffect(root: string, key: string) {
  return listSharedStateGenerations(root, key).pipe(
    Effect.flatMap((rows) => {
      const entries: { generation: number; state: SharedStateGeneration }[] = [];
      for (const row of rows) {
        let value: unknown;
        try {
          value = JSON.parse(Buffer.from(row.payload).toString("utf8"));
        } catch {
          return Effect.fail(invalidLeaseError(key, `generation ${row.generation} is not valid JSON`));
        }
        const state = decodeGeneration(key, value);
        if (
          state === undefined ||
          (state.kind === "free" ? state.previous.leaseSetId : state.record.leaseSetId) !== row.leaseSetId ||
          (state.kind === "free" ? "free" : state.record.status) !== row.kind
        ) {
          return Effect.fail(invalidLeaseError(key, `generation ${row.generation} cannot be decoded`));
        }
        entries.push({ generation: row.generation, state });
      }
      const invalid = validateGenerationTransitions(key, entries);
      return invalid === undefined ? Effect.succeed(entries) : Effect.fail(invalid);
    }),
  );
}

function appendInput(state: SharedStateGeneration): SharedStateGenerationAppend {
  const record = state.kind === "free" ? state.previous : state.record;
  const generation = generationNumber(state);
  return {
    key: record.key,
    leaseSetId: record.leaseSetId,
    expectedGeneration: generation - 1,
    generation,
    parentGeneration: generation - 1,
    kind: state.kind === "free" ? "free" : record.status,
    ownerToken: record.ownerToken,
    ownerPid: record.pid,
    ownerHost: record.host,
    ownerProcessIdentity: record.processIdentity,
    heartbeatAt: record.heartbeatAt,
    payload: Buffer.from(
      JSON.stringify(state.kind === "free" ? durableFreeGeneration(state) : durableLeaseGeneration(record)),
    ),
  };
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
  return Effect.callback((resume, effectSignal) => {
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
 * uses the kernel start tick plus `/proc`'s terminal-state boundary; other
 * POSIX hosts use `ps`'s process start time. An absent or terminal process
 * returns undefined; unreadable or malformed identity evidence fails closed.
 */
export function processIdentityForPidEffect(pid: number): Effect.Effect<string | undefined, unknown> {
  return Effect.tryPromise({
    try: async () => {
      if (process.platform === "linux") {
        try {
          const raw = await readFile(`/proc/${pid}/stat`, "utf8");
          const closing = raw.lastIndexOf(")");
          if (closing < 0 || raw[closing + 1] !== " ") {
            throw new Error("Could not parse /proc/<pid>/stat process identity.");
          }
          const fields = raw
            .slice(closing + 2)
            .trim()
            .split(/\s+/u);
          const state = fields[0];
          // field 3 is the task state. A zombie or either Linux dead state
          // cannot execute the owner cleanup, even though its start tick still
          // matches the durable lease. Treat only these exact terminal states
          // as stopped; a missing or malformed state remains unavailable.
          if (state === "Z" || state === "X" || state === "x") return undefined;
          if (state === undefined || !/^[A-Za-z]$/u.test(state)) {
            throw new Error("Could not parse /proc/<pid>/stat process state.");
          }
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
    Effect.flatMap((identity) =>
      identity === undefined
        ? Effect.fail(
            new SharedStateLeaseError(
              "shared-state-process-identity-unavailable",
              "NiceEval could not establish this process identity; sharedState fails closed rather than coordinating from a PID alone.",
            ),
          )
        : Effect.succeed(identity),
    ),
  );
}

function assertRecoveryConfirmed(input: {
  readonly confirmOwnerTerminated: boolean;
  readonly confirmRemoteQuiesced: boolean;
}): Effect.Effect<void, SharedStateLeaseError> {
  return input.confirmOwnerTerminated && input.confirmRemoteQuiesced
    ? Effect.void
    : Effect.fail(
        new SharedStateLeaseError(
          "shared-state-recovery-confirmation-required",
          "Shared-state recovery requires explicit confirmation that the owner terminated and remote state is quiesced.",
        ),
      );
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
      : Effect.fail(
          new SharedStateLeaseError(
            "shared-state-recovery-identity-unavailable",
            `NiceEval cannot verify remote owner ${actor.host} without an explicit remote-quiesced acknowledgement.`,
          ),
        );
  }
  return processIdentityForPidEffect(actor.pid).pipe(
    Effect.mapError(
      () =>
        new SharedStateLeaseError(
          "shared-state-recovery-identity-unavailable",
          `NiceEval could not verify local process identity for PID ${actor.pid}; recovery fails closed.`,
        ),
    ),
    Effect.flatMap((current) => {
      if (current === undefined || current !== actor.processIdentity) return Effect.void;
      return Effect.fail(
        new SharedStateLeaseError(
          code,
          code === "shared-state-owner-still-live"
            ? `sharedState owner is still live on ${actor.host} as PID ${actor.pid}; recovery is refused.`
            : `A prior sharedState recovery is still live on ${actor.host} as PID ${actor.pid}; recovery is refused.`,
        ),
      );
    }),
  );
}

function randomIdentity(): string {
  return randomBytes(16).toString("hex");
}

function currentSet(root: string, id: string) {
  return leaseSetCommand<StateLeaseSet | undefined>(root, { _tag: "lease-set-get", id });
}

function exactAuthority(set: StateLeaseSet): StateLeaseAuthority {
  const { id, generation, ownerToken, recoveryId } = set;
  return { id, generation, ownerToken, recoveryId };
}

function freeEntry(record: SharedStateLeaseRecord, releasedAt: string): SharedStateGenerationAppend {
  return appendInput({
    kind: "free",
    key: record.key,
    generation: record.generation + 1,
    parentGeneration: record.generation,
    releasedAt,
    previous: record,
  });
}

function advanceToFree(
  root: string,
  authority: StateLeaseAuthority,
  records: readonly SharedStateLeaseRecord[],
  retirement?: TeardownObligationRow,
) {
  const failure = new SharedStateLeaseError(
    "shared-state-recovery-state-mismatch",
    "The lease set no longer matches this exact release.",
  );
  const releasedAt = new Date().toISOString();
  return leaseSetCommand<boolean>(root, {
    _tag: "lease-set-release",
    expected: authority,
    entries: records.map((record) => freeEntry(record, releasedAt)),
    retirement,
  }).pipe(Effect.flatMap((released) => (released ? Effect.void : Effect.fail(failure))));
}

export function startLeaseSetAfterEffect(root: string, expected: StateLeaseAuthority) {
  return leaseSetCommand<boolean>(root, { _tag: "lease-set-start-after", expected }).pipe(
    Effect.flatMap((started) =>
      started ? Effect.void : Effect.fail(new Error("Lease set after obligation is no longer current.")),
    ),
  );
}

export function finishLeaseSetAfterEffect(
  root: string,
  expected: StateLeaseAuthority,
  retirement: TeardownObligationRow,
) {
  return leaseSetCommand<boolean>(root, { _tag: "lease-set-finish-after", expected, retirement }).pipe(
    Effect.flatMap((finished) =>
      finished ? Effect.void : Effect.fail(new Error("Lease set after obligation changed before completion.")),
    ),
  );
}

export function readHeldStateLeaseSetsEffect(root: string, experimentId: string) {
  return leaseSetCommand<readonly StateLeaseSet[]>(root, { _tag: "lease-set-pending", experimentId });
}

export function waitForOrphanedStateLeaseSetEffect(input: {
  readonly root: string;
  readonly experimentId: string;
  readonly host: string;
  readonly signal: AbortSignal | undefined;
  readonly onWait: (key: string) => void;
}) {
  let notified = false;
  const poll = Effect.fnUntraced(function* (): Effect.fn.Return<void, unknown, ProjectStateDatabase> {
    if (input.signal?.aborted) return yield* Effect.fail(makeAbortError(input.signal));
    const pending = yield* readHeldStateLeaseSetsEffect(input.root, input.experimentId);
    for (const set of pending) {
      if (set.afterStatus === "not-required") continue;
      // A live local owner continues its own lifecycle. A pending remote
      // obligation cannot be classified as live from process-local evidence.
      if (
        set.phase === "active" &&
        set.owner.host === input.host &&
        (yield* processIdentityForPidEffect(set.owner.pid)) === set.owner.processIdentity
      )
        continue;
      if (!notified) {
        notified = true;
        input.onWait(set.members[0].key);
      }
      yield* delayOrAbortEffect(1_000, input.signal);
      return yield* poll();
    }
  });
  return poll();
}

export function acquireSharedStateLeaseEffect(input: {
  readonly root: string;
  readonly keys: readonly string[];
  readonly invocationId: string;
  readonly runId: string;
  readonly owner: StateLeaseOwner;
  readonly signal: AbortSignal | undefined;
  readonly onWaitStart: (key: string) => void;
}): Effect.Effect<SharedStateLeaseEffectClaim, unknown, ProjectStateDatabase> {
  const keys = [...new Set(input.keys)].sort();
  const id = randomIdentity();
  const ownerToken = randomIdentity();
  const authority: StateLeaseAuthority = { id, ownerToken, generation: 1, recoveryId: null };
  let waitReported = false;
  const acquire = Effect.fnUntraced(function* (): Effect.fn.Return<
    readonly SharedStateLeaseRecord[],
    unknown,
    ProjectStateDatabase
  > {
    if (input.signal?.aborted) return yield* Effect.fail(makeAbortError(input.signal));
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const records: SharedStateLeaseRecord[] = [];
    for (const key of keys) {
      const latest = (yield* readSharedStateLedgerEffect(input.root, key)).at(-1)?.state;
      if (leaseRecordOf(latest) !== undefined) {
        if (!waitReported) {
          input.onWaitStart(key);
          waitReported = true;
        }
        yield* Effect.interruptible(delayOrAbortEffect(1_000, input.signal));
        return yield* acquire();
      }
      const parentGeneration = generationNumber(latest);
      records.push({
        key,
        leaseSetId: id,
        ...input.owner,
        ownerToken,
        status: "active",
        acquiredAt: now,
        heartbeatAt: now,
        generation: parentGeneration + 1,
        parentGeneration,
      });
    }
    if (input.signal?.aborted) return yield* Effect.fail(makeAbortError(input.signal));
    const acquired = yield* leaseSetCommand<boolean>(input.root, {
      _tag: "lease-set-acquire",
      id,
      invocationId: input.invocationId,
      runId: input.runId,
      owner: input.owner,
      ownerToken,
      entries: records.map((record) => appendInput({ kind: "lease", record })),
    });
    return acquired ? records : yield* acquire();
  });
  return Effect.gen(function* () {
    const records = yield* acquire();
    const heartbeat = Effect.forever(
      Effect.sleep(SHARED_STATE_LEASE_HEARTBEAT_INTERVAL_MS).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const at = new Date(yield* Clock.currentTimeMillis).toISOString();
            for (const record of records) {
              yield* registryEffect(input.root, (facets) =>
                facets.sharedState.heartbeat({
                  _tag: "shared-heartbeat",
                  key: record.key,
                  generation: record.generation,
                  ownerToken,
                  heartbeatAt: at,
                }),
              ).pipe(Effect.ignore);
            }
          }),
        ),
      ),
    );
    const fiber = yield* heartbeat.pipe(Effect.interruptible, Effect.forkChild);
    const releaseCompletion = yield* Deferred.make<void, unknown>();
    const abandon = Fiber.interrupt(fiber).pipe(Effect.asVoid);
    return {
      set: authority,
      abandon,
      release: (retirement?: TeardownObligationRow) =>
        Deferred.complete(
          releaseCompletion,
          abandon.pipe(Effect.andThen(Effect.suspend(() => advanceToFree(input.root, authority, records, retirement)))),
        ).pipe(Effect.andThen(Deferred.await(releaseCompletion)), Effect.uninterruptible),
    };
  }).pipe(Effect.uninterruptible);
}

function recordMatchesOwner(record: SharedStateLeaseRecord, set: StateLeaseSet): boolean {
  return (
    record.leaseSetId === set.id &&
    record.ownerToken === set.ownerToken &&
    record.experimentId === set.experimentId &&
    record.pid === set.owner.pid &&
    record.host === set.owner.host &&
    record.processIdentity === set.owner.processIdentity
  );
}

function readSetRecords(root: string, set: StateLeaseSet) {
  return Effect.forEach(set.members, (member) =>
    Effect.gen(function* () {
      const ledger = yield* readSharedStateLedgerEffect(root, member.key);
      const acquired = ledger[member.acquiredGeneration - 1]?.state;
      const current = ledger[member.currentGeneration - 1]?.state;
      const record = current?.kind === "free" ? current.previous : leaseRecordOf(current);
      const agreesWithRecovery =
        set.phase !== "recovering" ||
        (set.recoveryActor !== null &&
          record?.recoveryActor !== undefined &&
          sameRecoveryActor(record.recoveryActor, set.recoveryActor));
      if (
        acquired?.kind !== "lease" ||
        acquired.record.status !== "active" ||
        !recordMatchesOwner(acquired.record, set) ||
        record === undefined ||
        !recordMatchesOwner(record, set) ||
        !agreesWithRecovery ||
        (set.phase !== "free" && (record.status !== set.phase || (record.recoveryId ?? null) !== set.recoveryId)) ||
        (set.phase === "free" && current?.kind !== "free")
      ) {
        return yield* Effect.fail(
          invalidLeaseError(member.key, "lease set member evidence disagrees with its history"),
        );
      }
      return record;
    }),
  );
}

export function readSharedStateLeaseRecoveryTargetEffect(root: string, key: string) {
  return Effect.gen(function* () {
    const latest = (yield* readSharedStateLedgerEffect(root, key)).at(-1)?.state;
    const record = latest?.kind === "free" ? latest.previous : leaseRecordOf(latest);
    if (record === undefined) return undefined;
    const set = yield* currentSet(root, record.leaseSetId);
    if (set === undefined || !recordMatchesOwner(record, set)) {
      return yield* Effect.fail(invalidLeaseError(key, "lease set owner disagrees with its evidence"));
    }
    const member = set.members.find((entry) => entry.key === key);
    if (
      member?.currentGeneration !== generationNumber(latest) ||
      set.phase !== (latest?.kind === "free" ? "free" : record.status)
    ) {
      return yield* Effect.fail(invalidLeaseError(key, "key and lease set generations changed during inspection"));
    }
    const rows = yield* listSharedStateGenerations(root, key);
    const row = rows.at(-1);
    const display =
      row?.generation === record.generation && isTimestamp(row.heartbeatAt)
        ? { ...record, heartbeatAt: row.heartbeatAt }
        : record;
    return { record: display, set };
  });
}

export function leaseSetNeedsAfter(set: StateLeaseSet): boolean {
  return (
    set.phase !== "free" &&
    (set.afterStatus === "pending" ||
      set.afterStatus === "running" ||
      (set.afterStatus === "not-required" && set.members.some(({ key }) => !key.startsWith("state/"))))
  );
}

export function beginExplicitSharedStateRecoveryEffect(input: {
  readonly niceevalRoot: string;
  readonly key: string;
  readonly ownerToken: string;
  readonly localHost: string;
  readonly confirmOwnerTerminated: boolean;
  readonly confirmRemoteQuiesced: boolean;
  readonly afterAvailable: boolean;
}) {
  return Effect.gen(function* () {
    yield* assertRecoveryConfirmed(input);
    const root = input.niceevalRoot;
    const target = yield* readSharedStateLeaseRecoveryTargetEffect(root, input.key);
    if (target === undefined)
      return yield* Effect.fail(
        new SharedStateLeaseError(
          "shared-state-lease-missing",
          `No decodable sharedState lease exists for ${JSON.stringify(input.key)}.`,
        ),
      );
    const { record, set } = target;
    if (set.ownerToken !== input.ownerToken)
      return yield* Effect.fail(
        new SharedStateLeaseError(
          "shared-state-lease-owner-mismatch",
          `The supplied owner token does not own sharedState key ${JSON.stringify(input.key)}.`,
        ),
      );
    const records = yield* readSetRecords(root, set);
    if (set.phase === "free") return { _tag: "AlreadyReleased" as const, record, set };
    if (!input.afterAvailable && leaseSetNeedsAfter(set)) return { _tag: "AfterRequired" as const, record, set };
    yield* assertActorStoppedEffect(
      set.owner,
      input.localHost,
      "shared-state-owner-still-live",
      input.confirmRemoteQuiesced,
    );
    if (set.recoveryActor !== null) {
      yield* assertActorStoppedEffect(
        set.recoveryActor,
        input.localHost,
        "shared-state-recovery-in-progress",
        input.confirmRemoteQuiesced,
      );
    }
    const recoveryId = randomIdentity();
    const actor = {
      pid: process.pid,
      host: input.localHost,
      processIdentity: yield* currentProcessIdentityEffect(),
      startedAt: new Date().toISOString(),
    };
    const recoveredRecords = records.map(
      (source): SharedStateLeaseRecord => ({
        ...source,
        status: "recovering",
        recoveryId,
        recoveryActor: actor,
        generation: source.generation + 1,
        parentGeneration: source.generation,
      }),
    );
    const claimed = yield* leaseSetCommand<boolean>(root, {
      _tag: "lease-set-fence",
      expected: exactAuthority(set),
      expectedAfterStatus: set.afterStatus,
      recoveryId,
      actor,
      entries: recoveredRecords.map((next) => appendInput({ kind: "lease", record: next })),
    });
    if (!claimed)
      return yield* Effect.fail(
        new SharedStateLeaseError(
          "shared-state-recovery-state-mismatch",
          "The lease set changed before its exact recovery generation could be claimed.",
        ),
      );
    const authority: StateLeaseAuthority = {
      id: set.id,
      generation: set.generation + 1,
      ownerToken: set.ownerToken,
      recoveryId,
    };
    return {
      _tag: "Claimed" as const,
      record,
      set,
      authority,
      release: () => advanceToFree(root, authority, recoveredRecords),
    };
  });
}
