// cases: docs/engineering/testing/unit/experiments-runner.md
// 「用例锁与并发 Invocation」的实验闸租约原语半部——这里只覆盖 gate-lease.ts 自身的槽互斥、
// min-N、心跳/过期/rename 接管与释放语义,不覆盖 run.ts 的调度接线(名额域跨 runEvals 的
// 在飞峰值断言留给 run.test.ts 的受控 fixture)。

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugHashEntryId, writeEntryFile } from "../shared/entry-file-store.ts";
import {
  acquireGateSlot,
  drainHeldGateLeases,
  GATE_LEASE_HEARTBEAT_INTERVAL_MS,
  GATE_LEASE_STALE_MS,
  gateLeasesDirOf,
  isGateLeaseStale,
  pendingHeldGateLeaseCount,
  readGateLeases,
  tryAcquireGateSlotOnce,
  type GateLeaseRecord,
} from "./gate-lease.ts";

// 在任何测试调用 vi.useFakeTimers() 之前捕获真实的 setTimeout:vi.advanceTimersByTimeAsync 只
// 推进假时钟触发到期的定时器回调,不等待回调里新发起的真实 fs I/O 真正 settle(踩坑同
// lock.test.ts 顶部注释)。用真实 setTimeout 排一次宏任务放行真实 I/O。
const realSetTimeout = globalThis.setTimeout;
function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

const EXP = "compare/bub-e2b";

let roots: string[] = [];
async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-gate-"));
  roots.push(dir);
  return join(dir, ".niceeval");
}
afterEach(async () => {
  await drainHeldGateLeases(); // 防止某个测试提前失败时,残留的持有登记污染下一个测试
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
  roots = [];
});

/** 与 gate-lease.ts 内部 gateLeaseEntryId 同构:slug(`gate-${experimentId}-${slot}`) 拼
 * hash(`gate-lease:${experimentId}:${slot}`)。用于测试直接摆放租约文件,不依赖内部导出。 */
function gateEntryId(experimentId: string, slot: number): string {
  return slugHashEntryId(`gate-${experimentId}-${slot}`, ["gate-lease", experimentId, String(slot)]);
}

function lease(over: Partial<GateLeaseRecord> = {}): GateLeaseRecord {
  return {
    experimentId: EXP,
    slot: 0,
    declaredN: 1,
    pid: 111,
    host: "holder-host",
    startedAt: "2026-07-21T10:00:00.000Z",
    heartbeatAt: "2026-07-21T10:00:00.000Z",
    ...over,
  };
}

async function seed(niceevalRoot: string, record: GateLeaseRecord): Promise<void> {
  await writeEntryFile(gateLeasesDirOf(niceevalRoot), gateEntryId(record.experimentId, record.slot), record);
}

async function leaseFileCount(niceevalRoot: string): Promise<number> {
  const files = await readdir(gateLeasesDirOf(niceevalRoot)).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".json") && !f.startsWith(".")).length;
}

