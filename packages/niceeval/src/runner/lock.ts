import { Clock, Effect, Exit, Fiber, Result, Semaphore } from "effect";
import { type FencedOwner, type ProcessOwnerIdentity } from "../coordination/platform/sqlite-coordination.ts";
import {
  ProjectStateDatabase,
  ProjectStateDatabaseLive,
  type CaseCoordinationFacet,
} from "../record/sqlite/project-state-database.ts";
import type { CaseCoordinationCommand } from "../record/sqlite/worker-protocol.ts";
import { currentProcessOwnerIdentity, exactProcessState } from "./node-process-identity.ts";

import { SqliteRecordError } from "../record/sqlite/errors.ts";
import { normalizeExternalCause, type ExternalCause } from "../shared/external-cause.ts";

export type CaseLockError = SqliteRecordError | ExternalCause;

function caseLockError(cause: unknown): CaseLockError {
  return cause instanceof SqliteRecordError ? cause : normalizeExternalCause(cause);
}

export interface CaseLockRecord extends FencedOwner {
  readonly experimentId: string;
  readonly evalId: string;
  readonly startedAt: string;
  readonly heartbeatAt: string;
}

export const CASE_LOCK_HEARTBEAT_INTERVAL_MS = 10_000;

function caseId(experimentId: string, evalId: string): string {
  return JSON.stringify([experimentId, evalId]);
}

function caseEffect<A extends import("../record/sqlite/worker-protocol.ts").StorageWorkerResult>(
  niceevalRoot: string,
  operation: (facet: CaseCoordinationFacet) => Promise<A>,
): Effect.Effect<A, CaseLockError, ProjectStateDatabase> {
  return Effect.flatMap(ProjectStateDatabase, (database) =>
    Effect.flatMap(database.bind(niceevalRoot), (facets) =>
      Effect.tryPromise({ try: () => operation(facets.caseCoordination), catch: caseLockError }),
    ),
  );
}

function recordFromProjection(
  experimentId: string,
  evalId: string,
  projection: import("../coordination/platform/sqlite-coordination.ts").CaseLockProjection | undefined,
): CaseLockRecord | undefined {
  return projection === undefined
    ? undefined
    : {
        experimentId,
        evalId,
        ...projection.owner,
        startedAt: projection.acquiredAt,
        heartbeatAt: projection.heartbeatAt,
      };
}

export function readCaseLockEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
): Effect.Effect<CaseLockRecord | undefined, CaseLockError, ProjectStateDatabase> {
  return caseEffect(niceevalRoot, (facet) =>
    facet.execute({ _tag: "case-read", caseId: caseId(experimentId, evalId) }),
  ).pipe(
    Effect.map((projection) =>
      recordFromProjection(
        experimentId,
        evalId,
        projection as import("../coordination/platform/sqlite-coordination.ts").CaseLockProjection | undefined,
      ),
    ),
  );
}

/** Heartbeat age is observational and can never establish owner death. */
export function isCaseLockExpired(_record: CaseLockRecord, _nowMs: number): boolean {
  return false;
}

export interface CaseLockEffectClaim {
  readonly release: Effect.Effect<void, CaseLockError>;
}
export interface AcquireCaseLockEffectResult {
  readonly claim: CaseLockEffectClaim;
  readonly takenOver: boolean;
}

type AcquireOnce =
  | { readonly kind: "acquired"; readonly owner: FencedOwner; readonly takenOver: boolean }
  | { readonly kind: "waiting"; readonly holder: CaseLockRecord }
  | { readonly kind: "retry" };

function isConflict(cause: CaseLockError): cause is SqliteRecordError & { code: "record-command-conflict" } {
  return cause._tag === "SqliteRecordError" && cause.code === "record-command-conflict";
}

