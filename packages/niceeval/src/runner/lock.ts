import { Clock, Effect, Fiber } from "effect";
import {
  acquireCaseLockOnConnection,
  heartbeatCaseLockOnConnection,
  readCaseLockProjectionOnConnection,
  releaseCaseLockOnConnection,
  takeoverDeadCaseLockOnConnection,
  type FencedOwner,
  type ProcessOwnerIdentity,
} from "../coordination/platform/sqlite-coordination.ts";
import { closeRecordDatabase, openRecordWriter, recordSqlitePath } from "../record/sqlite/database.ts";
import { currentProcessOwnerIdentity, exactProcessState } from "./node-process-identity.ts";

export interface CaseLockRecord extends FencedOwner {
  readonly experimentId: string;
  readonly evalId: string;
  readonly startedAt: string;
  readonly heartbeatAt: string;
}

export const CASE_LOCK_HEARTBEAT_INTERVAL_MS = 10_000;
/** Retained for source compatibility; elapsed time never authorizes takeover. */
export const CASE_LOCK_EXPIRY_MS = 30_000;

function caseId(experimentId: string, evalId: string): string {
  return JSON.stringify([experimentId, evalId]);
}

function withWriter<A>(niceevalRoot: string, use: (connection: ReturnType<typeof openRecordWriter>) => A): A {
  const connection = openRecordWriter(recordSqlitePath(niceevalRoot));
  try { return use(connection); } finally { closeRecordDatabase(connection); }
}

function sqliteEffect<A>(operation: () => A): Effect.Effect<A, unknown> {
  return Effect.try({ try: operation, catch: (cause) => cause });
}

function readRecord(niceevalRoot: string, experimentId: string, evalId: string): CaseLockRecord | undefined {
  return withWriter(niceevalRoot, (connection) => {
    const projection = readCaseLockProjectionOnConnection(connection, caseId(experimentId, evalId));
    return projection === undefined ? undefined : Object.freeze({
      experimentId,
      evalId,
      ...projection.owner,
      startedAt: projection.acquiredAt,
      heartbeatAt: projection.heartbeatAt,
    });
  });
}

export function readCaseLockEffect(niceevalRoot: string, experimentId: string, evalId: string): Effect.Effect<CaseLockRecord | undefined, unknown> {
  return sqliteEffect(() => readRecord(niceevalRoot, experimentId, evalId));
}

/** Heartbeat age is observational and can never establish owner death. */
export function isCaseLockExpired(_record: CaseLockRecord, _nowMs: number): boolean { return false; }

export interface CaseLockEffectClaim { readonly release: Effect.Effect<void, unknown>; }
export interface AcquireCaseLockEffectResult { readonly claim: CaseLockEffectClaim; readonly takenOver: boolean; }

type AcquireOnce =
  | { readonly kind: "acquired"; readonly owner: FencedOwner; readonly takenOver: boolean }
  | { readonly kind: "waiting"; readonly holder: CaseLockRecord };

function isConflict(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "record-command-conflict";
}

export function tryAcquireCaseLockOnceEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  identity: ProcessOwnerIdentity,
  nowMs: number,
): Effect.Effect<AcquireOnce, unknown> {
  const id = caseId(experimentId, evalId);
  const at = new Date(nowMs).toISOString();
  return sqliteEffect(() => withWriter(niceevalRoot, (connection) => {
    try {
      return { kind: "acquired" as const, owner: acquireCaseLockOnConnection(connection, id, identity, at, Date.now() + 30_000), takenOver: false };
    } catch (cause) {
      if (!isConflict(cause)) throw cause;
      const projection = readCaseLockProjectionOnConnection(connection, id);
      if (projection === undefined) throw cause;
      const holder = Object.freeze({ experimentId, evalId, ...projection.owner, startedAt: projection.acquiredAt, heartbeatAt: projection.heartbeatAt });
      if (exactProcessState(projection.owner) !== "dead") return { kind: "waiting" as const, holder };
      try {
        return {
          kind: "acquired" as const,
          owner: takeoverDeadCaseLockOnConnection(connection, id, projection.owner, identity, at, Date.now() + 30_000),
          takenOver: true,
        };
      } catch (takeoverCause) {
        if (!isConflict(takeoverCause)) throw takeoverCause;
        const replacement = readCaseLockProjectionOnConnection(connection, id);
        if (replacement === undefined) throw takeoverCause;
        return { kind: "waiting" as const, holder: Object.freeze({
          experimentId, evalId, ...replacement.owner, startedAt: replacement.acquiredAt, heartbeatAt: replacement.heartbeatAt,
        }) };
      }
    }
  }));
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("aborted while waiting for case lock");
  error.name = "AbortError";
  return error;
}

