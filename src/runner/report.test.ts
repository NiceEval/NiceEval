// cases: docs/engineering/testing/unit/experiments-runner.md
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitReporterEvent, filterSummary, runReporter, scopeReporter } from "./report.ts";
import { activateFeedbackSink, activeFeedbackSinkCount } from "./feedback/sink.ts";
import type { Agent, EvalResult, InvocationShape, InvocationSummary, Reporter, ReporterRegistration } from "../types.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";

function result(id: string, overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id,
    agent: "codex",
    verdict: "passed",
    attempt: 0,
    durationMs: 1000,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    ...overrides,
  };
}

function summary(results: EvalResult[]): InvocationSummary {
  return {
    startedAt: "2026-07-07T00:00:00.000Z",
    completedAt: "2026-07-07T00:01:00.000Z",
    passed: results.filter((r) => r.verdict === "passed").length,
    failed: results.filter((r) => r.verdict === "failed").length,
    skipped: 0,
    errored: 0,
    durationMs: 60_000,
    results,
  };
}

describe("filterSummary", () => {
  it("按 eval id 过滤结果并重新计数,保留原 completedAt", () => {
    const s = summary([
      result("a/1", { usage: { inputTokens: 10, outputTokens: 5 }, estimatedCostUSD: 0.1 }),
      result("a/1", { verdict: "failed", attempt: 1 }),
      result("b/1", { usage: { inputTokens: 100, outputTokens: 50 }, estimatedCostUSD: 1 }),
    ]);
    const sub = filterSummary(s, new Set(["a/1"]));
    expect(sub.results.map((r) => r.id)).toEqual(["a/1", "a/1"]);
    expect(sub.passed).toBe(1);
    expect(sub.failed).toBe(1);
    expect(sub.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(sub.estimatedCostUSD).toBe(0.1);
    expect(sub.completedAt).toBe("2026-07-07T00:01:00.000Z");
  });
});

describe("scopeReporter", () => {
  const agent = { name: "codex" } as Agent;
  const scopedShape: InvocationShape = { evals: 1, configs: 1, totalAttempts: 2, maxConcurrency: 4 };

  function recordingReporter() {
    const calls: { method: string; args: unknown[] }[] = [];
    const reporter: Reporter = {
      onInvocationStart: (...args) => void calls.push({ method: "onInvocationStart", args }),
      onEvalComplete: (...args) => void calls.push({ method: "onEvalComplete", args }),
      onInvocationComplete: (...args) => void calls.push({ method: "onInvocationComplete", args }),
      onEvent: (...args) => void calls.push({ method: "onEvent", args }),
    };
    return { calls, reporter };
  }

  it("onInvocationStart 收到过滤后的 eval 列表和作用域 shape", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]), scopedShape);
    await scoped.onInvocationStart?.([{ id: "a/1" }, { id: "b/1" }], { evals: 2, configs: 1, totalAttempts: 4, maxConcurrency: 4 });
    expect(calls[0]?.args).toEqual([[{ id: "a/1" }], scopedShape]);
  });

  it("onEvalComplete 只转发被观测 eval 的结果", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]));
    await scoped.onEvalComplete?.(result("b/1"));
    await scoped.onEvalComplete?.(result("a/1"));
    expect(calls).toHaveLength(1);
    expect((calls[0]?.args[0] as EvalResult).id).toBe("a/1");
  });

  it("onInvocationComplete 收到重新计数的子集汇总", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]));
    await scoped.onInvocationComplete?.(summary([result("a/1"), result("b/1", { verdict: "failed" })]));
    const got = calls[0]?.args[0] as InvocationSummary;
    expect(got.results.map((r) => r.id)).toEqual(["a/1"]);
    expect(got.passed).toBe(1);
    expect(got.failed).toBe(0);
  });

  it("onEvent 过滤 eval 级事件,重写汇总类事件", async () => {
    const { calls, reporter } = recordingReporter();
    const scoped = scopeReporter(reporter, new Set(["a/1"]), scopedShape);
    await scoped.onEvent?.({ type: "eval:start", eval: { id: "b/1" }, agent, attempt: 0 });
    await scoped.onEvent?.({ type: "eval:start", eval: { id: "a/1" }, agent, attempt: 0 });
    await scoped.onEvent?.({ type: "invocation:summary", summary: summary([result("a/1"), result("b/1")]) });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args[0]).toMatchObject({ type: "eval:start", eval: { id: "a/1" } });
    const summaryEvent = calls[1]?.args[0] as { type: string; summary: InvocationSummary };
    expect(summaryEvent.type).toBe("invocation:summary");
    expect(summaryEvent.summary.results.map((r) => r.id)).toEqual(["a/1"]);
  });

  it("底层 reporter 未实现的回调不会被包装出来", () => {
    const scoped = scopeReporter({}, new Set(["a/1"]));
    expect(scoped.onInvocationStart).toBeUndefined();
    expect(scoped.onEvalComplete).toBeUndefined();
    expect(scoped.onInvocationComplete).toBeUndefined();
    expect(scoped.onEvent).toBeUndefined();
  });
});

