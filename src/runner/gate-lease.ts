// 实验闸租约:把实验级 `maxConcurrency` 的 N 个名额做成跨 Invocation 共用的逐槽租约。
// 与 ./lock.ts 的用例锁同一套文件纪律(O_EXCL 独占创建、心跳续租、过期判据、rename 接管、
// 释放即删除),建在 ../shared/entry-file-store.ts 的原语之上,不复制第三份纪律。
// 契约见 docs/feature/experiments/architecture.md「并发 Invocation:用例锁」末条与
// docs/runner.md#调度有界并发。

import { mkdir, open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Effect, Fiber } from "effect";
import {
  claimEntryFileEffect,
  fsyncDirEffect,
  readAllEntryFilesEffect,
  readEntryFileEffect,
  slugHashEntryId,
  writeEntryFileEffect,
} from "../shared/entry-file-store.ts";
import { CASE_LOCK_EXPIRY_MS, CASE_LOCK_HEARTBEAT_INTERVAL_MS, locksDirOf } from "./lock.ts";

/** 逐槽租约文件的 JSON 形状。身份的权威在内容,文件名只须无碰撞、不承载解析。 */
export interface GateLeaseRecord {
  experimentId: string;
  /** 槽位序号,取值 0..N-1。 */
  slot: number;
  /** 本持有者 resolved 的名额上限 N。用于 min-N:生效名额取在场声明的最小值。 */
  declaredN: number;
  pid: number;
  host: string;
  startedAt: string; // ISO
  heartbeatAt: string; // ISO
}

type GateSlotAcquired = {
  kind: "acquired";
  slot: number;
  takenOver: boolean;
  takenOverFrom?: GateLeaseRecord;
  record: GateLeaseRecord;
};

type GateSlotAttempt = GateSlotAcquired | { kind: "full"; holders: GateLeaseRecord[] };

