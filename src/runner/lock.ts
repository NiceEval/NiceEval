// 用例锁:防止两条并发 `niceeval exp` Invocation 双派发同一个 (experimentId, evalId)。
// 建在 ../shared/entry-file-store.ts 的原子写/认领原语之上,本模块只写锁独有的语义——O_EXCL
// 原子创建、心跳续租、过期判据、过期锁的 rename 接管、释放。
// 契约见 docs/feature/experiments/architecture.md「并发 Invocation:用例锁」。

import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { claimEntryFile, fsyncDir, readEntryFile, slugHashEntryId, writeEntryFile } from "../shared/entry-file-store.ts";

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
export const CASE_LOCK_STALE_MS = 30_000;

export function locksDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "locks");
}

function caseLockEntryId(experimentId: string, evalId: string): string {
  return slugHashEntryId(`${experimentId}-${evalId}`, [experimentId, evalId]);
}

/** 读取当前锁记录,无副作用——`--dry` 用它只读锁目录标注 `locked`,不取锁、不等待。 */
export async function readCaseLock(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
): Promise<CaseLockRecord | undefined> {
  return readEntryFile(
    locksDirOf(niceevalRoot),
    caseLockEntryId(experimentId, evalId),
    decodeCaseLockRecord(experimentId, evalId),
  );
}

/** 过期判据:只看心跳时间戳,不看 pid(容器/跨用户场景下 pid 判活不可靠)。
 * 落后严格大于阈值才算过期(`>`,不是 `>=`);无法解析的 `heartbeatAt` 一律视为过期。 */
export function isCaseLockStale(record: CaseLockRecord, nowMs: number): boolean {
  const heartbeatMs = Date.parse(record.heartbeatAt);
  if (Number.isNaN(heartbeatMs)) return true;
  return nowMs - heartbeatMs > CASE_LOCK_STALE_MS;
}

export interface CaseLockClaim {
  /** 停止心跳定时器并删除锁文件。幂等——重复调用是 no-op。 */
  release(): Promise<void>;
}

export interface AcquireCaseLockResult {
  claim: CaseLockClaim;
  /** true 当且仅当本次调用接管了一把过期锁,而不是全新创建。 */
  takenOver: boolean;
}

/**
 * O_EXCL 独占创建锁文件;已存在则返回 false,不覆盖、不抛错。不走共享层的 `writeEntryFile`
 * ——那是「写入或覆盖」的语义(rename 会无条件替换目标),这里需要的是「不存在才创建」,与
 * sandbox/keep-registry.ts 的 lease 占坑(`open(path, "wx")`)同一个模式。
 */
