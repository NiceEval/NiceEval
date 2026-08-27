// 用例锁:防止两条并发 `niceeval exp` Invocation 双派发同一个 (experimentId, evalId)。
// 建在 ../shared/entry-file-store.ts 的原子写/认领原语之上,本模块只写锁独有的语义——O_EXCL
// 原子创建、心跳续租、过期判据、过期锁的 rename 接管、释放。
// 契约见 docs/feature/experiments/architecture.md「并发 Invocation:用例锁」。

import { mkdir, open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Effect, Fiber } from "effect";
import {
  claimEntryFileEffect,
  fsyncDirEffect,
  readEntryFileEffect,
  slugHashEntryId,
  writeEntryFileEffect,
} from "../shared/entry-file-store.ts";

/** 锁文件的 JSON 形状。身份的权威在内容,文件名只须无碰撞、不承载解析。 */
export interface CaseLockRecord {
  experimentId: string;
  evalId: string;
  pid: number;
  host: string;
  startedAt: string; // ISO
  heartbeatAt: string; // ISO
}

function recordOf(value: unknown): globalThis.Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as globalThis.Record<string, unknown>
    : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function errnoCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

function nodeIo<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: operation, catch: (cause) => cause });
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

/** 只接受本锁身份对应的完整记录，避免错位或半截 JSON 被当成持有者。 */
function decodeCaseLockRecord(experimentId: string, evalId: string) {
  return (value: unknown): CaseLockRecord | undefined => {
    const record = recordOf(value);
    if (
      record === undefined ||
      record.experimentId !== experimentId ||
      record.evalId !== evalId ||
      !isPositiveInteger(record.pid) ||
      typeof record.host !== "string" ||
      !isTimestamp(record.startedAt) ||
      !isTimestamp(record.heartbeatAt)
    ) {
      return undefined;
    }
    return {
      experimentId,
      evalId,
      pid: record.pid,
      host: record.host,
      startedAt: record.startedAt,
      heartbeatAt: record.heartbeatAt,
    };
  };
}

/** 持有者续租心跳的周期。 */
export const CASE_LOCK_HEARTBEAT_INTERVAL_MS = 10_000;
/** `heartbeatAt` 落后当前时间超过这个阈值(三个心跳周期)即视为持有者已死。 */
export const CASE_LOCK_EXPIRY_MS = 30_000;

export function locksDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "locks");
}

function caseLockEntryId(experimentId: string, evalId: string): string {
  return slugHashEntryId(`${experimentId}-${evalId}`, [experimentId, evalId]);
}

/** Effect 主 API:读取当前锁记录,无副作用——`--dry` 用它只读锁目录标注 `locked`,不取锁、不等待。 */
export function readCaseLockEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
): Effect.Effect<CaseLockRecord | undefined, unknown> {
  return readEntryFileEffect(
    locksDirOf(niceevalRoot),
    caseLockEntryId(experimentId, evalId),
    decodeCaseLockRecord(experimentId, evalId),
  );
}

/** 过期判据:只看心跳时间戳,不看 pid(容器/跨用户场景下 pid 判活不可靠)。 */
export function isCaseLockExpired(record: CaseLockRecord, nowMs: number): boolean {
  const heartbeatMs = Date.parse(record.heartbeatAt);
  if (Number.isNaN(heartbeatMs)) return true;
  return nowMs - heartbeatMs > CASE_LOCK_EXPIRY_MS;
}

/** Effect 持有句柄；release 是 Effect finalizer，供运行器的外层 Scope / ensuring 组合。 */
export interface CaseLockEffectClaim {
  readonly release: Effect.Effect<void, unknown>;
}

export interface AcquireCaseLockEffectResult {
  claim: CaseLockEffectClaim;
  /** true 当且仅当本次调用接管了一把过期锁,而不是全新创建。 */
  takenOver: boolean;
}

/**
 * O_EXCL 独占创建锁文件;已存在则返回 false,不覆盖、不抛错。不走共享层的 `writeEntryFile`
 * ——那是「写入或覆盖」的语义(rename 会无条件替换目标),这里需要的是「不存在才创建」。
 */