function writeCaseOwner(
  root: string,
  command: Extract<CaseCoordinationCommand, { _tag: "case-acquire" | "case-takeover" }>,
  owner: FencedOwner,
): Effect.Effect<FencedOwner, CaseLockError, ProjectStateDatabase> {
  return Effect.gen(function* () {
    const database = yield* ProjectStateDatabase;
    const { caseCoordination, record } = yield* database.bind(root);
    return yield* Effect.tryPromise({
      try: () => caseCoordination.execute<FencedOwner>(command),
      catch: caseLockError,
    }).pipe(
      Effect.tapError((cause) => {
        // An acknowledged command rejection rolled back. A lost reply leaves
        // the outcome unknown, so undo only this request's exact acquisition.
        if (cause._tag === "SqliteRecordError" && cause.code !== "record-sqlite-error") return Effect.void;
        const undo = (facet: CaseCoordinationFacet) =>
          facet.execute<undefined>({
            _tag: "case-release",
            caseId: command.caseId,
            owner,
            unacknowledgedAcquiredAt: command.at,
            deadlineEpochMs: Date.now() + 30_000,
          });
        return Effect.tryPromise({
          try: () => undo(caseCoordination),
          catch: caseLockError,
        }).pipe(
          Effect.catch((failure) => {
            if (!record.closed) return Effect.fail(failure);
            // The old worker must stop before we check for a committed acquisition.
            return Effect.tryPromise({ try: () => record.close(), catch: caseLockError }).pipe(
              Effect.andThen(caseEffect(root, undo).pipe(Effect.provide(ProjectStateDatabaseLive, { local: true }))),
            );
          }),
        );
      }),
    );
  });
}

export function tryAcquireCaseLockOnceEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  identity: ProcessOwnerIdentity,
  nowMs: number,
): Effect.Effect<AcquireOnce, CaseLockError, ProjectStateDatabase> {
  const id = caseId(experimentId, evalId);
  const at = new Date(nowMs).toISOString();
  const readHolder = readCaseLockEffect(niceevalRoot, experimentId, evalId);
  return Effect.gen(function* (): Effect.fn.Return<AcquireOnce, CaseLockError, ProjectStateDatabase> {
    const acquired = yield* Effect.result(
      writeCaseOwner(
        niceevalRoot,
        { _tag: "case-acquire", caseId: id, owner: identity, at, deadlineEpochMs: Date.now() + 30_000 },
        { ...identity, generation: 1 },
      ),
    );
    if (Result.isSuccess(acquired)) return { kind: "acquired", owner: acquired.success, takenOver: false };
    if (!isConflict(acquired.failure) || acquired.failure.operation !== "case-acquire")
      return yield* Effect.fail(acquired.failure);
    const holder = yield* readHolder;
    if (holder === undefined) return { kind: "retry" };
    if (exactProcessState(holder) !== "dead") return { kind: "waiting", holder };

    const takeover = yield* Effect.result(
      writeCaseOwner(
        niceevalRoot,
        {
          _tag: "case-takeover",
          caseId: id,
          deadOwner: holder,
          replacement: identity,
          at,
          deadlineEpochMs: Date.now() + 30_000,
        },
        { ...identity, generation: holder.generation + 1 },
      ),
    );
    if (Result.isSuccess(takeover)) return { kind: "acquired", owner: takeover.success, takenOver: true };
    if (!isConflict(takeover.failure) || takeover.failure.operation !== "case-takeover")
      return yield* Effect.fail(takeover.failure);
    return { kind: "retry" };
  });
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
  return Effect.raceFirst(
    Effect.sleep(milliseconds),
    Effect.callback<void, Error>((resume) => {
      const onAbort = () => resume(Effect.fail(abortError(signal)));
      signal.addEventListener("abort", onAbort, { once: true });
      return Effect.sync(() => signal.removeEventListener("abort", onAbort));
    }),
  );
}

const held = new Map<string, Effect.Effect<void, CaseLockError>>();