async function createLockFileExclusive(dir: string, id: string, record: CaseLockRecord): Promise<boolean> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.json`);
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(JSON.stringify(record, null, 2), "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  await fsyncDir(dir);
  return true;
}

/**
 * 一次非阻塞尝试:先原子创建锁文件(O_EXCL)。已存在且新鲜 → `{kind:"waiting", holder}`。
 * 已存在且过期 → 经 `claimEntryFile`(rename-墓碑)尝试接管,接管成功后立刻在原路径用
 * `identity` 重建;接管竞争落败(claim 拿到 false,或重建本身撞上 EEXIST——说明另一个赢家
 * 已经抢先写回)都不报错,而是原地递归一次重新评估当前状态。
 */
export async function tryAcquireCaseLockOnce(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  identity: { pid: number; host: string },
  nowMs: number,
): Promise<{ kind: "acquired"; takenOver: boolean } | { kind: "waiting"; holder: CaseLockRecord }> {
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

  if (await createLockFileExclusive(dir, id, record)) {
    return { kind: "acquired", takenOver: false };
  }

  const existing = await readEntryFile(dir, id, decodeCaseLockRecord(experimentId, evalId));
  if (existing === undefined) {
    // O_EXCL 失败之后、读回之前锁可能已被正常释放，也可能是 decoder 拒绝的坏条目；后者
    // 先经 rename 认领移除，不能让坏文件把后续重试卡成永久递归。
    await claimEntryFile(dir, id);
    return tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, identity, nowMs);
  }
  if (!isCaseLockStale(existing, nowMs)) {
    return { kind: "waiting", holder: existing };
  }

  const claimed = await claimEntryFile(dir, id);
  if (!claimed) {
    // 认领竞争落败:锁在我们读到之后、claim 之前已被别人接管或释放,重新评估当前状态。
    return tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, identity, nowMs);
  }
  if (!(await createLockFileExclusive(dir, id, record))) {
    // 罕见:claim 成功后、重建之前另一个赢家已经抢先写回原路径,重新评估当前状态。
    return tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, identity, nowMs);
  }
  return { kind: "acquired", takenOver: true };
}

/**
 * `isReleased` 是 `acquireCaseLock` 闭包里 `released` 标志的读取器。`release()` 只
 * `clearInterval`,拦不住已经进入回调、卡在 `readEntryFile` 这次 await 上的心跳——它读完时
 * 锁文件可能已被 `rm`,若不再确认就直接写回,会把刚删掉的文件重新创建出来(见
 * memory/lock-heartbeat-resurrects-released-lock.md)。因此写回前必须再查一次;入口也查一次
 * 省一次读,但不是竞态的关键检查点。
 */
async function renewHeartbeat(
  niceevalRoot: string,
  experimentId: string,
  evalId: string,
  nowMs: number,
  isReleased: () => boolean,
): Promise<void> {
  if (isReleased()) return;
  const dir = locksDirOf(niceevalRoot);
  const id = caseLockEntryId(experimentId, evalId);
  const current = await readEntryFile(dir, id, decodeCaseLockRecord(experimentId, evalId));
  if (current === undefined) return; // 锁已经不在了(已释放或被接管),没有心跳可续
  if (isReleased()) return; // 释放发生在上面这次 await 期间——写回之前的最后一道闸
  const next: CaseLockRecord = { ...current, heartbeatAt: new Date(nowMs).toISOString() };
  await writeEntryFile(dir, id, next);
}

function makeAbortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("aborted while waiting for case lock");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw makeAbortError(signal);
}

/** 可被 AbortSignal 中断的延时;abort 时立刻 reject,不留下悬挂的定时器。 */
function delayOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(makeAbortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(makeAbortError(signal));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// 当前进程持有中的锁,供 drainHeldCaseLocks 强清兜底排空——与 experiment-cleanup-registry.ts
// 的 pending 表同一个模式:登记释放闭包,正常释放时自己注销,强清路径统一排空。
const held = new Map<string, () => Promise<void>>();

function heldKey(niceevalRoot: string, id: string): string {
  return `${niceevalRoot} ${id}`;
}

/**
 * 高层入口:立刻取锁,或者每 `pollIntervalMs`(默认等于心跳周期)重试一次 `tryAcquireCaseLockOnce`
 * 直到取到为止。没有超时——心跳新鲜就一直等(架构文档明确要求)。`onWaitStart(holder)` 只在
 * 第一次尝试就撞上新鲜锁时触发一次(不是每次轮询都触发),取锁成功(不论是新建还是接管)都不会
 * 触发。取锁成功后启动心跳续租定时器(只重写 `heartbeatAt`,其余字段原样保留),并把释放闭包
 * 登记进模块内的「本进程持有中」表(供 `drainHeldCaseLocks` 使用)。必须响应 `opts.signal`:
 * 等待期间被中断要立刻停止轮询、以 AbortError 形状的错误 reject,不留下悬挂的定时器——真实的
 * 用户 Ctrl+C 不能被别人的锁拖着无限期挂起。
 */
export async function acquireCaseLock(
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
): Promise<AcquireCaseLockResult> {
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? CASE_LOCK_HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? heartbeatIntervalMs;
  const { signal } = opts;

  throwIfAborted(signal);

  let waitStarted = false;
  let takenOver = false;
  for (;;) {
    const result = await tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, identity, Date.now());
    if (result.kind === "acquired") {
      takenOver = result.takenOver;
      break;
    }
    if (!waitStarted) {
      waitStarted = true;
      opts.onWaitStart?.(result.holder);
    }
    await delayOrAbort(pollIntervalMs, signal);
  }

  const dir = locksDirOf(niceevalRoot);
  const id = caseLockEntryId(experimentId, evalId);
  const key = heldKey(niceevalRoot, id);

  // `inFlight` 追踪当前正在飞的心跳续租调用。仅在写回前查一次 `released` 不够:一旦某次心跳
  // 通过了检查、开始调用 `writeEntryFile`,该调用内部(mkdir/写临时文件/rename)本身还有多个
  // await 点——release() 可能在这些 await 之间跑完 `rm`,随后心跳的 rename 落地,把刚删掉的
  // 文件重新创建出来。真正堵住这条缝的办法不是"检查更早",而是让 release() 在删除之前等所有
  // 已发起的心跳调用结束,保证不会有写回落在 rm 之后。
  let released = false;
  const inFlight = new Set<Promise<void>>();
  const timer = setInterval(() => {
    if (released) return;
    const task = renewHeartbeat(niceevalRoot, experimentId, evalId, Date.now(), () => released).catch(() => {
      // 心跳续租失败(如磁盘瞬时错误)不应该让定时器本身崩溃;下一个周期再试。
    });
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
  }, heartbeatIntervalMs);
  timer.unref?.();

  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    clearInterval(timer);
    held.delete(key);
    await Promise.all(inFlight); // 等在飞心跳全部落地(写或不写),再删——不然写回可能晚于 rm
    await rm(join(dir, `${id}.json`), { force: true });
    await fsyncDir(dir);
  };
  held.set(key, release);

  return { claim: { release }, takenOver };
}

/**
 * 强清兜底:释放当前进程持有的每一把锁(尽力而为,单条失败不影响其它;幂等,空表也安全)。
 * 与 experiment-cleanup-registry.ts 的 `drainExperimentTeardowns` 同一个精神。返回本次排空的条数。
 */
export async function drainHeldCaseLocks(): Promise<number> {
  const releases = [...held.values()];
  await Promise.allSettled(releases.map((release) => release()));
  return releases.length;
}

/** 测试探针,镜像 `pendingExperimentTeardownCount`。 */
export function pendingHeldCaseLockCount(): number {
  return held.size;
}
