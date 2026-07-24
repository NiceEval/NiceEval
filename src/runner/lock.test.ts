// cases: docs/engineering/testing/unit/experiments-runner.md
// 「用例锁与并发 Invocation」的原语半部——这里只覆盖 lock.ts 自身的心跳/过期/接管/等待/释放
// 语义,不覆盖 run.ts 的调度接线(携带重查、`elsewhere` 计数、`--dry` 标注等留给
// run.test.ts 的受控 fixture)。

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimEntryFile, slugHashEntryId, writeEntryFile } from "../shared/entry-file-store.ts";
import {
  acquireCaseLock,
  CASE_LOCK_HEARTBEAT_INTERVAL_MS,
  CASE_LOCK_STALE_MS,
  drainHeldCaseLocks,
  isCaseLockStale,
  locksDirOf,
  pendingHeldCaseLockCount,
  readCaseLock,
  tryAcquireCaseLockOnce,
  type CaseLockRecord,
} from "./lock.ts";

// 在任何测试调用 vi.useFakeTimers() 之前捕获真实的 setTimeout:vi.advanceTimersByTimeAsync 只
// 推进假时钟触发到期的定时器回调,不等待回调里新发起的真实 fs I/O(线程池完成通过事件循环的
// poll 阶段回来,micro-task 级的 process.nextTick 不足以放行)真正 settle。用真实 setTimeout
// 排一次宏任务,才能确定性地让真实 I/O 有机会在下一步推进前落地。
const realSetTimeout = globalThis.setTimeout;
function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

let roots: string[] = [];
async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-lock-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  await drainHeldCaseLocks(); // 防止某个测试提前失败时,残留的持有登记污染下一个测试
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

/** 与 lock.ts 内部 caseLockEntryId 完全同构(架构文档里定的算法):slug(`${experimentId}-${evalId}`)
 * 拼 hash(`${experimentId}:${evalId}`)。用于测试直接摆放/校验锁文件,不依赖 lock.ts 导出内部实现。 */
function lockEntryId(experimentId: string, evalId: string): string {
  return slugHashEntryId(`${experimentId}-${evalId}`, [experimentId, evalId]);
}

function record(over: Partial<CaseLockRecord> = {}): CaseLockRecord {
  return {
    experimentId: "compare/bub-e2b",
    evalId: "memory/commit0",
    pid: 111,
    host: "holder-host",
    startedAt: "2026-07-21T10:00:00.000Z",
    heartbeatAt: "2026-07-21T10:00:00.000Z",
    ...over,
  };
}

describe("tryAcquireCaseLockOnce: 空目录上的新鲜取锁", () => {
  it("成功、takenOver:false,文件内容形状正确", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");

    const result = await tryAcquireCaseLockOnce(
      niceevalRoot,
      "compare/bub-e2b",
      "memory/commit0",
      { pid: 4242, host: "runner-host" },
      nowMs,
    );
    expect(result).toEqual({ kind: "acquired", takenOver: false });

    const holder = await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0");
    expect(holder).toEqual({
      experimentId: "compare/bub-e2b",
      evalId: "memory/commit0",
      pid: 4242,
      host: "runner-host",
      startedAt: new Date(nowMs).toISOString(),
      heartbeatAt: new Date(nowMs).toISOString(),
    });
  });
});

describe("tryAcquireCaseLockOnce: 撞上新鲜锁", () => {
  it("返回 waiting 且带真实 holder 身份,不创建/修改任何文件", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");

    const first = await tryAcquireCaseLockOnce(
      niceevalRoot,
      "compare/bub-e2b",
      "memory/commit0",
      { pid: 111, host: "first-host" },
      nowMs,
    );
    expect(first).toEqual({ kind: "acquired", takenOver: false });

    const before = await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0");
    const beforeFiles = await readdir(locksDirOf(niceevalRoot));

    const second = await tryAcquireCaseLockOnce(
      niceevalRoot,
      "compare/bub-e2b",
      "memory/commit0",
      { pid: 222, host: "second-host" },
      nowMs + 1_000, // 未过 30s,仍然新鲜
    );
    expect(second).toEqual({ kind: "waiting", holder: before });
    expect((second as { holder: CaseLockRecord }).holder.pid).toBe(111);
    expect((second as { holder: CaseLockRecord }).holder.host).toBe("first-host");

    // 撞锁不改动任何东西:目录内容与锁记录都原样不变
    expect(await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0")).toEqual(before);
    expect((await readdir(locksDirOf(niceevalRoot))).sort()).toEqual(beforeFiles.sort());
  });
});

