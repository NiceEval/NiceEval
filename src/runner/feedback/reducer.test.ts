// 表驱动测试:RunFeedbackEvent 序列 → RunFeedbackState。核心断言是「任何时刻」都满足
// total = reused + running + queued + completed(见 docs/feature/experiments/cli.md 的守恒公式)——
// 每处理一个事件就断言一次,不是只在序列末尾断言。辅助不变量 active.size === running 一并核对
// (active map 按设计只存「正在运行」的 attempt,见 ../types.ts 的 ActiveAttempt 注释)。

import { describe, expect, it } from "vitest";
import { createInitialRunFeedbackState, reduceRunFeedback } from "./reducer.ts";
import { encodeAttemptKey, type AttemptRef, type RunFeedbackEvent, type RunFeedbackState } from "../types.ts";
import type { AttemptLocator } from "../../results/locator.ts";

function locator(id: string): AttemptLocator {
  return `@1${id}` as AttemptLocator;
}

function ref(evalId: string, attempt = 0, experimentId?: string): AttemptRef {
  return experimentId ? { experimentId, evalId, attempt } : { evalId, attempt };
}

/** 依次喂事件,每一步都断言守恒公式与 active/running 一致,返回最终状态供调用方追加断言。 */
function replay(events: readonly RunFeedbackEvent[]): RunFeedbackState {
  let state = createInitialRunFeedbackState();
  for (const [i, event] of events.entries()) {
    state = reduceRunFeedback(state, event);
    expect(
      state.total,
      `after event #${i} (${event.type}): total should equal reused+running+queued+completed`,
    ).toBe(state.reused + state.running + state.queued + state.completed);
    expect(
      state.active.size,
      `after event #${i} (${event.type}): active map size should equal running count`,
    ).toBe(state.running);
    // 四个桶(reused/running/queued/completed)本身永远非负 —— 负数意味着某个事件把不存在的
    // attempt 又"完成"了一次,是 reducer 或 emitter 的 bug,不该被吞掉。
    expect(state.reused, `after event #${i}: reused must not go negative`).toBeGreaterThanOrEqual(0);
    expect(state.running, `after event #${i}: running must not go negative`).toBeGreaterThanOrEqual(0);
    expect(state.queued, `after event #${i}: queued must not go negative`).toBeGreaterThanOrEqual(0);
    expect(state.completed, `after event #${i}: completed must not go negative`).toBeGreaterThanOrEqual(0);
  }
  return state;
}