function recordOf(value: unknown): globalThis.Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as globalThis.Record<string, unknown>
    : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSlot(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

/** 验证租约的全部持久字段；按槽读取时还会核对身份，防止错位记录冒充当前持有者。 */
function decodeGateLeaseRecord(
  value: unknown,
  expected: { experimentId?: string; slot?: number } = {},
): GateLeaseRecord | undefined {
  const record = recordOf(value);
  if (
    record === undefined ||
    typeof record.experimentId !== "string" ||
    !isSlot(record.slot) ||
    !isPositiveInteger(record.declaredN) ||
    !isPositiveInteger(record.pid) ||
    typeof record.host !== "string" ||
    !isTimestamp(record.startedAt) ||
    !isTimestamp(record.heartbeatAt) ||
    (expected.experimentId !== undefined && record.experimentId !== expected.experimentId) ||
    (expected.slot !== undefined && record.slot !== expected.slot)
  ) {
    return undefined;
  }
  return {
    experimentId: record.experimentId,
    slot: record.slot,
    declaredN: record.declaredN,
    pid: record.pid,
    host: record.host,
    startedAt: record.startedAt,
    heartbeatAt: record.heartbeatAt,
  };
}

/** 持有者续租心跳的周期。与用例锁同参数。 */
export const GATE_LEASE_HEARTBEAT_INTERVAL_MS = CASE_LOCK_HEARTBEAT_INTERVAL_MS;
/** `heartbeatAt` 落后当前时间超过这个阈值(三个心跳周期)即视为持有者已死。 */
export const GATE_LEASE_EXPIRY_MS = CASE_LOCK_EXPIRY_MS;

export function gateLeasesDirOf(niceevalRoot: string): string {
  return locksDirOf(niceevalRoot);
}

function gateLeaseEntryId(experimentId: string, slot: number): string {
  return slugHashEntryId(`gate-${experimentId}-${slot}`, ["gate-lease", experimentId, String(slot)]);
}

/** Effect 主 API:读取该实验当前在场的全部租约记录,无副作用。 */
export function readGateLeasesEffect(
  niceevalRoot: string,
  experimentId: string,
): Effect.Effect<GateLeaseRecord[], unknown> {
  return readAllEntryFilesEffect(gateLeasesDirOf(niceevalRoot), decodeGateLeaseRecord).pipe(
    Effect.map((entries) => entries
      .map(({ entry }) => entry)
      .filter((entry) => entry.experimentId === experimentId)
      .sort((a, b) => a.slot - b.slot)),
  );
}

/** 过期判据:只看心跳时间戳,不看 pid。 */
export function isGateLeaseExpired(record: GateLeaseRecord, nowMs: number): boolean {
  const heartbeatMs = Date.parse(record.heartbeatAt);
  if (Number.isNaN(heartbeatMs)) return true;
  return nowMs - heartbeatMs > GATE_LEASE_EXPIRY_MS;
}

/** 本进程声明的 N:非法值收敛到 1，避免永久满位。 */
function normalizeN(n: number): number {
  const floored = Math.floor(n);
  return Number.isFinite(floored) && floored >= 1 ? floored : 1;
}

/** min-N:有效名额取自己声明和所有新鲜租约声明的最小值。 */
function effectiveSlotCount(maxConcurrency: number, leases: readonly GateLeaseRecord[], nowMs: number): number {
  let n = normalizeN(maxConcurrency);
  for (const lease of leases) {
    if (isGateLeaseExpired(lease, nowMs)) continue;
    const declared = normalizeN(lease.declaredN);
    if (declared < n) n = declared;
  }
  return n;
}

/** O_EXCL 独占创建租约文件;存在时返回 false,不覆盖。 */
function createLeaseFileExclusiveEffect(
  dir: string,
  id: string,
  record: GateLeaseRecord,
): Effect.Effect<boolean, unknown> {
  const path = join(dir, `${id}.json`);
  return nodeIo(() => mkdir(dir, { recursive: true })).pipe(
    Effect.zipRight(
      withOpenFile(
        path,
        "wx",
        (handle) => nodeIo(() => handle.writeFile(JSON.stringify(record, null, 2), "utf-8")).pipe(
          Effect.zipRight(nodeIo(() => handle.sync())),
        ),
      ),
    ),
    Effect.zipRight(fsyncDirEffect(dir)),
    Effect.as(true),
    Effect.catchAll((cause) => errnoCode(cause) === "EEXIST" ? Effect.succeed(false) : Effect.fail(cause)),
  );
}

/** 同一持有者判定:身份(pid/host)加上取位时刻——接管重建后 `startedAt` 必然不同。 */
function isSameHolder(record: GateLeaseRecord, mine: GateLeaseRecord): boolean {
  return record.pid === mine.pid && record.host === mine.host && record.startedAt === mine.startedAt;
}

/** 一次非阻塞取位:空槽 O_EXCL 创建，满位时只接管过期或损坏槽。 */
export function tryAcquireGateSlotOnceEffect(
  niceevalRoot: string,
  experimentId: string,
  maxConcurrency: number,
  identity: { pid: number; host: string },
  nowMs: number,
): Effect.Effect<GateSlotAttempt, unknown> {
  const dir = gateLeasesDirOf(niceevalRoot);
  return Effect.gen(function* () {
    const effectiveN = effectiveSlotCount(
      maxConcurrency,
      yield* readGateLeasesEffect(niceevalRoot, experimentId),
      nowMs,
    );
    const stamp = new Date(nowMs).toISOString();
    const recordFor = (slot: number): GateLeaseRecord => ({
      experimentId,
      slot,
      declaredN: normalizeN(maxConcurrency),
      pid: identity.pid,
      host: identity.host,
      startedAt: stamp,
      heartbeatAt: stamp,
    });
    const acquired = (
      slot: number,
      record: GateLeaseRecord,
      options: { takenOver: boolean; takenOverFrom?: GateLeaseRecord },
    ): GateSlotAcquired => ({ kind: "acquired", slot, record, ...options });

    // 第一趟不预读占用情况：O_EXCL 本身就是判据。
    for (let slot = 0; slot < effectiveN; slot += 1) {
      const record = recordFor(slot);
      if (yield* createLeaseFileExclusiveEffect(dir, gateLeaseEntryId(experimentId, slot), record)) {
        return acquired(slot, record, { takenOver: false });
      }
    }

    // 第二趟只对坏条目或过期条目执行 rename 认领；输掉竞态后继续下一槽。
    for (let slot = 0; slot < effectiveN; slot += 1) {
      const id = gateLeaseEntryId(experimentId, slot);
      const current = yield* readEntryFileEffect(dir, id, (value) => decodeGateLeaseRecord(value, { experimentId, slot }));
      if (current === undefined) {
        if (!(yield* claimEntryFileEffect(dir, id))) continue;
        const record = recordFor(slot);
        if (!(yield* createLeaseFileExclusiveEffect(dir, id, record))) continue;
        return acquired(slot, record, { takenOver: false });
      }
      if (!isGateLeaseExpired(current, nowMs)) continue;
      if (!(yield* claimEntryFileEffect(dir, id))) continue;
      const record = recordFor(slot);
      if (!(yield* createLeaseFileExclusiveEffect(dir, id, record))) continue;
      return acquired(slot, record, { takenOver: true, takenOverFrom: current });
    }

    const holders = (yield* readGateLeasesEffect(niceevalRoot, experimentId)).filter(
      (lease) => !isGateLeaseExpired(lease, nowMs),
    );
    return { kind: "full", holders };
  });
}

/** 续租只改 heartbeat；槽被接管后不写、不删别人的租约。 */
function renewHeartbeatEffect(
  dir: string,
  id: string,
  mine: GateLeaseRecord,
  nowMs: number,
  isReleased: () => boolean,
): Effect.Effect<void, unknown> {
  if (isReleased()) return Effect.void;
  return readEntryFileEffect(
    dir,
    id,
    (value) => decodeGateLeaseRecord(value, { experimentId: mine.experimentId, slot: mine.slot }),
  ).pipe(
    Effect.flatMap((current) => {
      if (current === undefined || !isSameHolder(current, mine) || isReleased()) return Effect.void;
      return writeEntryFileEffect(dir, id, { ...current, heartbeatAt: new Date(nowMs).toISOString() });
    }),
  );
}

function makeAbortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("aborted while waiting for experiment gate slot");
  err.name = "AbortError";
  return err;
}