function createLockFileExclusiveEffect(
  dir: string,
  id: string,
  record: CaseLockRecord,
): Effect.Effect<boolean, unknown> {
  const path = join(dir, `${id}.json`);
  return nodeIo(() => mkdir(dir, { recursive: true })).pipe(
    Effect.andThen(
      withOpenFile(
        path,
        "wx",
        (handle) => nodeIo(() => handle.writeFile(JSON.stringify(record, null, 2), "utf-8")).pipe(
          Effect.andThen(nodeIo(() => handle.sync())),
        ),
      ),
    ),
    Effect.andThen(fsyncDirEffect(dir)),
    Effect.as(true),
    Effect.catch((cause) => errnoCode(cause) === "EEXIST" ? Effect.succeed(false) : Effect.fail(cause)),
  );
}

/** 一次非阻塞尝试:新建、过期接管与损坏条目回收都保持原来的 rename 互斥语义。 */
export function tryAcquireCaseLockOnceEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  identity: { pid: number; host: string },
  nowMs: number,
): Effect.Effect<{ kind: "acquired"; takenOver: boolean } | { kind: "waiting"; holder: CaseLockRecord }, unknown> {
  const dir = locksDirOf(niceevalRoot);
  const id = caseLockEntryId(experimentId, evalId);
  const record: CaseLockRecord = {
    experimentId,
    evalId,
    pid: identity.pid,
    host: identity.host,
    startedAt: new Date(nowMs).toISOString(),
    heartbeatAt: new Date(nowMs).toISOString(),
  };
  return Effect.suspend(() => createLockFileExclusiveEffect(dir, id, record).pipe(
    Effect.flatMap((created) => {
      if (created) return Effect.succeed({ kind: "acquired" as const, takenOver: false });
      return readEntryFileEffect(dir, id, decodeCaseLockRecord(experimentId, evalId)).pipe(
        Effect.flatMap((existing) => {
          if (existing === undefined) {
            // O_EXCL 失败后锁可能正常释放，也可能是坏条目；认领后重新评估当前状态。
            return claimEntryFileEffect(dir, id).pipe(
              Effect.ignore,
              Effect.andThen(tryAcquireCaseLockOnceEffect(niceevalRoot, experimentId, evalId, identity, nowMs)),
            );
          }
          if (!isCaseLockExpired(existing, nowMs)) return Effect.succeed({ kind: "waiting" as const, holder: existing });
          return claimEntryFileEffect(dir, id).pipe(
            Effect.flatMap((claimed) => claimed
              ? createLockFileExclusiveEffect(dir, id, record).pipe(
                  Effect.flatMap((rebuilt) => rebuilt
                    ? Effect.succeed({ kind: "acquired" as const, takenOver: true })
                    : tryAcquireCaseLockOnceEffect(niceevalRoot, experimentId, evalId, identity, nowMs)),
                )
              : tryAcquireCaseLockOnceEffect(niceevalRoot, experimentId, evalId, identity, nowMs)),
          );
        }),
      );
    }),
  ));
}

/**
 * 只重写 `heartbeatAt`。心跳以单一 Effect fiber 串行执行，因此 release 可以先中断休眠，再等
 * 当前不可中断写入结束，最后删除文件，不会重现已释放锁被旧心跳写回的竞态。
 */
function renewHeartbeatEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  nowMs: number,
  isReleased: () => boolean,
): Effect.Effect<void, unknown> {
  if (isReleased()) return Effect.void;
  const dir = locksDirOf(niceevalRoot);
  const id = caseLockEntryId(experimentId, evalId);
  return readEntryFileEffect(dir, id, decodeCaseLockRecord(experimentId, evalId)).pipe(
    Effect.flatMap((current) => {
      if (current === undefined || isReleased()) return Effect.void;
      const next: CaseLockRecord = { ...current, heartbeatAt: new Date(nowMs).toISOString() };
      return writeEntryFileEffect(dir, id, next);
    }),
  );
}

function makeAbortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("aborted while waiting for case lock");
  err.name = "AbortError";
  return err;
}

function awaitAbort(signal: AbortSignal | undefined): Effect.Effect<never, Error> {
  if (signal === undefined) return Effect.never;
  return Effect.callback((resume, effectSignal) => {
    let completed = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      effectSignal.removeEventListener("abort", onEffectAbort);
    };
    const cancel = (): void => {
      if (completed) return;
      completed = true;
      cleanup();
    };
    const onAbort = (): void => {
      if (completed) return;
      cancel();
      resume(Effect.fail(makeAbortError(signal)));
    };
    const onEffectAbort = (): void => cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    effectSignal.addEventListener("abort", onEffectAbort, { once: true });
    // Both listeners must be live before inspecting either signal: otherwise
    // an abort between inspection and registration could strand the waiter.
    if (effectSignal.aborted) onEffectAbort();
    else if (signal.aborted) onAbort();
    return Effect.sync(cancel);
  });
}