describe("tryAcquireGateSlotOnce: 逐槽取位", () => {
  it("空目录取到 slot 0,记录形状正确(declaredN 是自己 resolved 的 N)", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");

    const result = await tryAcquireGateSlotOnce(root, EXP, 3, { pid: 4242, host: "runner-host" }, nowMs);
    expect(result.kind).toBe("acquired");
    expect(result).toMatchObject({ kind: "acquired", slot: 0, takenOver: false });

    expect(await readGateLeases(root, EXP)).toEqual([
      {
        experimentId: EXP,
        slot: 0,
        declaredN: 3,
        pid: 4242,
        host: "runner-host",
        startedAt: new Date(nowMs).toISOString(),
        heartbeatAt: new Date(nowMs).toISOString(),
      },
    ]);
  });

  it("N 个名额逐个取满,第 N+1 次返回 full 并带上全部在场持有者", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");

    const slots: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await tryAcquireGateSlotOnce(root, EXP, 3, { pid: 100 + i, host: "h" }, nowMs);
      expect(r.kind).toBe("acquired");
      if (r.kind === "acquired") slots.push(r.slot);
    }
    expect(slots).toEqual([0, 1, 2]);

    const full = await tryAcquireGateSlotOnce(root, EXP, 3, { pid: 999, host: "late" }, nowMs);
    expect(full.kind).toBe("full");
    if (full.kind === "full") {
      expect(full.holders.map((h) => h.slot)).toEqual([0, 1, 2]);
      expect(full.holders.map((h) => h.pid)).toEqual([100, 101, 102]);
    }
    expect(await leaseFileCount(root)).toBe(3);
  });

  it("名额域按实验隔离:另一个实验取满不影响本实验", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");

    const other = await tryAcquireGateSlotOnce(root, "compare/other", 1, { pid: 1, host: "h" }, nowMs);
    expect(other.kind).toBe("acquired");

    const mine = await tryAcquireGateSlotOnce(root, EXP, 1, { pid: 2, host: "h" }, nowMs);
    expect(mine).toMatchObject({ kind: "acquired", slot: 0 });
    expect(await readGateLeases(root, EXP)).toHaveLength(1);
  });

  it("readGateLeases 不把同目录的用例锁文件误认成租约", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");
    // 用例锁与租约同住 .niceeval/locks/,分辨走内容(slot + declaredN)而不是文件名
    await writeEntryFile(gateLeasesDirOf(root), slugHashEntryId(`${EXP}-memory/commit0`, [EXP, "memory/commit0"]), {
      experimentId: EXP,
      evalId: "memory/commit0",
      pid: 7,
      host: "case-lock-host",
      startedAt: new Date(nowMs).toISOString(),
      heartbeatAt: new Date(nowMs).toISOString(),
    });

    await tryAcquireGateSlotOnce(root, EXP, 2, { pid: 4242, host: "runner-host" }, nowMs);

    const leases = await readGateLeases(root, EXP);
    expect(leases).toHaveLength(1);
    expect(leases[0]!.pid).toBe(4242);
  });
});

describe("槽互斥:并发取位", () => {
  it("N=1 时两个并发取位者恰好一个拿到该槽", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");

    const results = await Promise.all([
      tryAcquireGateSlotOnce(root, EXP, 1, { pid: 100, host: "host-a" }, nowMs),
      tryAcquireGateSlotOnce(root, EXP, 1, { pid: 200, host: "host-b" }, nowMs),
    ]);
    expect(results.filter((r) => r.kind === "acquired")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "full")).toHaveLength(1);

    const leases = await readGateLeases(root, EXP);
    expect(leases).toHaveLength(1); // 绝不双持有
    expect([100, 200]).toContain(leases[0]!.pid);
  });

  it("N=3 时四个并发取位者恰好三个拿到,且槽位互不相同", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");

    const results = await Promise.all(
      [1, 2, 3, 4].map((i) => tryAcquireGateSlotOnce(root, EXP, 3, { pid: i, host: `host-${i}` }, nowMs)),
    );
    const acquired = results.filter((r) => r.kind === "acquired");
    expect(acquired).toHaveLength(3);
    expect(acquired.map((r) => (r as { slot: number }).slot).sort()).toEqual([0, 1, 2]);
    expect(await leaseFileCount(root)).toBe(3);
  });
});

describe("min-N:配置漂移下生效名额取在场声明的最小值", () => {
  it("在场租约声明 1 时,自己声明 4 也只有 1 个名额", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");
    await seed(root, lease({ slot: 0, declaredN: 1, pid: 1, startedAt: new Date(nowMs).toISOString(), heartbeatAt: new Date(nowMs).toISOString() }));

    const result = await tryAcquireGateSlotOnce(root, EXP, 4, { pid: 2, host: "wide" }, nowMs);
    expect(result.kind).toBe("full");
    expect(await leaseFileCount(root)).toBe(1);
  });

  it("在场租约声明 4、自己声明 2 时生效名额是 2:能取到 slot 1,取满后即 full", async () => {
    const root = await makeRoot();
    const nowMs = Date.parse("2026-07-24T00:00:00.000Z");
    await seed(root, lease({ slot: 0, declaredN: 4, pid: 1, startedAt: new Date(nowMs).toISOString(), heartbeatAt: new Date(nowMs).toISOString() }));

    const first = await tryAcquireGateSlotOnce(root, EXP, 2, { pid: 2, host: "narrow" }, nowMs);
    expect(first).toMatchObject({ kind: "acquired", slot: 1 });
    // 自己写下的仍是自己 resolved 的 N,不被别人的声明传染
    expect((await readGateLeases(root, EXP))[1]!.declaredN).toBe(2);

    const second = await tryAcquireGateSlotOnce(root, EXP, 2, { pid: 3, host: "narrow" }, nowMs);
    expect(second.kind).toBe("full");
  });

  it("过期租约的声明不参与 min-N:残留的窄声明不把名额永久钉死", async () => {
    const root = await makeRoot();
    const nowMs = GATE_LEASE_STALE_MS + 1;
    await seed(root, lease({ slot: 0, declaredN: 1, pid: 1, heartbeatAt: new Date(0).toISOString() }));

    // 生效名额按自己的 3 算(过期声明被忽略):两个空槽先用完,全满之后才接管过期的 slot 0
    const first = await tryAcquireGateSlotOnce(root, EXP, 3, { pid: 2, host: "h" }, nowMs);
    expect(first).toMatchObject({ kind: "acquired", slot: 1, takenOver: false });
    const second = await tryAcquireGateSlotOnce(root, EXP, 3, { pid: 3, host: "h" }, nowMs);
    expect(second).toMatchObject({ kind: "acquired", slot: 2, takenOver: false });
    const third = await tryAcquireGateSlotOnce(root, EXP, 3, { pid: 4, host: "h" }, nowMs);
    expect(third).toMatchObject({ kind: "acquired", slot: 0, takenOver: true });
    expect(await leaseFileCount(root)).toBe(3);
  });
});