function delayOrAbort(milliseconds: number, signal?: AbortSignal): Effect.Effect<void, Error> {
  if (signal === undefined) return Effect.sleep(milliseconds);
  if (signal.aborted) return Effect.fail(abortError(signal));
  return Effect.raceFirst(Effect.sleep(milliseconds), Effect.callback<void, Error>((resume) => {
    const onAbort = () => resume(Effect.fail(abortError(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  }));
}

const held = new Map<string, Effect.Effect<void, unknown>>();

export function acquireCaseLockEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  identity: Pick<ProcessOwnerIdentity, "pid" | "host"> & Partial<ProcessOwnerIdentity>,
  opts: { signal?: AbortSignal; pollIntervalMs?: number; heartbeatIntervalMs?: number; onWaitStart?: (holder: CaseLockRecord) => void } = {},
): Effect.Effect<AcquireCaseLockEffectResult, unknown> {
  const ownerIdentity = identity.ownerId !== undefined && identity.bootId !== undefined && identity.processStart !== undefined
    ? identity as ProcessOwnerIdentity
    : currentProcessOwnerIdentity();
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? CASE_LOCK_HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? heartbeatIntervalMs;
  let waitStarted = false;
  const acquire = (): Effect.Effect<{ owner: FencedOwner; takenOver: boolean }, unknown> => Effect.suspend(() => Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => tryAcquireCaseLockOnceEffect(niceevalRoot, experimentId, evalId, ownerIdentity, now)),
    Effect.flatMap((result) => {
      if (result.kind === "acquired") return Effect.succeed({ owner: result.owner, takenOver: result.takenOver });
      if (!waitStarted) { waitStarted = true; opts.onWaitStart?.(result.holder); }
      return delayOrAbort(pollIntervalMs, opts.signal).pipe(Effect.andThen(acquire()));
    }),
  ));
  return Effect.uninterruptibleMask((restore) => restore(acquire()).pipe(Effect.flatMap(({ owner, takenOver }) => {
    const id = caseId(experimentId, evalId);
    const key = `${niceevalRoot}\u0000${id}`;
    let released = false;
    const renew = Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) => sqliteEffect(() => withWriter(niceevalRoot, (connection) =>
        heartbeatCaseLockOnConnection(connection, id, owner, new Date(now).toISOString(), Date.now() + 30_000),
      ))),
    );
    return Effect.forkChild(Effect.forever(Effect.sleep(heartbeatIntervalMs).pipe(Effect.andThen(renew.pipe(Effect.ignore))))).pipe(
      Effect.map((fiber) => {
        const release = Effect.uninterruptible(Effect.suspend(() => {
          if (released) return Effect.void;
          released = true;
          held.delete(key);
          return Fiber.interrupt(fiber).pipe(Effect.andThen(sqliteEffect(() => withWriter(niceevalRoot, (connection) =>
            releaseCaseLockOnConnection(connection, id, owner, Date.now() + 30_000)))));
        }));
        held.set(key, release);
        return Object.freeze({ claim: Object.freeze({ release }), takenOver });
      }),
    );
  })));
}

export function drainHeldCaseLocksEffect(): Effect.Effect<number> {
  const releases = [...held.values()];
  return Effect.forEach(releases, (release) => release.pipe(Effect.ignore), { concurrency: "unbounded" }).pipe(Effect.as(releases.length));
}

export function pendingHeldCaseLockCount(): number { return held.size; }
