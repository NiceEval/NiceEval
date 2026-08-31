import { Clock, Effect, Fiber } from "effect";
import {
  type FencedOwner,
  type ProcessOwnerIdentity,
} from "../coordination/platform/sqlite-coordination.ts";
import { ProjectStateDatabase, type CaseCoordinationFacet } from "../record/sqlite/project-state-database.ts";
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

function caseEffect<A extends import("../record/sqlite/worker-protocol.ts").StorageWorkerResult>(
  niceevalRoot: string,
  operation: (facet: CaseCoordinationFacet) => Promise<A>,
): Effect.Effect<A, unknown, ProjectStateDatabase> {
  return Effect.flatMap(ProjectStateDatabase, (database) => Effect.flatMap(database.bind(niceevalRoot), (facets) =>
    Effect.tryPromise({ try: () => operation(facets.caseCoordination), catch: (cause) => cause })));
}

function recordFromProjection(
  experimentId: string,
  evalId: string,
  projection: import("../coordination/platform/sqlite-coordination.ts").CaseLockProjection | undefined,
): CaseLockRecord | undefined {
  return projection === undefined ? undefined : Object.freeze({
      experimentId,
      evalId,
      ...projection.owner,
      startedAt: projection.acquiredAt,
      heartbeatAt: projection.heartbeatAt,
    });
}

export function readCaseLockEffect(niceevalRoot: string, experimentId: string, evalId: string): Effect.Effect<CaseLockRecord | undefined, unknown, ProjectStateDatabase> {
  return caseEffect(niceevalRoot, (facet) => facet.execute({ _tag: "case-read", caseId: caseId(experimentId, evalId) })).pipe(
    Effect.map((projection) => recordFromProjection(experimentId, evalId, projection as import("../coordination/platform/sqlite-coordination.ts").CaseLockProjection | undefined)),
  );
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
): Effect.Effect<AcquireOnce, unknown, ProjectStateDatabase> {
  const id = caseId(experimentId, evalId);
  const at = new Date(nowMs).toISOString();
  const acquire = caseEffect(niceevalRoot, (facet) => facet.execute<FencedOwner>({
    _tag: "case-acquire", caseId: id, owner: identity, at, deadlineEpochMs: Date.now() + 30_000,
  })).pipe(Effect.map((owner) => ({ kind: "acquired" as const, owner, takenOver: false })));
  return acquire.pipe(Effect.catch((cause) => {
    if (!isConflict(cause)) return Effect.fail(cause);
    return readCaseLockEffect(niceevalRoot, experimentId, evalId).pipe(Effect.flatMap((holder) => {
      if (holder === undefined) return Effect.fail(cause);
      if (exactProcessState(holder) !== "dead") return Effect.succeed({ kind: "waiting" as const, holder });
      return caseEffect(niceevalRoot, (facet) => facet.execute<FencedOwner>({
        _tag: "case-takeover", caseId: id, deadOwner: holder, replacement: identity, at,
        deadlineEpochMs: Date.now() + 30_000,
      })).pipe(
        Effect.map((owner) => ({ kind: "acquired" as const, owner, takenOver: true })),
        Effect.catch((takeoverCause) => isConflict(takeoverCause)
          ? readCaseLockEffect(niceevalRoot, experimentId, evalId).pipe(Effect.flatMap((replacement) =>
            replacement === undefined ? Effect.fail(takeoverCause) : Effect.succeed({ kind: "waiting" as const, holder: replacement })))
          : Effect.fail(takeoverCause)),
      );
    }));
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
): Effect.Effect<AcquireCaseLockEffectResult, unknown, ProjectStateDatabase> {
  const ownerIdentity = identity.ownerId !== undefined && identity.bootId !== undefined && identity.processStart !== undefined
    ? identity as ProcessOwnerIdentity
    : currentProcessOwnerIdentity();
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? CASE_LOCK_HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? heartbeatIntervalMs;
  let waitStarted = false;
  const acquire = (): Effect.Effect<{ owner: FencedOwner; takenOver: boolean }, unknown, ProjectStateDatabase> => Effect.suspend(() => Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => tryAcquireCaseLockOnceEffect(niceevalRoot, experimentId, evalId, ownerIdentity, now)),
    Effect.flatMap((result) => {
      if (result.kind === "acquired") return Effect.succeed({ owner: result.owner, takenOver: result.takenOver });
      if (!waitStarted) { waitStarted = true; opts.onWaitStart?.(result.holder); }
      return delayOrAbort(pollIntervalMs, opts.signal).pipe(Effect.andThen(acquire()));
    }),
  ));
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    const database = yield* ProjectStateDatabase;
    const facets = yield* database.bind(niceevalRoot);
    const acquired = yield* restore(acquire()).pipe(Effect.provideService(ProjectStateDatabase, database));
    const { owner, takenOver } = acquired;
    const id = caseId(experimentId, evalId);
    const key = `${niceevalRoot}\u0000${id}`;
    let released = false;
    const renew = Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) => Effect.tryPromise({
        try: () => facets.caseCoordination.execute({ _tag: "case-heartbeat", caseId: id, owner, at: new Date(now).toISOString(), deadlineEpochMs: Date.now() + 30_000 }),
        catch: (cause) => cause,
      })),
    );
    return yield* Effect.forkChild(Effect.forever(Effect.sleep(heartbeatIntervalMs).pipe(Effect.andThen(renew.pipe(Effect.ignore))))).pipe(
      Effect.map((fiber) => {
        const release = Effect.uninterruptible(Effect.suspend(() => {
          if (released) return Effect.void;
          released = true;
          held.delete(key);
          return Fiber.interrupt(fiber).pipe(Effect.andThen(Effect.tryPromise({
            try: () => facets.caseCoordination.execute<undefined>({ _tag: "case-release", caseId: id, owner, deadlineEpochMs: Date.now() + 30_000 }),
            catch: (cause) => cause,
          })));
        }));
        held.set(key, release);
        return Object.freeze({ claim: Object.freeze({ release }), takenOver });
      }),
    );
  }));
}

export function drainHeldCaseLocksEffect(): Effect.Effect<number> {
  const releases = [...held.values()];
  return Effect.forEach(releases, (release) => release.pipe(Effect.ignore), { concurrency: "unbounded" }).pipe(Effect.as(releases.length));
}

export function pendingHeldCaseLockCount(): number { return held.size; }