describe("isGateLeaseStale: 30s 边界(与用例锁同参数)", () => {
  it("恰好落后 30_000ms 不算过期(严格大于,不是 >=)", () => {
    expect(isGateLeaseStale(lease({ heartbeatAt: new Date(0).toISOString() }), GATE_LEASE_STALE_MS)).toBe(false);
  });

  it("落后 30_001ms 算过期", () => {
    expect(isGateLeaseStale(lease({ heartbeatAt: new Date(0).toISOString() }), GATE_LEASE_STALE_MS + 1)).toBe(true);
  });

  it("无法解析的 heartbeatAt 一律视为过期", () => {
    expect(isGateLeaseStale(lease({ heartbeatAt: "not-a-date" }), 0)).toBe(true);
  });
});

describe("过期租约的 rename 接管", () => {
  it("单一调用者:接管成功,takenOver:true 且带出原持有者记录,文件显示新身份", async () => {
    const root = await makeRoot();
    const staleAt = new Date(0).toISOString();
    await seed(root, lease({ slot: 0, declaredN: 1, pid: 1, host: "dead-host", startedAt: staleAt, heartbeatAt: staleAt }));

    const nowMs = GATE_LEASE_STALE_MS + 1;
    const result = await tryAcquireGateSlotOnce(root, EXP, 1, { pid: 999, host: "new-host" }, nowMs);
    expect(result).toMatchObject({ kind: "acquired", slot: 0, takenOver: true });
    if (result.kind === "acquired") {
      expect(result.takenOverFrom?.pid).toBe(1);
      expect(result.takenOverFrom?.host).toBe("dead-host");
    }

    const leases = await readGateLeases(root, EXP);
    expect(leases).toHaveLength(1); // 接管是替换,不是新增
    expect(leases[0]).toMatchObject({ slot: 0, pid: 999, host: "new-host", heartbeatAt: new Date(nowMs).toISOString() });
  });

  it("两个竞争者抢同一条过期租约:恰好一方拿到该槽,原持有者被替换", async () => {
    const root = await makeRoot();
    const staleAt = new Date(0).toISOString();
    await seed(root, lease({ slot: 0, declaredN: 1, pid: 1, host: "dead-host", startedAt: staleAt, heartbeatAt: staleAt }));

    const nowMs = GATE_LEASE_STALE_MS + 1;
    const results = await Promise.all([
      tryAcquireGateSlotOnce(root, EXP, 1, { pid: 100, host: "host-a" }, nowMs),
      tryAcquireGateSlotOnce(root, EXP, 1, { pid: 200, host: "host-b" }, nowMs),
    ]);
    expect(results.filter((r) => r.kind === "acquired")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "full")).toHaveLength(1);

    const leases = await readGateLeases(root, EXP);
    expect(leases).toHaveLength(1);
    expect(leases[0]!.pid).not.toBe(1); // 死掉的持有者确实被替换掉了
    expect([100, 200]).toContain(leases[0]!.pid);
  });
});

