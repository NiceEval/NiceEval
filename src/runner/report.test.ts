import { describe, expect, it } from "vitest";
import { filterSummary, scopeReporter } from "./report.ts";
import type { Agent, EvalResult, Reporter, RunShape, RunSummary } from "../types.ts";

function result(id: string, overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id,
    agent: "codex",
    outcome: "passed",
    attempt: 0,
    durationMs: 1000,
    assertions: [],
    ...overrides,
  };
}

function summary(results: EvalResult[]): RunSummary {
  return {
    agent: "codex",
    startedAt: "2026-07-07T00:00:00.000Z",
    completedAt: "2026-07-07T00:01:00.000Z",
    passed: results.filter((r) => r.outcome === "passed").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    skipped: 0,
    errored: 0,
    durationMs: 60_000,
    results,
    outputDir: ".niceeval/x",
  };
}

describe("filterSummary", () => {
  it("按 eval id 过滤结果并重新计数,保留原 completedAt / outputDir", () => {
    const s = summary([
      result("a/1", { usage: { inputTokens: 10, outputTokens: 5 }, estimatedCostUSD: 0.1 }),
      result("a/1", { outcome: "failed", attempt: 1 }),
      result("b/1", { usage: { inputTokens: 100, outputTokens: 50 }, estimatedCostUSD: 1 }),
    ]);
    const sub = filterSummary(s, new Set(["a/1"]));
    expect(sub.results.map((r) => r.id)).toEqual(["a/1", "a/1"]);
    expect(sub.passed).toBe(1);
    expect(sub.failed).toBe(1);
    expect(sub.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(sub.estimatedCostUSD).toBe(0.1);
    expect(sub.completedAt).toBe("2026-07-07T00:01:00.000Z");
    expect(sub.outputDir).toBe(".niceeval/x");
  });
});

describe("scopeReporter", () => {
  const agent = { name: "codex" } as Agent;
  const scopedShape: RunShape = { evals: 1, configs: 1, totalRuns: 2, maxConcurrency: 4 };

  function recordingReporter() {
    const calls: { method: string; args: unknown[] }[] = [];
    const reporter: Reporter = {
      onRunStart: (...args) => void calls.push({ method: "onRunStart", args }),
      onEvalComplete: (...args) => void calls.push({ method: "onEvalComplete", args }),
      onRunComplete: (...args) => void calls.push({ method: "onRunComplete", args }),
      onEvent: (...args) => void calls.push({ method: "onEvent", args }),
    };
    return { calls, reporter };
  }

  it("onRunStart 收到过滤后的 eval 列表和作用域 shape", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]), scopedShape);
    await scoped.onRunStart?.([{ id: "a/1" }, { id: "b/1" }], agent, { evals: 2, configs: 1, totalRuns: 4, maxConcurrency: 4 });
    expect(calls[0]?.args).toEqual([[{ id: "a/1" }], agent, scopedShape]);
  });

  it("onEvalComplete 只转发被观测 eval 的结果", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]));
    await scoped.onEvalComplete?.(result("b/1"));
    await scoped.onEvalComplete?.(result("a/1"));
    expect(calls).toHaveLength(1);
    expect((calls[0]?.args[0] as EvalResult).id).toBe("a/1");
  });

  it("onRunComplete 收到重新计数的子集汇总", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]));
    await scoped.onRunComplete?.(summary([result("a/1"), result("b/1", { outcome: "failed" })]));
    const got = calls[0]?.args[0] as RunSummary;
    expect(got.results.map((r) => r.id)).toEqual(["a/1"]);
    expect(got.passed).toBe(1);
    expect(got.failed).toBe(0);
  });

  it("onEvent 过滤 eval 级事件,重写汇总类事件", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]), scopedShape);
    await scoped.onEvent?.({ type: "eval:start", eval: { id: "b/1" }, agent, attempt: 0 });
    await scoped.onEvent?.({ type: "eval:start", eval: { id: "a/1" }, agent, attempt: 0 });
    await scoped.onEvent?.({ type: "run:summary", summary: summary([result("a/1"), result("b/1")]) });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args[0]).toMatchObject({ type: "eval:start", eval: { id: "a/1" } });
    const summaryEvent = calls[1]?.args[0] as { type: string; summary: RunSummary };
    expect(summaryEvent.type).toBe("run:summary");
    expect(summaryEvent.summary.results.map((r) => r.id)).toEqual(["a/1"]);
  });

  it("底层 reporter 未实现的回调不会被包装出来", () => {
    const scoped = scopeReporter({}, new Set(["a/1"]));
    expect(scoped.onRunStart).toBeUndefined();
    expect(scoped.onEvalComplete).toBeUndefined();
    expect(scoped.onRunComplete).toBeUndefined();
    expect(scoped.onEvent).toBeUndefined();
  });
});