describe("reduceRunFeedback: 守恒公式", () => {
  it("普通运行:plan → start × N → complete × N,计数逐步从 queued 转移到 completed", () => {
    const a = ref("memory/a");
    const b = ref("memory/b");
    const c = ref("memory/c");
    const state = replay([
      { type: "plan", at: 0, plan: { shape: { evals: 3, configs: 1, totalRuns: 3, maxConcurrency: 3 }, reused: 0, reusedFailures: [] } },
      { type: "attempt:start", at: 1, identity: a, who: "codex", phase: "sandbox.create" },
      { type: "attempt:start", at: 1, identity: b, who: "codex", phase: "sandbox.create" },
      { type: "attempt:start", at: 1, identity: c, who: "codex", phase: "sandbox.create" },
      { type: "attempt:phase", at: 2, identity: a, phase: "eval.run" },
      { type: "attempt:progress", at: 3, identity: a, detail: "turn 2" },
      { type: "attempt:complete", at: 4, identity: a, who: "codex", verdict: "passed", tokenCount: 15, estimatedCostUSD: 0.1 },
      { type: "attempt:complete", at: 5, identity: b, who: "codex", verdict: "passed", tokenCount: 25, estimatedCostUSD: 0.2 },
      { type: "attempt:complete", at: 6, identity: c, who: "codex", verdict: "passed", estimatedCostUSD: 0.05 },
    ]);
    expect(state).toMatchObject({ total: 3, reused: 0, running: 0, queued: 0, completed: 3 });
    expect(state.estimatedCostUSD).toBeCloseTo(0.35, 5);
    expect(state.newTokenCount).toBe(40);
    expect(state.active.size).toBe(0);
    expect(state.failures).toEqual([]);
  });

  it("plan 静态注入复用失败；fresh failure 单独计数且同 locator 幂等", () => {
    const carriedLocator = locator("carried");
    const freshLocator = locator("fresh");
    let state = reduceRunFeedback(createInitialRunFeedbackState(), {
      type: "plan",
      at: 0,
      plan: {
        shape: { evals: 2, configs: 1, totalRuns: 2, maxConcurrency: 1 },
        reused: 1,
        reusedFailures: [{
          locator: carriedLocator,
          identity: ref("memory/carried", 0, "compare/bub-e2b"),
          who: "compare/bub-e2b",
          verdict: "failed",
          reason: "carried failure",
        }],
      },
    });
    expect(state.failures.map((failure) => failure.locator)).toEqual([carriedLocator]);
    expect(state.freshFailureCount).toBe(0);

    const event = {
      type: "failure" as const,
      at: 1,
      locator: freshLocator,
      identity: ref("memory/fresh", 0, "compare/bub-e2b"),
      who: "compare/bub-e2b",
      verdict: "failed" as const,
      reason: "fresh failure",
    };
    state = reduceRunFeedback(state, event);
    state = reduceRunFeedback(state, event);
    expect(state.failures).toHaveLength(2);
    expect(state.freshFailureCount).toBe(1);
  });

  it("carry:携入结果在 plan 那一刻就计入 reused,守恒公式在第一个事件后就成立", () => {
    const state1 = reduceRunFeedback(createInitialRunFeedbackState(), {
      type: "plan",
      at: 0,
      plan: {
        shape: { evals: 5, configs: 1, totalRuns: 5, maxConcurrency: 5 },
        reused: 2,
        reusedFailures: [],
      },
    });
    // plan 之后立刻(在任何 attempt 事件之前)守恒公式就应成立:2 个 reused + 3 个 queued。
    expect(state1.total).toBe(state1.reused + state1.running + state1.queued + state1.completed);
    expect(state1).toMatchObject({ total: 5, reused: 2, running: 0, queued: 3, completed: 0 });

    const a = ref("memory/a", 0, "compare/bub-e2b");
    const b = ref("memory/b", 0, "compare/bub-e2b");
    const c = ref("memory/c", 0, "compare/bub-e2b");
    const final = replay([
      { type: "plan", at: 0, plan: { shape: { evals: 5, configs: 1, totalRuns: 5, maxConcurrency: 5 }, reused: 2, reusedFailures: [] } },
      { type: "attempt:start", at: 1, identity: a, who: "bub-e2b", phase: "sandbox.create" },
      { type: "attempt:start", at: 1, identity: b, who: "bub-e2b", phase: "sandbox.create" },
      { type: "attempt:start", at: 1, identity: c, who: "bub-e2b", phase: "sandbox.create" },
      { type: "attempt:complete", at: 5, identity: a, who: "bub-e2b", verdict: "passed" },
      { type: "attempt:complete", at: 5, identity: b, who: "bub-e2b", verdict: "passed" },
      { type: "attempt:complete", at: 5, identity: c, who: "bub-e2b", verdict: "passed" },
    ]);
    expect(final).toMatchObject({ total: 5, reused: 2, running: 0, queued: 0, completed: 3 });
  });

  it("并发完成:多个 active attempt 以任意顺序结束,active map 逐条精确摘除", () => {
    const a = ref("memory/a");
    const b = ref("memory/b");
    const c = ref("memory/c");
    const d = ref("memory/d");
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 4, configs: 1, totalRuns: 4, maxConcurrency: 4 }, reused: 0, reusedFailures: [] },
    });
    for (const identity of [a, b, c, d]) {
      state = reduceRunFeedback(state, { type: "attempt:start", at: 1, identity, who: "codex", phase: "eval.run" });
    }
    expect(state.running).toBe(4);
    expect(state.active.size).toBe(4);

    // 乱序完成:C 最先完成,然后 A,再 D(errored + failure),最后 B。
    const order: Array<{ identity: AttemptRef; verdict: "passed" | "failed" | "errored" }> = [
      { identity: c, verdict: "passed" },
      { identity: a, verdict: "passed" },
      { identity: d, verdict: "errored" },
      { identity: b, verdict: "failed" },
    ];
    for (const { identity, verdict } of order) {
      state = reduceRunFeedback(state, { type: "attempt:complete", at: 2, identity, who: "codex", verdict });
      expect(state.total).toBe(state.reused + state.running + state.queued + state.completed);
      expect(state.active.size).toBe(state.running);
      // 每次完成后,已完成的那个 identity 必须已经从 active 里摘除,其余仍在的必须还在。
      expect(state.active.has(encodeAttemptKey(identity))).toBe(false);
    }
    expect(state).toMatchObject({ running: 0, completed: 4, queued: 0 });
  });

  it("early exit:未派发的重复轮次折进 completed,不产生 failures/diagnostics", () => {
    const first = ref("memory/retry", 0);
    const retry1 = ref("memory/retry", 1);
    const retry2 = ref("memory/retry", 2);
    const state = replay([
      { type: "plan", at: 0, plan: { shape: { evals: 1, configs: 1, totalRuns: 3, maxConcurrency: 3 }, reused: 0, reusedFailures: [] } },
      { type: "attempt:start", at: 1, identity: first, who: "codex", phase: "eval.run" },
      { type: "attempt:complete", at: 2, identity: first, who: "codex", verdict: "passed" },
      { type: "attempt:early-exit", at: 3, identity: retry1, who: "codex" },
      { type: "attempt:early-exit", at: 4, identity: retry2, who: "codex" },
    ]);
    expect(state).toMatchObject({ total: 3, reused: 0, running: 0, queued: 0, completed: 3 });
    expect(state.failures).toEqual([]);
    expect(state.diagnostics).toEqual([]);
  });

  it("errored:失败事件带 locator 写入 failures,重复同一 locator 幂等覆盖而不是重复追加", () => {
    const a = ref("memory/agent-029");
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 1, configs: 1, totalRuns: 1, maxConcurrency: 1 }, reused: 0, reusedFailures: [] },
    });
    state = reduceRunFeedback(state, {
      type: "attempt:start",
      at: 1,
      identity: a,
      who: "compare/claude-e2b",
      phase: "sandbox.create",
    });
    state = reduceRunFeedback(state, {
      type: "attempt:complete",
      at: 2,
      identity: a,
      who: "compare/claude-e2b",
      verdict: "errored",
    });
    state = reduceRunFeedback(state, {
      type: "failure",
      at: 2,
      locator: locator("2h8m4k1"),
      identity: a,
      who: "compare/claude-e2b",
      verdict: "errored",
      reason: "sandbox-rate-limit: E2B sandbox allocation failed after 5 attempts",
      phase: "sandbox.create",
    });
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]?.reason).toContain("sandbox-rate-limit");
    expect(state).toMatchObject({ total: 1, running: 0, completed: 1, queued: 0 });

    // 同一 locator 再来一次(比如 coordinator 重放/去抖动),覆盖而不是变成两条。
    state = reduceRunFeedback(state, {
      type: "failure",
      at: 3,
      locator: locator("2h8m4k1"),
      identity: a,
      who: "compare/claude-e2b",
      verdict: "errored",
      reason: "updated reason",
      phase: "sandbox.create",
    });
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]?.reason).toBe("updated reason");
  });

  it("budget:每次因预算跳过一个 attempt 就折进 completed,诊断按 experimentId 去重并累加 count", () => {
    const a = ref("memory/a", 0, "regression/codex");
    const b = ref("memory/b", 0, "regression/codex");
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 4, configs: 1, totalRuns: 4, maxConcurrency: 4 }, reused: 0, reusedFailures: [] },
    });
    state = reduceRunFeedback(state, { type: "attempt:start", at: 1, identity: a, who: "regression/codex", phase: "eval.run" });
    state = reduceRunFeedback(state, { type: "attempt:start", at: 1, identity: b, who: "regression/codex", phase: "eval.run" });
    state = reduceRunFeedback(state, { type: "attempt:complete", at: 2, identity: a, who: "regression/codex", verdict: "passed" });
    expect(state).toMatchObject({ total: 4, running: 1, queued: 2, completed: 1 });

    state = reduceRunFeedback(state, {
      type: "budget-exhausted",
      at: 3,
      experimentId: "regression/codex",
      spent: 25.1,
      unstarted: 1,
    });
    expect(state).toMatchObject({ total: 4, running: 1, queued: 1, completed: 2 });
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toMatchObject({ key: "budget-exhausted:regression/codex", count: 1, severity: "warning" });
    expect(state.diagnostics[0]?.data).toMatchObject({ experimentId: "regression/codex", spent: 25.1, unstarted: 1 });

    state = reduceRunFeedback(state, {
      type: "budget-exhausted",
      at: 4,
      experimentId: "regression/codex",
      spent: 25.31,
      unstarted: 2,
    });
    expect(state).toMatchObject({ total: 4, running: 1, queued: 0, completed: 3 });
    // 去重:同一个 experimentId 仍然只有一条诊断,count 累加到 2,data 更新到最新一次的值。
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toMatchObject({ count: 2 });
    expect(state.diagnostics[0]?.data).toMatchObject({ spent: 25.31, unstarted: 2 });

    state = reduceRunFeedback(state, { type: "attempt:complete", at: 5, identity: b, who: "regression/codex", verdict: "passed" });
    expect(state).toMatchObject({ total: 4, reused: 0, running: 0, queued: 0, completed: 4 });
  });

  it("interrupted:只追加一条去重诊断,不擅自改变 running/queued 计数(中断时的进行中 attempt 保持原状)", () => {
    const a = ref("memory/a");
    const b = ref("memory/b");
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 3, configs: 1, totalRuns: 3, maxConcurrency: 3 }, reused: 0, reusedFailures: [] },
    });
    state = reduceRunFeedback(state, { type: "attempt:start", at: 1, identity: a, who: "codex", phase: "eval.run" });
    const beforeInterrupt = state;
    state = reduceRunFeedback(state, { type: "interrupted", at: 2 });
    expect(state).toMatchObject({ total: 3, running: 1, queued: 2, completed: 0 });
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toMatchObject({ key: "interrupted", severity: "warning", count: 1 });
    // interrupted 只追加诊断,counts/active 与中断前完全一致(除了 diagnostics 数组本身)。
    expect(state.total).toBe(beforeInterrupt.total);
    expect(state.running).toBe(beforeInterrupt.running);
    expect(state.queued).toBe(beforeInterrupt.queued);
    expect(state.completed).toBe(beforeInterrupt.completed);
    expect(state.active).toBe(beforeInterrupt.active);

    // 再来一次 interrupted(理论上不该发生,防御性验证不会重复追加成两条)。
    state = reduceRunFeedback(state, { type: "interrupted", at: 3 });
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toMatchObject({ count: 2 });

    void b; // 未派发的第三个 attempt 停留在 queued,不需要单独事件也满足守恒公式。
  });

  it("summary / saved / attempt:queued 是纯粹的只读挂点:不改变任何计数或 active,原样返回同一份状态", () => {
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 1, configs: 1, totalRuns: 1, maxConcurrency: 1 }, reused: 0, reusedFailures: [] },
    });
    const afterQueuedNoop = reduceRunFeedback(state, {
      type: "attempt:queued",
      at: 1,
      identity: ref("memory/a"),
      who: "codex",
    });
    expect(afterQueuedNoop).toBe(state); // 引用相等:真正的 no-op,不产生垃圾对象

    const afterSummary = reduceRunFeedback(state, {
      type: "summary",
      at: 5,
      summary: {
        agent: "codex",
        startedAt: "2026-07-13T00:00:00.000Z",
        completedAt: "2026-07-13T00:01:00.000Z",
        passed: 1,
        failed: 0,
        skipped: 0,
        errored: 0,
        durationMs: 60_000,
        results: [],
      },
      completion: { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [] },
    });
    expect(afterSummary).toBe(state);

    const afterSaved = reduceRunFeedback(state, { type: "saved", at: 6, paths: [".niceeval/compare/bub-e2b/2026-07-13T000000Z"] });
    expect(afterSaved).toBe(state);
  });

  it("tick 只更新 elapsedMs,不影响其它任何字段", () => {
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 1, configs: 1, totalRuns: 1, maxConcurrency: 1 }, reused: 0, reusedFailures: [] },
    });
    const before = state;
    state = reduceRunFeedback(state, { type: "tick", at: 1000, elapsedMs: 1000 });
    expect(state.elapsedMs).toBe(1000);
    expect(state.total).toBe(before.total);
    expect(state.queued).toBe(before.queued);
    expect(state.active).toBe(before.active);
  });

  it("diagnostic:并发 attempt 报同一 warning 只保留一条,count 累加受影响次数", () => {
    const attempts = [ref("memory/a"), ref("memory/b"), ref("memory/c")];
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 3, configs: 1, totalRuns: 3, maxConcurrency: 3 }, reused: 0, reusedFailures: [] },
    });
    for (const identity of attempts) {
      state = reduceRunFeedback(state, {
        type: "diagnostic",
        at: 1,
        key: "memory-warmup-degraded",
        severity: "warning",
        message: "Memory warmup failed; continuing with a cold index",
        identity,
      });
    }
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toMatchObject({ key: "memory-warmup-degraded", count: 3 });
  });

  it("phase 变化清空上一个 phase 的 detail,不把旧阶段的次要文本带进新阶段", () => {
    const a = ref("memory/a");
    let state = createInitialRunFeedbackState();
    state = reduceRunFeedback(state, {
      type: "plan",
      at: 0,
      plan: { shape: { evals: 1, configs: 1, totalRuns: 1, maxConcurrency: 1 }, reused: 0, reusedFailures: [] },
    });
    state = reduceRunFeedback(state, { type: "attempt:start", at: 1, identity: a, who: "codex", phase: "eval.run" });
    state = reduceRunFeedback(state, { type: "attempt:progress", at: 2, identity: a, detail: "tool: shell" });
    expect([...state.active.values()][0]?.detail).toBe("tool: shell");
    state = reduceRunFeedback(state, { type: "attempt:phase", at: 3, identity: a, phase: "workspace.diff" });
    const activeAfterPhase = [...state.active.values()][0];
    expect(activeAfterPhase?.phase).toBe("workspace.diff");
    expect(activeAfterPhase?.detail).toBeUndefined();
  });
});