describe("acquireGateSlot: 心跳续租", () => {
  it("持有期间每个周期续租一次,heartbeatAt 前进、其余字段不变", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const { claim } = await acquireGateSlot(root, EXP, 2, { pid: 4242, host: "runner-host" });
      const before = (await readGateLeases(root, EXP))[0];
      expect(before).toBeDefined();

      await vi.advanceTimersByTimeAsync(GATE_LEASE_HEARTBEAT_INTERVAL_MS);
      await vi.waitFor(async () => {
        const current = (await readGateLeases(root, EXP))[0];
        expect(current?.heartbeatAt).not.toBe(before?.heartbeatAt);
      });

      const after = (await readGateLeases(root, EXP))[0]!;
      expect(Date.parse(after.heartbeatAt)).toBeGreaterThan(Date.parse(before!.heartbeatAt));
      expect(after.slot).toBe(before!.slot);
      expect(after.declaredN).toBe(before!.declaredN);
      expect(after.pid).toBe(before!.pid);
      expect(after.host).toBe(before!.host);
      expect(after.startedAt).toBe(before!.startedAt);

      await claim.release();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("acquireGateSlot: 等待路径", () => {
  it("撞满时 onWaitStart 恰好触发一次;在场租约过期后取位并标记接管", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const seededAt = new Date().toISOString();
      await seed(root, lease({ slot: 0, declaredN: 1, pid: 1, startedAt: seededAt, heartbeatAt: seededAt }));

      let waitStartCalls = 0;
      let waitHolders: GateLeaseRecord[] = [];
      let resolved = false;
      let firstWaitStart!: (holders: GateLeaseRecord[]) => void;
      const firstWaitStartPromise = new Promise<GateLeaseRecord[]>((resolve) => {
        firstWaitStart = resolve;
      });
      // 25s < 30s 阈值 < 50s:一步跨到"仍新鲜"、两步跨到"过期"。每步之后手动放行真实 fs I/O,
      // 理由同 lock.test.ts 的 stepAndFlush。
      const pollIntervalMs = 25_000;
      const resultPromise = acquireGateSlot(
        root,
        EXP,
        1,
        { pid: 999, host: "waiter" },
        {
          pollIntervalMs,
          onWaitStart: (holders) => {
            waitStartCalls += 1;
            waitHolders = holders;
            firstWaitStart(holders);
          },
        },
      );
      resultPromise.then(() => {
        resolved = true;
      });

      const holders = await firstWaitStartPromise; // 纯微任务同步点,不依赖假时钟
      expect(holders).toHaveLength(1);
      expect(holders[0]!.pid).toBe(1);
      expect(waitStartCalls).toBe(1);

      async function stepAndFlush(ms: number): Promise<void> {
        await vi.advanceTimersByTimeAsync(ms);
        for (let i = 0; i < 10; i += 1) {
          await realDelay(5);
        }
      }

      await stepAndFlush(pollIntervalMs); // 累计 25s,仍在阈值内:继续等,onWaitStart 不重复触发
      expect(resolved).toBe(false);
      expect(waitStartCalls).toBe(1);
      expect(waitHolders).toHaveLength(1);

      await stepAndFlush(pollIntervalMs); // 累计 50s,越过 30s 阈值:接管取位
      expect(resolved).toBe(true);

      const result = await resultPromise;
      expect(result.takenOver).toBe(true);
      expect(result.takenOverFrom?.pid).toBe(1);
      expect(result.claim.slot).toBe(0);

      await result.claim.release();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("acquireGateSlot: 中断", () => {
  it("等待期间 signal abort:不挂起、及时以 AbortError 形状 settle,不留下持有登记", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const seededAt = new Date().toISOString();
      await seed(root, lease({ slot: 0, declaredN: 1, pid: 1, startedAt: seededAt, heartbeatAt: seededAt }));

      const controller = new AbortController();
      let waitStarted = false;
      const resultPromise = acquireGateSlot(
        root,
        EXP,
        1,
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
      expect(pendingHeldGateLeaseCount()).toBe(0);
      expect(await leaseFileCount(root)).toBe(1); // 只剩原持有者的租约,中断没留下半条
    } finally {
      vi.useRealTimers();
    }
  });

  it("尚未开始等待就已经 abort:立刻 settle,不产生任何取位副作用", async () => {
    const root = await makeRoot();
    const controller = new AbortController();
    controller.abort();

    await expect(acquireGateSlot(root, EXP, 1, { pid: 1, host: "h" }, { signal: controller.signal })).rejects.toThrow();
    expect(await readGateLeases(root, EXP)).toEqual([]);
  });
});

describe("acquireGateSlot / claim.release: 释放", () => {
  it("release() 删除租约文件并停止心跳,释放后目录清空、不复活;重复调用是 no-op", async () => {
    vi.useFakeTimers();
    try {
      const root = await makeRoot();
      const { claim } = await acquireGateSlot(root, EXP, 2, { pid: 1, host: "h" });
      expect(await leaseFileCount(root)).toBe(1);

      await claim.release();
      expect(await readGateLeases(root, EXP)).toEqual([]);
      expect(await leaseFileCount(root)).toBe(0);

      await vi.advanceTimersByTimeAsync(GATE_LEASE_HEARTBEAT_INTERVAL_MS);
      expect(await leaseFileCount(root)).toBe(0);

      await expect(claim.release()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("释放的槽立刻可被下一个取位者拿到", async () => {
    const root = await makeRoot();
    const first = await acquireGateSlot(root, EXP, 1, { pid: 1, host: "h" });
    const nowMs = Date.now();
    expect(await tryAcquireGateSlotOnce(root, EXP, 1, { pid: 2, host: "h" }, nowMs)).toMatchObject({ kind: "full" });

    await first.claim.release();
    expect(await tryAcquireGateSlotOnce(root, EXP, 1, { pid: 2, host: "h" }, nowMs)).toMatchObject({
      kind: "acquired",
      slot: 0,
      takenOver: false,
    });
  });

  it("槽已被别人接管时,原持有者的 release 不删别人的租约", async () => {
    const root = await makeRoot();
    const { claim } = await acquireGateSlot(root, EXP, 1, { pid: 1, host: "h" });
    // 模拟本进程假死到过期、槽被另一条 Invocation 接管
    const taken = await tryAcquireGateSlotOnce(root, EXP, 1, { pid: 2, host: "taker" }, Date.now() + GATE_LEASE_STALE_MS + 1);
    expect(taken).toMatchObject({ kind: "acquired", takenOver: true });

    await claim.release();
    const leases = await readGateLeases(root, EXP);
    expect(leases).toHaveLength(1);
    expect(leases[0]!.pid).toBe(2);
  });
});

describe("acquireGateSlot / claim.release: 释放与在飞心跳的竞态", () => {
  it("回归 memory/lock-heartbeat-resurrects-released-lock.md:释放时若有一次心跳已读完记录、还没写回,写回不会把已删的租约文件复活", async () => {
    // 与用例锁(lock.ts)同一条竞态:心跳的「读—改—写」与 release() 的 `rm` 之间原本没有
    // 互斥。极短心跳周期(1ms)配合真实定时器重复多轮,让每轮释放大概率撞上一次在飞的
    // 心跳,能稳定复现(台账记录:修复前 40 次释放 39 次复活)。这里断言修复后不管重复
    // 多少轮,释放后租约目录始终为空。每轮用不同的 slot(经不同 experimentId)避免相邻
    // 轮次互相抢位排队,纯粹考验单条持有者的释放-心跳竞态。
    const root = await makeRoot();

    for (let i = 0; i < 40; i += 1) {
      const { claim } = await acquireGateSlot(
        root,
        `${EXP}-${i}`,
        1,
        { pid: 1, host: "h" },
        { heartbeatIntervalMs: 1 },
      );
      await realDelay(5); // 让至少一次心跳进入「读—改—写」的飞行窗口
      await claim.release();
      await realDelay(15); // 给在飞的那次心跳足够时间尝试(错误地)写回
    }

    expect(await leaseFileCount(root)).toBe(0);
  });
});

describe("drainHeldGateLeases / pendingHeldGateLeaseCount", () => {
  it("释放当前进程持有的全部租约,幂等", async () => {
    const root = await makeRoot();
    const a = await acquireGateSlot(root, EXP, 2, { pid: 1, host: "h" });
    const b = await acquireGateSlot(root, EXP, 2, { pid: 1, host: "h" });
    expect([a.claim.slot, b.claim.slot]).toEqual([0, 1]);
    expect(pendingHeldGateLeaseCount()).toBe(2);

    expect(await drainHeldGateLeases()).toBe(2);
    expect(pendingHeldGateLeaseCount()).toBe(0);
    expect(await readGateLeases(root, EXP)).toEqual([]);
    expect(await leaseFileCount(root)).toBe(0);

    expect(await drainHeldGateLeases()).toBe(0);
    await a.claim.release(); // 已被 drain 释放,幂等 no-op
    await b.claim.release();
  });
});