describe("isCaseLockStale: 30s 边界", () => {
  it("恰好落后 30_000ms 不算过期(严格大于,不是 >=)", () => {
    const r = record({ heartbeatAt: new Date(0).toISOString() });
    expect(isCaseLockStale(r, CASE_LOCK_STALE_MS)).toBe(false);
  });

  it("落后 30_001ms 算过期", () => {
    const r = record({ heartbeatAt: new Date(0).toISOString() });
    expect(isCaseLockStale(r, CASE_LOCK_STALE_MS + 1)).toBe(true);
  });

  it("无法解析的 heartbeatAt 一律视为过期", () => {
    const r = record({ heartbeatAt: "not-a-date" });
    expect(isCaseLockStale(r, 0)).toBe(true);
  });
});

describe("tryAcquireCaseLockOnce: 过期锁的接管", () => {
  it("单一调用者:接管成功,acquired + takenOver:true,文件显示新身份", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const dir = locksDirOf(niceevalRoot);
    const id = lockEntryId("compare/bub-e2b", "memory/commit0");
    const staleHeartbeat = new Date(0).toISOString();
    await writeEntryFile(dir, id, record({ pid: 1, host: "dead-host", heartbeatAt: staleHeartbeat, startedAt: staleHeartbeat }));

    const nowMs = CASE_LOCK_STALE_MS + 1; // 落后严格大于 30s,过期
    const result = await tryAcquireCaseLockOnce(
      niceevalRoot,
      "compare/bub-e2b",
      "memory/commit0",
      { pid: 999, host: "new-host" },
      nowMs,
    );
    expect(result).toEqual({ kind: "acquired", takenOver: true });

    const holder = await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0");
    expect(holder?.pid).toBe(999);
    expect(holder?.host).toBe("new-host");
    expect(holder?.heartbeatAt).toBe(new Date(nowMs).toISOString());
  });
});

describe("过期锁在真实并发下的互斥", () => {
  it("两个调用者竞争同一把过期锁:恰好一方拿到执行权,另一方转入等待、随后可取得", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const experimentId = "compare/bub-e2b";
    const evalId = "memory/commit0";
    const dir = locksDirOf(niceevalRoot);
    const id = lockEntryId(experimentId, evalId);
    const staleHeartbeat = new Date(0).toISOString();
    await writeEntryFile(
      dir,
      id,
      record({ pid: 1, host: "dead-host", heartbeatAt: staleHeartbeat, startedAt: staleHeartbeat }),
    );

    const nowMs = CASE_LOCK_STALE_MS + 1;
    const [a, b] = await Promise.all([
      tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, { pid: 100, host: "host-a" }, nowMs),
      tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, { pid: 200, host: "host-b" }, nowMs),
    ]);

    const results = [a, b];
    const acquired = results.filter((r) => r.kind === "acquired");
    const waiting = results.filter(
      (r): r is { kind: "waiting"; holder: CaseLockRecord } => r.kind === "waiting",
    );
    // 恰好一方拿到执行权,绝不会两个都成功(不发生双持有)
    expect(acquired).toHaveLength(1);
    expect(waiting).toHaveLength(1);

    const holder = await readCaseLock(niceevalRoot, experimentId, evalId);
    expect(holder).toBeDefined();
    expect(holder?.pid).not.toBe(1); // 原来的过期锁确实被替换掉了
    expect([100, 200]).toContain(holder?.pid);
    // 输家读到的 holder 与最终落盘一致
    expect(waiting[0]!.holder).toEqual(holder);

    // 输家在锁仍新鲜时重试,应继续等待
    const winnerPid = holder!.pid;
    const loserIdentity = winnerPid === 100 ? { pid: 200, host: "host-b" } : { pid: 100, host: "host-a" };
    const retryWhileFresh = await tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, loserIdentity, nowMs);
    expect(retryWhileFresh).toEqual({ kind: "waiting", holder });

    // 赢家释放(直接清空锁文件)后,输家重试立刻可以取得——等待之后确实能拿到执行权
    await claimEntryFile(dir, id);
    const afterRelease = await tryAcquireCaseLockOnce(niceevalRoot, experimentId, evalId, loserIdentity, nowMs);
    expect(afterRelease).toEqual({ kind: "acquired", takenOver: false });
  });
});