/** 可被外部 AbortSignal 或 Effect interruption 立刻打断的轮询延时。 */
function delayOrAbortEffect(ms: number, signal: AbortSignal | undefined): Effect.Effect<void, Error> {
  if (signal?.aborted) return Effect.fail(makeAbortError(signal));
  return Effect.raceFirst(Effect.sleep(ms), awaitAbort(signal)).pipe(Effect.asVoid);
}

// 当前进程持有中的锁,供 drainHeldCaseLocksEffect 强清兜底排空。值是 Effect release。
const held = new Map<string, Effect.Effect<void, unknown>>();

function heldKey(niceevalRoot: string, id: string): string {
  return `${niceevalRoot} ${id}`;
}

/**
 * 高层 Effect 入口。等待保持可中断；一旦拿到锁，心跳 fiber 与 release 的删除顺序进入
 * uninterruptible mask，保证 interruption 不会留下无主锁或让旧心跳晚于删除写回。
 */
export function acquireCaseLockEffect(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  identity: { pid: number; host: string },
  opts: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
    onWaitStart?: (holder: CaseLockRecord) => void;
  } = {},
): Effect.Effect<AcquireCaseLockEffectResult, unknown> {
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? CASE_LOCK_HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? heartbeatIntervalMs;
  let waitStarted = false;
  const acquire = (): Effect.Effect<{ takenOver: boolean }, unknown> => Effect.suspend(() => {
    if (opts.signal?.aborted) return Effect.fail(makeAbortError(opts.signal));
    return Clock.currentTimeMillis.pipe(
      Effect.flatMap((nowMs) => tryAcquireCaseLockOnceEffect(niceevalRoot, experimentId, evalId, identity, nowMs)),
      Effect.flatMap((result) => {
        if (result.kind === "acquired") return Effect.succeed({ takenOver: result.takenOver });
        const reportWait = waitStarted
          ? Effect.void
          : Effect.sync(() => {
              waitStarted = true;
              opts.onWaitStart?.(result.holder);
            });
        return reportWait.pipe(Effect.andThen(delayOrAbortEffect(pollIntervalMs, opts.signal)), Effect.andThen(acquire()));
      }),
    );
  });

  return Effect.uninterruptibleMask((restore) =>
    restore(acquire()).pipe(
      Effect.flatMap(({ takenOver }) => {
        const dir = locksDirOf(niceevalRoot);
        const id = caseLockEntryId(experimentId, evalId);
        const key = heldKey(niceevalRoot, id);
        let released = false;
        const heartbeat = Effect.forever(
          Effect.sleep(heartbeatIntervalMs).pipe(
            Effect.andThen(
              // File-system promises do not guarantee AbortSignal support. Keep one renewal uninterruptible so
              // Fiber.interrupt below waits for any started write before rm can make the path reusable.
              Effect.uninterruptible(
                Clock.currentTimeMillis.pipe(
                  Effect.flatMap((nowMs) => renewHeartbeatEffect(
                    niceevalRoot,
                    experimentId,
                    evalId,
                    nowMs,
                    () => released,
                  )),
                ),
              ).pipe(Effect.ignore),
            ),
          ),
        );
        // A child inherits the parent's interruptibility. This branch still
        // runs under the acquisition mask, so restore the heartbeat before
        // forking; otherwise release would wait forever while interrupting an
        // uninterruptible sleeping fiber.
        return Effect.forkDetach(restore(heartbeat)).pipe(
          Effect.map((fiber) => {
            const release = Effect.uninterruptible(Effect.suspend(() => {
              if (released) return Effect.void;
              released = true;
              held.delete(key);
              return Fiber.interrupt(fiber).pipe(
                Effect.andThen(nodeIo(() => rm(join(dir, `${id}.json`), { force: true }))),
                Effect.andThen(fsyncDirEffect(dir)),
              );
            }));
            held.set(key, release);
            return { claim: { release }, takenOver };
          }),
        );
      }),
    ),
  );
}

/** 强清兜底:尽力释放当前进程持有的每一把锁。 */
export function drainHeldCaseLocksEffect(): Effect.Effect<number> {
  const releases = [...held.values()];
  return Effect.forEach(releases, (release) => Effect.exit(release), { discard: true }).pipe(Effect.as(releases.length));
}

/** 当前进程仍持有的用例锁数量，供退出清理与可观察状态汇总。 */
export function pendingHeldCaseLockCount(): number {
  return held.size;
}
