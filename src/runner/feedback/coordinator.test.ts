// coordinator.ts 的行为测试:全部使用 testing.ts 的假 FeedbackIO,不 monkey-patch 全局
// process/Date/setInterval —— coordinator 的关闭路径(onRendererError 的兜底)刻意走真实
// `src/tty-line.ts`(允许保留裸写的「feedback sink 自己」),这里只验证队列在 renderer 抛错
// 后仍然继续正常处理后续事件,不对那条兜底裸写本身断言,避免整份测试沾上 monkey-patch 依赖。
//
// coordinator 内部投递用真实 Promise 微任务队列(SerialQueue),不挂在注入的 fake clock 上 ——
// 断言前必须 flush() 一次(等一个真实宏任务,保证所有链式微任务都已跑完)。sink.ts 的活跃
// coordinator 是模块级栈:每个调用 start() 的测试都必须以 finish() 收尾,否则会把自己遗留在
// 栈里污染后续测试对 reportDiagnostic()/reportActivity() 路由目标的断言 —— afterEach 用
// activeFeedbackSinkCount() 兜底校验,忘记清理会在下一个测试之前就报错定位到具体哪个测试。

import { afterEach, describe, expect, it } from "vitest";
import { createFeedbackCoordinator } from "./coordinator.ts";
import { createFakeFeedbackIO } from "./testing.ts";
import { activeFeedbackSinkCount, reportActivity, reportDiagnostic } from "./sink.ts";
import type { FeedbackRenderer } from "./renderer.ts";
import type {
  AttemptLifecycleEvent,
  DurableFeedbackEvent,
  FeedbackTickEvent,
  RunCompletion,
  RunFeedbackPlan,
  RunSummary,
} from "../types.ts";

/** 等一个真实宏任务:保证 SerialQueue 目前为止链上的全部微任务(不管链多深)都已经跑完。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function plan(overrides: Partial<RunFeedbackPlan["shape"]> = {}): RunFeedbackPlan {
  return {
    shape: { evals: 1, configs: 1, totalRuns: 1, maxConcurrency: 1, ...overrides },
    reused: 0,
    reusedFailures: [],
  };
}

function summary(): RunSummary {
  return {
    agent: "codex",
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:00:01.000Z",
    passed: 1,
    failed: 0,
    skipped: 0,
    errored: 0,
    durationMs: 1000,
    results: [],
  };
}

function completion(): RunCompletion {
  return { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [] };
}

/** 记录每次调用(按发生顺序拼成一条 tag),供断言 clear→append→redraw 的原子顺序。
 *  可选 throwOn 让某个 durable 事件的 appendDurable 抛错,用来验证队列的容错性。 */
function recordingRenderer(opts: { throwOn?: (event: DurableFeedbackEvent) => boolean } = {}) {
  const calls: string[] = [];
  const renderer: FeedbackRenderer = {
    clearDynamic() {
      calls.push("clear");
    },
    appendDurable(event: DurableFeedbackEvent) {
      if (opts.throwOn?.(event)) throw new Error(`boom:${event.type}`);
      calls.push(`durable:${event.type}`);
    },
    redrawDynamic() {
      calls.push("redraw");
    },
    activity(text: string) {
      calls.push(`activity:${text}`);
    },
    onTick(event: FeedbackTickEvent) {
      calls.push(`tick:${event.elapsedMs}`);
    },
    onLifecycle(event: AttemptLifecycleEvent) {
      calls.push(`lifecycle:${event.type}`);
    },
    close() {
      calls.push("close");
    },
  };
  return { calls, renderer };
}

afterEach(() => {
  // 每个 start() 过的 coordinator 都应该在测试内 finish() 掉;这里兜底校验没有测试忘记清理
  // 而把自己遗留在 sink.ts 的活跃栈里(会静默污染下一个测试对 reportXxx() 路由目标的断言)。
  expect(activeFeedbackSinkCount()).toBe(0);
});