export function acquireCaseLockEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  identity: Pick<ProcessOwnerIdentity, "pid" | "host"> & Partial<ProcessOwnerIdentity>,
  opts: {
    readonly signal?: AbortSignal | undefined;
    readonly pollIntervalMs?: number | undefined;
    readonly heartbeatIntervalMs?: number | undefined;
    readonly onWaitStart?: ((holder: CaseLockRecord) => void) | undefined;
  } = {},
): Effect.Effect<AcquireCaseLockEffectResult, CaseLockError | Error, ProjectStateDatabase> {
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? CASE_LOCK_HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? heartbeatIntervalMs;
  const onWaitStart = opts.onWaitStart ?? (() => {});
  return Effect.suspend(() => {
    const ownerIdentity =
      identity.ownerId !== undefined && identity.bootId !== undefined && identity.processStart !== undefined
        ? { ...identity, ownerId: identity.ownerId, bootId: identity.bootId, processStart: identity.processStart }
        : currentProcessOwnerIdentity();
    let undelivered: CaseLockEffectClaim | undefined;
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const database = yield* ProjectStateDatabase;
        const facets = yield* database.bind(niceevalRoot);
        const acquired = yield* Effect.gen(function* () {
          let waiting = false;
          for (;;) {
            // The SQLite write and handle setup stay together. Waiting and
            // restarting after another writer wins remain interruptible.
            yield* restore(Effect.void);
            if (opts.signal?.aborted) return yield* Effect.fail(abortError(opts.signal));
            const now = yield* Clock.currentTimeMillis;
            const result = yield* tryAcquireCaseLockOnceEffect(niceevalRoot, experimentId, evalId, ownerIdentity, now);
            if (result.kind === "acquired") return result;
            if (result.kind === "retry") continue;
            if (!waiting) {
              waiting = true;
              onWaitStart(result.holder);
            }
            yield* restore(delayOrAbort(pollIntervalMs, opts.signal));
          }
        });
        const { owner, takenOver } = acquired;
        const id = caseId(experimentId, evalId);
        const key = `${niceevalRoot}\u0000${id}`;
        let released = false;
        const renew = Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            Effect.tryPromise({
              try: () =>
                facets.caseCoordination.execute({
                  _tag: "case-heartbeat",
                  caseId: id,
                  owner,
                  at: new Date(now).toISOString(),
                  deadlineEpochMs: Date.now() + 30_000,
                }),
              catch: caseLockError,
            }),
          ),
        );
        return yield* Effect.forkChild(
          Effect.forever(Effect.sleep(heartbeatIntervalMs).pipe(Effect.andThen(renew.pipe(Effect.ignore)))),
        ).pipe(
          Effect.map((fiber) => {
            const releaseMutex = Semaphore.makeUnsafe(1);
            const releaseRow = Effect.tryPromise({
              try: () =>
                facets.caseCoordination.execute<undefined>({
                  _tag: "case-release",
                  caseId: id,
                  owner,
                  deadlineEpochMs: Date.now() + 30_000,
                }),
              catch: caseLockError,
            }).pipe(
              Effect.catch((cause) => {
                if (!isConflict(cause)) return Effect.fail(cause);
                // A committed release can lose its reply. An absent or superseded
                // owner completes this handle without mutating the successor.
                return readCaseLockEffect(niceevalRoot, experimentId, evalId).pipe(
                  Effect.provideService(ProjectStateDatabase, database),
                  Effect.flatMap((current) =>
                    current?.ownerId === owner.ownerId && current.generation === owner.generation
                      ? Effect.fail(cause)
                      : Effect.void,
                  ),
                );
              }),
            );
            const release: CaseLockEffectClaim["release"] = releaseMutex
              .withPermits(1)(
                Effect.suspend(() => {
                  if (released || held.get(key) !== release) return Effect.void;
                  return Fiber.interrupt(fiber).pipe(
                    Effect.andThen(releaseRow),
                    Effect.tap(() =>
                      Effect.sync(() => {
                        released = true;
                        if (held.get(key) === release) held.delete(key);
                      }),
                    ),
                  );
                }),
              )
              .pipe(Effect.uninterruptible);
            held.set(key, release);
            const claim = { release };
            undelivered = claim;
            return { claim, takenOver };
          }),
        );
      }),
    ).pipe(Effect.onExitIf(Exit.hasInterrupts, () => undelivered?.release ?? Effect.void));
  });
}

export function drainHeldCaseLocksEffect(): Effect.Effect<number> {
  const releases = [...held.values()];
  return Effect.forEach(releases, (release) => release.pipe(Effect.ignore), { concurrency: "unbounded" }).pipe(
    Effect.as(releases.length),
  );
}

export function pendingHeldCaseLockCount(): number {
  return held.size;
}