// runReporter()/emitReporterEvent() 是「required/best-effort」判定实际生效的地方(见
// `ReporterRegistration` 的字段注释):它们只负责把 reg.name/reg.required 原样转发进
// `reportReporterError()`,不做判定本身——判定(是否让 completion/CI 退出码判红)在下游
// (coordinator → reducer → cli.ts 的 assembleInvocationCompletion)。这里用一个假 FeedbackSink
// 直接断言转发的字段,不需要拉起整个 coordinator。
describe("runReporter / emitReporterEvent · required/best-effort 原样转发,不吞错也不中断其它 reporter", () => {
  afterEach(() => {
    // 每个 activateFeedbackSink() 都要在测试内退出,避免遗留在 sink.ts 的活跃栈里
    // 污染下一个测试(与 feedback/coordinator.test.ts 同一条兜底校验)。
    expect(activeFeedbackSinkCount()).toBe(0);
  });

  function withFakeSink<T>(
    fn: (calls: { reporter: string; required: boolean; message: string }[]) => Promise<T>,
  ): Promise<T> {
    const calls: { reporter: string; required: boolean; message: string }[] = [];
    const deactivate = activateFeedbackSink({
      activity() {},
      diagnostic() {},
      interrupted() {},
      reporterError(input) {
        calls.push(input);
      },
      failure() {},
      budgetExhausted() {},
      kept() {},
      experimentHook() {},
      experimentProgress() {},
      precheck() {},
      lockWait() {},
      runActivity() {},
      lifecycle() {},
    });
    return fn(calls).finally(deactivate);
  }

  it("required reporter 抛错:reportReporterError 收到注册时的真实 name 与 required=true,而不是 stage 名字", () =>
    withFakeSink(async (calls) => {
      const reg: ReporterRegistration = { reporter: {}, name: "artifacts", required: true };
      await runReporter(reg, "onEvalComplete", () => {
        throw new Error("disk full");
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ reporter: "artifacts", required: true });
      // stage 是失败发生阶段的次要上下文,拼进 message,不覆盖 reporter 字段本身。
      expect(calls[0]!.message).toContain("onEvalComplete");
      expect(calls[0]!.message).toContain("disk full");
    }));

  it("message 只含 formatThrown() 的第一行,不把完整 .stack(本地绝对路径 + 调用帧)灌进机器 envelope", () =>
    withFakeSink(async (calls) => {
      const reg: ReporterRegistration = { reporter: {}, name: "json", required: true };
      await runReporter(reg, "onInvocationComplete", () => {
        // 真实 Error 的 .stack 恒为多行:第一行 "Error: message",之后每行一个 "    at ..." 调用帧
        // (含本地绝对文件路径)。reportReporterError 的 message 是喂给 agent/ci 的单行 key=value
        // envelope 里的一个字段值,不是 EvalResult.error 那种有专门落盘位置的完整记录——必须只取
        // 第一行,不能把调用栈和本地路径原样透传出去。
        throw new Error("EISDIR: illegal operation on a directory, rename");
      });
      expect(calls).toHaveLength(1);
      const { message } = calls[0]!;
      expect(message).toBe("onInvocationComplete: Error: EISDIR: illegal operation on a directory, rename");
      expect(message).not.toContain("\n");
      expect(message).not.toContain("    at ");
      expect(message).not.toContain(import.meta.url.replace("file://", "")); // 本文件自己的绝对路径不出现在调用帧里
    }));

  it("best-effort reporter(如 config.reporters)抛错同样上报,但 required=false", () =>
    withFakeSink(async (calls) => {
      const reg: ReporterRegistration = { reporter: {}, name: "config-reporter-0", required: false };
      await runReporter(reg, "onInvocationComplete", () => {
        throw new Error("network blip");
      });
      expect(calls[0]).toMatchObject({ reporter: "config-reporter-0", required: false });
    }));

  it("runReporter 永不 reject——即便 reporter 抛错,调用方(Promise.all 聚合)仍能等到它 resolve", () =>
    withFakeSink(async () => {
      await expect(
        runReporter({ reporter: {}, name: "x", required: true }, "onInvocationStart", () => {
          throw new Error("boom");
        }),
      ).resolves.toBeUndefined();
    }));

  it("emitReporterEvent 对每个注册项独立兜错:一个 reporter 抛错不阻止其它 reporter 收到同一个事件", () =>
    withFakeSink(async (calls) => {
      const seen: string[] = [];
      const throwing: ReporterRegistration = {
        reporter: {
          onEvent: () => {
            throw new Error("boom");
          },
        },
        name: "throwing",
        required: false,
      };
      const ok: ReporterRegistration = {
        reporter: { onEvent: (e) => void seen.push(e.type) },
        name: "ok",
        required: false,
      };
      await emitReporterEvent([throwing, ok], { type: "invocation:earlyExit", evalId: "e/1" });
      expect(seen).toEqual(["invocation:earlyExit"]); // ok reporter 仍然收到了同一个事件
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ reporter: "throwing", required: false });
    }));

  it("没有活跃 coordinator 时(run 未激活 / 已 finish)退回 bootstrap stderr,不吞错、仍然 resolve", async () => {
    expect(activeFeedbackSinkCount()).toBe(0); // 确认这条测试真的走的是「没有活跃 sink」分支
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(
        runReporter({ reporter: {}, name: "artifacts", required: true }, "onInvocationStart", () => {
          throw new Error("disk full");
        }),
      ).resolves.toBeUndefined();
      // 不吞错:退回 bootstrap 出口确实被调用了一次,不是静默丢弃。具体落地的字节属于渲染
      // 事实,由 e2e 在真实进程输出上验收;这里只证明「有没有发生」。
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