function awaitAbort(signal: AbortSignal | undefined): Effect.Effect<never, Error> {
  return Effect.async((resume, effectSignal) => {
    if (signal === undefined) return;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      effectSignal.removeEventListener("abort", cleanup);
    };
    const onAbort = (): void => {
      cleanup();
      resume(Effect.fail(makeAbortError(signal)));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    effectSignal.addEventListener("abort", cleanup, { once: true });
  });
}

function delayOrAbortEffect(ms: number, signal: AbortSignal | undefined): Effect.Effect<void, Error> {
  if (signal?.aborted) return Effect.fail(makeAbortError(signal));
  return Effect.raceFirst(Effect.sleep(ms), awaitAbort(signal)).pipe(Effect.asVoid);
}

export interface GateLeaseEffectClaim {
  readonly slot: number;
  readonly release: Effect.Effect<void, unknown>;
}

export interface AcquireGateSlotEffectResult {
  claim: GateLeaseEffectClaim;
  takenOver: boolean;
  takenOverFrom?: GateLeaseRecord;
}

const held = new Map<string, Effect.Effect<void, unknown>>();

function heldKey(niceevalRoot: string, id: string): string {
  return `${niceevalRoot} ${id}`;
}

/** 高层 Effect 入口:等待可中断；心跳顺序化，release 等正在飞的不可中断续租结束再删除。 */
export function acquireGateSlotEffect(
  niceevalRoot: string,
  experimentId: string,
  maxConcurrency: number,
  identity: { pid: number; host: string },
  opts: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
    onWaitStart?: (holders: GateLeaseRecord[]) => void;
  } = {},
): Effect.Effect<AcquireGateSlotEffectResult, unknown> {
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? GATE_LEASE_HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? heartbeatIntervalMs;
  let waitStarted = false;
  const acquireLoop = (): Effect.Effect<
    { slot: number; takenOver: boolean; takenOverFrom?: GateLeaseRecord; record: GateLeaseRecord },
    unknown
  > => Effect.suspend(() => {
    if (opts.signal?.aborted) return Effect.fail(makeAbortError(opts.signal));
    return Clock.currentTimeMillis.pipe(
      Effect.flatMap((nowMs) => tryAcquireGateSlotOnceEffect(
        niceevalRoot,
        experimentId,
        maxConcurrency,
        identity,
        nowMs,
      )),
      Effect.flatMap((result) => {
        if (result.kind === "acquired") return Effect.succeed(result);
        const reportWait = waitStarted
          ? Effect.void
          : Effect.sync(() => {
              waitStarted = true;
              opts.onWaitStart?.(result.holders);
            });
        return reportWait.pipe(Effect.zipRight(delayOrAbortEffect(pollIntervalMs, opts.signal)), Effect.zipRight(acquireLoop()));
      }),
    );
  });

  return Effect.uninterruptibleMask((restore) =>
    restore(acquireLoop()).pipe(
      Effect.flatMap(({ slot, takenOver, takenOverFrom, record }) => {
        const dir = gateLeasesDirOf(niceevalRoot);
        const id = gateLeaseEntryId(experimentId, slot);
        const key = heldKey(niceevalRoot, id);
        let released = false;
        const heartbeat = Effect.forever(
          Effect.sleep(heartbeatIntervalMs).pipe(
            Effect.zipRight(
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((nowMs) => Effect.uninterruptible(
                  renewHeartbeatEffect(dir, id, record, nowMs, () => released),
                )),
                Effect.ignore,
              ),
            ),
          ),
        );
        // A child inherits the parent's interruptibility. This branch still
        // runs under the acquisition mask, so restore the heartbeat before
        // forking; otherwise release would wait forever while interrupting an
        // uninterruptible sleeping fiber.
        return Effect.forkDaemon(restore(heartbeat)).pipe(
          Effect.map((fiber) => {
            const release = Effect.uninterruptible(Effect.suspend(() => {
              if (released) return Effect.void;
              released = true;
              held.delete(key);
              return Fiber.interrupt(fiber).pipe(
                Effect.zipRight(readEntryFileEffect(
                  dir,
                  id,
                  (value) => decodeGateLeaseRecord(value, { experimentId, slot }),
                )),
                Effect.flatMap((current) => current !== undefined && !isSameHolder(current, record)
                  ? Effect.void
                  : nodeIo(() => rm(join(dir, `${id}.json`), { force: true })).pipe(Effect.zipRight(fsyncDirEffect(dir)))),
              );
            }));
            held.set(key, release);
            return { claim: { slot, release }, takenOver, ...(takenOverFrom === undefined ? {} : { takenOverFrom }) };
          }),
        );
      }),
    ),
  );
}

/** 强清兜底:尽力释放当前进程持有的每一条租约。 */
export function drainHeldGateLeasesEffect(): Effect.Effect<number> {
  const releases = [...held.values()];
  return Effect.forEach(releases, (release) => Effect.exit(release), { discard: true }).pipe(Effect.as(releases.length));
}

/** 当前进程仍持有的实验闸租约数量，供退出清理与可观察状态汇总。 */
export function pendingHeldGateLeaseCount(): number {
  return held.size;
}
