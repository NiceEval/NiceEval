// 实验闸租约:把实验级 `maxConcurrency` 的 N 个名额做成跨 Invocation 共用的逐槽租约。
// 与 ./lock.ts 的用例锁同一套文件纪律(O_EXCL 独占创建、心跳续租、过期判据、rename 接管、
// 释放即删除),建在 ../shared/entry-file-store.ts 的原语之上,不复制第三份纪律。
// 契约见 docs/feature/experiments/architecture.md「并发 Invocation:用例锁」末条与
// docs/runner.md#调度有界并发。

import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  claimEntryFile,
  fsyncDir,
  readAllEntryFiles,
  readEntryFile,
  slugHashEntryId,
  writeEntryFile,
} from "../shared/entry-file-store.ts";
import { CASE_LOCK_HEARTBEAT_INTERVAL_MS, CASE_LOCK_STALE_MS, locksDirOf } from "./lock.ts";

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

/** 持有者续租心跳的周期。与用例锁同参数。 */
export const GATE_LEASE_HEARTBEAT_INTERVAL_MS = CASE_LOCK_HEARTBEAT_INTERVAL_MS;
/** `heartbeatAt` 落后当前时间超过这个阈值(三个心跳周期)即视为持有者已死。 */
export const GATE_LEASE_STALE_MS = CASE_LOCK_STALE_MS;

export interface GateLeaseClaim {
  /** 实际取到的槽位序号。 */
  slot: number;
  /** 停止心跳定时器并删除租约文件。幂等——重复调用是 no-op。 */
  release(): Promise<void>;
}

export interface AcquireGateSlotResult {
  claim: GateLeaseClaim;
  /** true 当且仅当本次取位接管了一条过期租约,而不是全新创建。 */
  takenOver: boolean;
  /** 被接管的原持有者记录,仅在 `takenOver` 时有值——供 `lock-taken-over` 诊断报出。 */
  takenOverFrom?: GateLeaseRecord;
}

export function gateLeasesDirOf(niceevalRoot: string): string {
  return locksDirOf(niceevalRoot);
}

function gateLeaseEntryId(experimentId: string, slot: number): string {
  return slugHashEntryId(`gate-${experimentId}-${slot}`, ["gate-lease", experimentId, String(slot)]);
}

/** 租约与用例锁同住 `.niceeval/locks/`,分辨走内容而不是文件名:只有租约带 `slot` + `declaredN`。 */
function isGateLeaseRecordOf(entry: unknown, experimentId: string): entry is GateLeaseRecord {
  if (typeof entry !== "object" || entry === null) return false;
  const r = entry as Partial<GateLeaseRecord>;
  return (
    r.experimentId === experimentId &&
    typeof r.slot === "number" &&
    typeof r.declaredN === "number" &&
    typeof r.heartbeatAt === "string"
  );
}

/** 读取该实验当前在场的全部租约记录,无副作用。`--dry` 与 min-N 扫描用它。 */
export async function readGateLeases(niceevalRoot: string, experimentId: string): Promise<GateLeaseRecord[]> {
  const entries = await readAllEntryFiles<unknown>(gateLeasesDirOf(niceevalRoot));
  return entries
    .map(({ entry }) => entry)
    .filter((entry): entry is GateLeaseRecord => isGateLeaseRecordOf(entry, experimentId))
    .sort((a, b) => a.slot - b.slot);
}

/** 过期判据:只看心跳时间戳,不看 pid。落后严格大于阈值才算过期;无法解析一律视为过期。 */
export function isGateLeaseStale(record: GateLeaseRecord, nowMs: number): boolean {
  const heartbeatMs = Date.parse(record.heartbeatAt);
  if (Number.isNaN(heartbeatMs)) return true;
  return nowMs - heartbeatMs > GATE_LEASE_STALE_MS;
}

/** 本进程声明的 N:非法值(非有限、小于 1)一律收敛到 1,避免生效名额算成 0 造成永久满位。 */
function normalizeN(n: number): number {
  const floored = Math.floor(n);
  return Number.isFinite(floored) && floored >= 1 ? floored : 1;
}

/**
 * min-N:生效名额 = min(自己 resolved 的 N, 在场租约声明的每个 N)。配置漂移下正确性从紧——
 * 只要有一条在场租约声明了更小的 N,本进程就按那个更小的名额取位。过期租约的持有者已死,
 * 它的声明不参与(否则一条永不清理的残留租约会把名额永久钉死在它的 N 上)。
 */
function effectiveSlotCount(maxConcurrency: number, leases: readonly GateLeaseRecord[], nowMs: number): number {
  let n = normalizeN(maxConcurrency);
  for (const lease of leases) {
    if (isGateLeaseStale(lease, nowMs)) continue;
    const declared = normalizeN(lease.declaredN);
    if (declared < n) n = declared;
  }
  return n;
}