describe("acquireCaseLock: 心跳续租", () => {
  it("持有期间心跳每个周期续租一次,heartbeatAt 前进、其余字段不变", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const niceevalRoot = join(root, ".niceeval");
      const { claim } = await acquireCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0", {
        pid: 4242,
        host: "runner-host",
      });
      const before = await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0");
      expect(before).toBeDefined();

      await vi.advanceTimersByTimeAsync(CASE_LOCK_HEARTBEAT_INTERVAL_MS);
      await vi.waitFor(async () => {
        const current = await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0");
        expect(current?.heartbeatAt).not.toBe(before?.heartbeatAt);
      });

      const after = await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0");
      expect(Date.parse(after!.heartbeatAt)).toBeGreaterThan(Date.parse(before!.heartbeatAt));
      expect(after?.pid).toBe(before?.pid);
      expect(after?.host).toBe(before?.host);
      expect(after?.startedAt).toBe(before?.startedAt);
      expect(after?.experimentId).toBe(before?.experimentId);
      expect(after?.evalId).toBe(before?.evalId);

      await claim.release();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("acquireCaseLock: 等待路径", () => {
  it("onWaitStart 恰好触发一次;过期前持续等待,过期后取得并标记接管", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const niceevalRoot = join(root, ".niceeval");
      const experimentId = "compare/bub-e2b";
      const evalId = "memory/commit0";
      const dir = locksDirOf(niceevalRoot);
      const id = lockEntryId(experimentId, evalId);
      const seededAt = new Date().toISOString();
      await writeEntryFile(dir, id, record({ pid: 1, host: "holder-host", startedAt: seededAt, heartbeatAt: seededAt }));

      let waitStartCalls = 0;
      let waitHolderPid: number | undefined;
      let resolved = false;
      let firstWaitStart!: (holder: CaseLockRecord) => void;
      const firstWaitStartPromise = new Promise<CaseLockRecord>((resolve) => {
        firstWaitStart = resolve;
      });
      // pollIntervalMs 刻意设成能一步跨到"仍新鲜"、两步跨到"过期"的量级(25s < 30s 阈值 <
      // 50s),不用逐 1s 轮询——vi.advanceTimersByTimeAsync 只推进假时钟触发到期定时器,并不
      // 等待定时器回调里新发起的真实 fs I/O 完成;真实 I/O 完成后才会注册下一轮定时器,所以
      // 一次跨越多轮 [假定时器 → 真实 I/O] 的大步推进会在真实 I/O 还没来得及 settle 时提前
      // 返回。用 stepAndFlush 每步之后手动放行几轮真实微任务,让每一轮真实 fs 检查先落地,
      // 再推进下一步。
      const pollIntervalMs = 25_000;
      const resultPromise = acquireCaseLock(
        niceevalRoot,
        experimentId,
        evalId,
        { pid: 999, host: "waiter" },
        {
          pollIntervalMs,
          onWaitStart: (holder) => {
            waitStartCalls += 1;
            waitHolderPid = holder.pid;
            firstWaitStart(holder);
          },
        },
      );
      resultPromise.then(() => {
        resolved = true;
      });

      const holder = await firstWaitStartPromise; // 纯微任务同步点,不依赖假时钟
      expect(holder.pid).toBe(1);
      expect(waitHolderPid).toBe(1);
      expect(waitStartCalls).toBe(1);

      async function stepAndFlush(ms: number): Promise<void> {
        await vi.advanceTimersByTimeAsync(ms);
        // 真实 setTimeout(0) 排宏任务,给真实 fs I/O 的线程池完成回调机会真正落地;多轮小
        // 步比一次性大延时更快、也更贴近"刚好够用"的量。
        for (let i = 0; i < 10; i += 1) {
          await realDelay(5);
        }
      }

      // 第一步推进 25s:仍在 30s 阈值内,应继续等待,onWaitStart 不重复触发
      await stepAndFlush(pollIntervalMs);
      expect(resolved).toBe(false);
      expect(waitStartCalls).toBe(1);

      // 第二步再推进 25s(累计 50s,越过 30s 阈值):应该取得并标记为接管
      await stepAndFlush(pollIntervalMs);
      expect(resolved).toBe(true);

      const result = await resultPromise;
      expect(result.takenOver).toBe(true);

      await result.claim.release();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("acquireCaseLock: 中断", () => {
  it("等待期间 signal abort:不挂起、及时以 AbortError 形状 settle,不留下悬挂定时器", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const niceevalRoot = join(root, ".niceeval");
      const experimentId = "compare/bub-e2b";
      const evalId = "memory/commit0";
      const dir = locksDirOf(niceevalRoot);
      const id = lockEntryId(experimentId, evalId);
      const seededAt = new Date().toISOString();
      await writeEntryFile(dir, id, record({ pid: 1, host: "holder-host", startedAt: seededAt, heartbeatAt: seededAt }));

      const controller = new AbortController();
      let waitStarted = false;
      const resultPromise = acquireCaseLock(
        niceevalRoot,
        experimentId,
        evalId,
        { pid: 999, host: "waiter" },
        {
          pollIntervalMs: 60_000, // 刻意设很长,证明中断不是靠等定时器走完
          signal: controller.signal,
          onWaitStart: () => {
            waitStarted = true;
          },
        },
      );

      await vi.waitFor(() => expect(waitStarted).toBe(true));
      controller.abort();

      await expect(resultPromise).rejects.toThrow();
      expect(pendingHeldCaseLockCount()).toBe(0); // 中断路径没有留下任何"已持有"登记
    } finally {
      vi.useRealTimers();
    }
  });

  it("尚未开始等待就已经 abort:立刻 settle,不产生任何取锁副作用", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const controller = new AbortController();
    controller.abort();

    await expect(
      acquireCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0", { pid: 1, host: "h" }, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0")).toBeUndefined();
  });
});