describe("createFeedbackCoordinator: durable 事件的 clear→append→redraw 顺序", () => {
  it("start() 立即以 clear→append(plan)→redraw 的顺序调用 renderer,并更新 state", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io });
    coordinator.start(plan({ totalRuns: 5 }));
    await flush();
    expect(calls).toEqual(["clear", "durable:plan", "redraw"]);
    expect(coordinator.state).toMatchObject({ total: 5, queued: 5 });
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("diagnostic() 按 emit() 的原子顺序处理,即便 renderer 方法是异步的也不交错", async () => {
    const { io } = createFakeFeedbackIO();
    const calls: string[] = [];
    const renderer: FeedbackRenderer = {
      async clearDynamic() {
        await Promise.resolve();
        calls.push("clear");
      },
      async appendDurable(event) {
        await Promise.resolve();
        calls.push(`durable:${event.type}`);
      },
      async redrawDynamic() {
        await Promise.resolve();
        calls.push("redraw");
      },
    };
    const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io });
    coordinator.start(plan());
    coordinator.diagnostic({ key: "a", severity: "warning", message: "first" });
    coordinator.diagnostic({ key: "b", severity: "warning", message: "second" });
    await coordinator.stopDynamic();
    expect(calls).toEqual([
      "clear",
      "durable:plan",
      "redraw",
      "clear",
      "durable:diagnostic",
      "redraw",
      "clear",
      "durable:diagnostic",
      "redraw",
      "clear", // stopDynamic() 收尾的无条件再清一次
    ]);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("同一 key 的 diagnostic 去重进 state,但仍逐次转发给 renderer(是否折叠展示由 renderer 决定)", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "agent", renderer, io });
    coordinator.start(plan());
    coordinator.diagnostic({ key: "memory-warmup-degraded", severity: "warning", message: "cold index (1)" });
    coordinator.diagnostic({ key: "memory-warmup-degraded", severity: "warning", message: "cold index (2)" });
    coordinator.diagnostic({ key: "memory-warmup-degraded", severity: "warning", message: "cold index (3)" });
    await flush();
    expect(coordinator.state.diagnostics).toHaveLength(1);
    expect(coordinator.state.diagnostics[0]).toMatchObject({ key: "memory-warmup-degraded", count: 3 });
    expect(calls.filter((c) => c === "durable:diagnostic")).toHaveLength(3);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("activity() 不进入 state.diagnostics/failures,但同样走 clear→activity→redraw", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io });
    coordinator.start(plan());
    coordinator.activity("pulling docker image node:24-slim...");
    await flush();
    expect(coordinator.state.diagnostics).toEqual([]);
    expect(coordinator.state.failures).toEqual([]);
    expect(calls.slice(-3)).toEqual(["clear", "activity:pulling docker image node:24-slim...", "redraw"]);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("renderer 在某个 durable 事件上抛错不会中断队列,后续事件照常按完整顺序处理", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer({ throwOn: (e) => e.type === "diagnostic" });
    const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io });
    coordinator.start(plan());
    coordinator.diagnostic({ key: "boom", severity: "warning", message: "x" });
    coordinator.interrupted();
    await coordinator.stopDynamic();
    // plan 正常;diagnostic 那次 clear 之后抛错(所以没有 "durable:diagnostic"、没有紧跟的
    // "redraw"),但下一个事件(interrupted)仍然拿到完整的 clear→append→redraw。
    expect(calls).toEqual([
      "clear",
      "durable:plan",
      "redraw",
      "clear",
      "clear",
      "durable:interrupted",
      "redraw",
      "clear",
    ]);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