/**
 * O_EXCL 独占创建租约文件;已存在则返回 false,不覆盖、不抛错。这是「一个槽只能被一个进程
 * 占住」的互斥点本身,与 lock.ts 的同名私有函数同构——共享层 `writeEntryFile` 是「写入或
 * 覆盖」语义(rename 无条件替换目标),在这里会让两个进程同时认为自己占到了同一个槽。
 */
async function createLeaseFileExclusive(dir: string, id: string, record: GateLeaseRecord): Promise<boolean> {
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

/** 同一持有者判定:身份(pid/host)加上取位时刻——接管重建后 `startedAt` 必然不同。 */
function isSameHolder(record: GateLeaseRecord, mine: GateLeaseRecord): boolean {
  return record.pid === mine.pid && record.host === mine.host && record.startedAt === mine.startedAt;
}

/**
 * 一次非阻塞取位尝试:先按在场租约算生效名额(min-N——取自己的 `maxConcurrency` 与在场
 * 租约声明的 `declaredN` 的最小值),再对 `0..effectiveN-1` 中任一空槽 O_EXCL 独占创建;
 * 全满时若有过期槽则经 rename 接管,都不成功即 `{kind:"full"}`。
 */
export async function tryAcquireGateSlotOnce(
  niceevalRoot: string,
  experimentId: string,
  maxConcurrency: number,
  identity: { pid: number; host: string },
  nowMs: number,
): Promise<
  | { kind: "acquired"; slot: number; takenOver: boolean; takenOverFrom?: GateLeaseRecord; record: GateLeaseRecord }
  | { kind: "full"; holders: GateLeaseRecord[] }
> {
  const dir = gateLeasesDirOf(niceevalRoot);
  const effectiveN = effectiveSlotCount(maxConcurrency, await readGateLeases(niceevalRoot, experimentId), nowMs);
  const stamp = new Date(nowMs).toISOString();
  const recordFor = (slot: number): GateLeaseRecord => ({
    experimentId,
    slot,
    // 声明的是自己 resolved 的 N,不是本次算出的生效名额:否则被别人压低一次之后,这个更小的
    // 值会经租约文件传染开去,对方退场也回不去。
    declaredN: normalizeN(maxConcurrency),
    pid: identity.pid,
    host: identity.host,
    startedAt: stamp,
    heartbeatAt: stamp,
  });

  // 第一趟:逐槽独占创建。不预读占用情况——O_EXCL 本身就是判据,预读只会多一次竞态窗口。
  for (let slot = 0; slot < effectiveN; slot += 1) {
    const record = recordFor(slot);
    if (await createLeaseFileExclusive(dir, gateLeaseEntryId(experimentId, slot), record)) {
      return { kind: "acquired", slot, takenOver: false, record };
    }
  }

  // 第二趟:全满,找过期槽接管。claim(rename-墓碑)是互斥点,输者不报错、换下一个槽继续试;
  // 一趟走完仍无所获就返回 full,由上层轮询重新评估——不递归,避免竞争激烈时栈深不可控。
  for (let slot = 0; slot < effectiveN; slot += 1) {
    const id = gateLeaseEntryId(experimentId, slot);
    const current = await readEntryFile<GateLeaseRecord>(dir, id);
    if (current === undefined || !isGateLeaseStale(current, nowMs)) continue;
    if (!(await claimEntryFile(dir, id))) continue;
    const record = recordFor(slot);
    if (!(await createLeaseFileExclusive(dir, id, record))) continue;
    return { kind: "acquired", slot, takenOver: true, takenOverFrom: current, record };
  }

  const holders = (await readGateLeases(niceevalRoot, experimentId)).filter(
    (lease) => !isGateLeaseStale(lease, nowMs),
  );
  return { kind: "full", holders };
}

/**
 * 续租:只重写 `heartbeatAt`,其余字段原样保留;槽已经不是自己的(被接管)就不写,不踩别人的
 * 租约。`isReleased` 是 `acquireGateSlot` 闭包里 `released` 标志的读取器——`release()` 只
 * `clearInterval`,拦不住已经进入回调、卡在 `readEntryFile` 这次 await 上的心跳:它读完时
 * 租约文件可能已被 `rm`,若不再确认就直接写回,会把刚删掉的文件重新创建出来(与 lock.ts 同一条
 * 竞态,见 memory/lock-heartbeat-resurrects-released-lock.md)。写回前必须再查一次;入口也查
 * 一次省一次读,但不是竞态的关键检查点。
 */
async function renewHeartbeat(
  dir: string,
  id: string,
  mine: GateLeaseRecord,
  nowMs: number,
  isReleased: () => boolean,
): Promise<void> {
  if (isReleased()) return;
  const current = await readEntryFile<GateLeaseRecord>(dir, id);
  if (current === undefined) return; // 租约已经不在了(已释放或被接管),没有心跳可续
  if (!isSameHolder(current, mine)) return;
  if (isReleased()) return; // 释放发生在上面这次 await 期间——写回之前的最后一道闸
  await writeEntryFile(dir, id, { ...current, heartbeatAt: new Date(nowMs).toISOString() });
}

function makeAbortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("aborted while waiting for experiment gate slot");
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

// 当前进程持有中的租约,供 drainHeldGateLeases 强清兜底排空——与 lock.ts 的 held 表同一个模式。
const held = new Map<string, () => Promise<void>>();

function heldKey(niceevalRoot: string, id: string): string {
  return `${niceevalRoot} ${id}`;
}

/**
 * 高层入口:立刻取位,或者每 `pollIntervalMs`(默认等于心跳周期)重试一次直到取到。没有
 * 超时——在场租约心跳新鲜就一直等。取位成功后启动心跳续租定时器,并把释放闭包登记进
 * 模块内的「本进程持有中」表(供 `drainHeldGateLeases` 强清兜底)。必须响应 `opts.signal`:
 * 等待期间被中断要立刻停止轮询、以 AbortError 形状的错误 reject,不留下悬挂的定时器。
 */
export async function acquireGateSlot(
  niceevalRoot: string,
  experimentId: string,
  maxConcurrency: number,
  identity: { pid: number; host: string },
  opts: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
    /** 只在第一次尝试就撞满时触发一次,取位成功不触发。 */
    onWaitStart?: (holders: GateLeaseRecord[]) => void;
  } = {},
): Promise<AcquireGateSlotResult> {
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? GATE_LEASE_HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? heartbeatIntervalMs;
  const { signal } = opts;

  throwIfAborted(signal);

  let waitStarted = false;
  let slot!: number;
  let takenOver = false;
  let takenOverFrom: GateLeaseRecord | undefined;
  // 取位那一刻落盘的记录就是自己的身份凭据:续租与释放都先核对,槽被接管之后不动别人的租约。
  let mine!: GateLeaseRecord;
  for (;;) {
    const result = await tryAcquireGateSlotOnce(niceevalRoot, experimentId, maxConcurrency, identity, Date.now());
    if (result.kind === "acquired") {
      slot = result.slot;
      takenOver = result.takenOver;
      takenOverFrom = result.takenOverFrom;
      mine = result.record;
      break;
    }
    if (!waitStarted) {
      waitStarted = true;
      opts.onWaitStart?.(result.holders);
    }
    await delayOrAbort(pollIntervalMs, signal);
  }

  const dir = gateLeasesDirOf(niceevalRoot);
  const id = gateLeaseEntryId(experimentId, slot);
  const key = heldKey(niceevalRoot, id);

  // `inFlight` 追踪当前正在飞的心跳续租调用。仅在写回前查一次 `released` 不够:一旦某次心跳
  // 通过了检查、开始调用 `writeEntryFile`,该调用内部(mkdir/写临时文件/rename)本身还有多个
  // await 点——release() 可能在这些 await 之间跑完 `rm`,随后心跳的 rename 落地,把刚删掉的
  // 文件重新创建出来。真正堵住这条缝的办法不是"检查更早",而是让 release() 在删除之前等所有
  // 已发起的心跳调用结束,保证不会有写回落在 rm 之后(与 lock.ts 同构)。
  let released = false;
  const inFlight = new Set<Promise<void>>();
  const timer = setInterval(() => {
    if (released) return;
    const task = renewHeartbeat(dir, id, mine, Date.now(), () => released).catch(() => {
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
    const current = await readEntryFile<GateLeaseRecord>(dir, id);
    if (current !== undefined && !isSameHolder(current, mine)) return; // 槽已被接管,不删别人的租约
    await rm(join(dir, `${id}.json`), { force: true });
    await fsyncDir(dir);
  };
  held.set(key, release);

  return { claim: { slot, release }, takenOver, takenOverFrom };
}

/** 强清兜底:释放当前进程持有的每一条租约(尽力而为、幂等)。返回本次排空的条数。 */
export async function drainHeldGateLeases(): Promise<number> {
  const releases = [...held.values()];
  await Promise.allSettled(releases.map((release) => release()));
  return releases.length;
}

/** 测试探针,镜像 `pendingHeldCaseLockCount`。 */
export function pendingHeldGateLeaseCount(): number {
  return held.size;
}