describe("acquireCaseLock / claim.release: 释放", () => {
  it("release() 删除锁文件并停止心跳;释放后再推进一个心跳周期,文件不会复活也不报错", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const niceevalRoot = join(root, ".niceeval");
      const { claim } = await acquireCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0", {
        pid: 1,
        host: "h",
      });
      expect(await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0")).toBeDefined();

      await claim.release();
      expect(await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0")).toBeUndefined();

      await vi.advanceTimersByTimeAsync(CASE_LOCK_HEARTBEAT_INTERVAL_MS);
      expect(await readCaseLock(niceevalRoot, "compare/bub-e2b", "memory/commit0")).toBeUndefined();

      await expect(claim.release()).resolves.toBeUndefined(); // 幂等:第二次调用是 no-op
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("acquireCaseLock / claim.release: 释放与在飞心跳的竞态", () => {
  it("回归 memory/lock-heartbeat-resurrects-released-lock.md:释放时若有一次心跳已读完记录、还没写回,写回不会把已删的锁文件复活", async () => {
    // 心跳的「读—改—写」与 release() 的 `rm` 之间原本没有互斥:心跳读完记录、还没来得及
    // writeEntryFile 写回时,release() 先把文件 rm 掉,随后心跳的写回会把原路径重新创建
    // 出来。极短心跳周期(1ms)让每次释放大概率撞上一次在飞的心跳,配合真实定时器重复
    // 多轮,能稳定复现(台账记录:修复前 40 次释放 39 次复活)。这里断言修复后不管重复
    // 多少轮,释放后锁目录始终为空。
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");

    for (let i = 0; i < 40; i += 1) {
      const { claim } = await acquireCaseLock(
        niceevalRoot,
        "compare/bub-e2b",
        `memory/commit-${i}`,
        { pid: 1, host: "h" },
        { heartbeatIntervalMs: 1 },
      );
      await realDelay(5); // 让至少一次心跳进入「读—改—写」的飞行窗口
      await claim.release();
      await realDelay(15); // 给在飞的那次心跳足够时间尝试(错误地)写回
    }

    expect(await readdir(locksDirOf(niceevalRoot))).toEqual([]);
  });
});

describe("drainHeldCaseLocks / pendingHeldCaseLockCount", () => {
  it("释放当前进程持有的全部锁,幂等", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const a = await acquireCaseLock(niceevalRoot, "exp/drain-a", "case/drain-a", { pid: 1, host: "h" });
    const b = await acquireCaseLock(niceevalRoot, "exp/drain-b", "case/drain-b", { pid: 1, host: "h" });
    expect(pendingHeldCaseLockCount()).toBe(2);

    const drained = await drainHeldCaseLocks();
    expect(drained).toBe(2);
    expect(pendingHeldCaseLockCount()).toBe(0);
    expect(await readCaseLock(niceevalRoot, "exp/drain-a", "case/drain-a")).toBeUndefined();
    expect(await readCaseLock(niceevalRoot, "exp/drain-b", "case/drain-b")).toBeUndefined();

    const secondDrain = await drainHeldCaseLocks();
    expect(secondDrain).toBe(0);

    await a.claim.release(); // 已经被 drain 释放,幂等 no-op
    await b.claim.release();
  });
});