describe("createFeedbackCoordinator: tick 与 heartbeat 节奏", () => {
  it("tick 定时器按注入的 clock 周期性触发,elapsedMs 相对 start() 时刻计算", async () => {
    const fake = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "agent", renderer, io: fake.io, tickIntervalMs: 100 });
    coordinator.start(plan());
    fake.advance(350);
    await flush();
    const ticks = calls.filter((c) => c.startsWith("tick:"));
    expect(ticks).toEqual(["tick:100", "tick:200", "tick:300"]);
    expect(coordinator.state.elapsedMs).toBe(300);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("stopDynamic() 之后不再有 tick 触发(定时器已清)", async () => {
    const fake = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "ci", renderer, io: fake.io, tickIntervalMs: 100 });
    coordinator.start(plan());
    fake.advance(150);
    await coordinator.stopDynamic();
    expect(fake.activeTimerCount()).toBe(0);
    const ticksBefore = calls.filter((c) => c.startsWith("tick:")).length;
    fake.advance(1000); // 就算时钟继续走,也不会再触发(定时器已被 clearInterval)
    const ticksAfter = calls.filter((c) => c.startsWith("tick:")).length;
    expect(ticksAfter).toBe(ticksBefore);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

describe("createFeedbackCoordinator: 关闭顺序", () => {
  it("stopDynamic() 之后,diagnostic()/activity() 仍会 append,但不再 clear/redraw", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io });
    coordinator.start(plan());
    await coordinator.stopDynamic();
    calls.length = 0; // 只看 stopDynamic 之后的行为(此时已经排空过一次队列,重置是安全的)
    coordinator.diagnostic({ key: "late", severity: "warning", message: "reporter 收尾期间的诊断" });
    coordinator.activity("late activity");
    await flush();
    expect(calls).toEqual(["durable:diagnostic", "activity:late activity"]);
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });

  it("finish() 追加 summary/saved、调用 renderer.close(),之后不再接受任何输出", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "ci", renderer, io });
    coordinator.start(plan());
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [".niceeval/ci/2026"] });
    expect(calls).toContain("durable:summary");
    expect(calls).toContain("durable:saved");
    expect(calls[calls.length - 1]).toBe("close");

    const before = calls.length;
    coordinator.diagnostic({ key: "after-finish", severity: "warning", message: "should be dropped" });
    coordinator.activity("also dropped");
    await flush();
    expect(calls.length).toBe(before); // finish() 之后完全不再调用 renderer
  });

  it("finish() 内部会先跑 stopDynamic(顺序:停 tick → 清 dashboard → summary/saved → close)", async () => {
    const fake = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io: fake.io, tickIntervalMs: 50 });
    coordinator.start(plan());
    await flush(); // 让 plan 的 clear→append→redraw 先跑完,再清空追踪数组只看收尾阶段
    calls.length = 0;
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
    // 第一个 "clear" 来自 stopDynamic() 收尾清空;finish() 时 phase 已经是 dynamicStopped,
    // summary/saved 因此只 append、不再 clear/redraw。
    expect(calls).toEqual(["clear", "durable:summary", "durable:saved", "close"]);
    expect(fake.activeTimerCount()).toBe(0);
  });

  it("start() 重复调用抛错;stopDynamic()/diagnostic() 在 start() 之前调用抛错", async () => {
    const { io } = createFakeFeedbackIO();
    const { renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "human", renderer, io });
    expect(() => coordinator.diagnostic({ key: "x", severity: "warning", message: "x" })).toThrow();
    await expect(coordinator.stopDynamic()).rejects.toThrow();
    coordinator.start(plan());
    expect(() => coordinator.start(plan())).toThrow();
    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
  });
});

describe("sink.ts 集成:reportDiagnostic()/reportActivity() 只在 coordinator 活跃期间转发给它", () => {
  it("start() 之前调用落回 bootstrap,不触碰这个 coordinator 的 renderer", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "agent", renderer, io });
    reportDiagnostic({ key: "before-start", severity: "warning", message: "x" });
    reportActivity("before-start activity");
    expect(calls).toEqual([]);
    // 清理:即便这个 coordinator 从未真正 start(),afterEach 只校验活跃栈计数,不要求
    // 每个测试局部变量都必须走完整生命周期 —— 这里不 start() 就不需要 finish()。
    void coordinator;
  });

  it("start() 之后,sink.ts 的便捷函数转发给活跃 coordinator;finish() 之后落回 bootstrap", async () => {
    const { io } = createFakeFeedbackIO();
    const { calls, renderer } = recordingRenderer();
    const coordinator = createFeedbackCoordinator({ profile: "ci", renderer, io });
    coordinator.start(plan());
    expect(activeFeedbackSinkCount()).toBe(1);
    await flush();
    calls.length = 0;
    reportDiagnostic({ key: "via-sink", severity: "warning", message: "routed" });
    reportActivity("also routed");
    await flush();
    expect(calls).toEqual(["clear", "durable:diagnostic", "redraw", "clear", "activity:also routed", "redraw"]);

    await coordinator.finish({ summary: summary(), completion: completion(), paths: [] });
    expect(activeFeedbackSinkCount()).toBe(0); // finish() 摘掉自己,不遗留在活跃栈里

    calls.length = 0;
    reportDiagnostic({ key: "after-finish", severity: "warning", message: "not routed" });
    expect(calls).toEqual([]); // 落回 bootstrap,不再触碰这个已经 finish 的 coordinator
  });
});
