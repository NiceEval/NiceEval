// 证据完整性模型的单测:覆盖代数(resolve/downgrade/worst)、作用域断言的三值折叠、
// 判定折叠(非 optional unavailable → errored)、judge 未解析 → unavailable。
// 契约见 docs/feature/scoring/architecture/{severity-and-verdict,evidence}.md 与
// docs/feature/adapters/architecture/evidence.md。

import { describe, expect, it } from "vitest";
import { completeCoverage, downgradeCoverage, resolveAgentCoverage, worstCoverage } from "./coverage.ts";
import { computeVerdict } from "./verdict.ts";
import { AssertionCollector } from "./collector.ts";
import * as Scoped from "./scoped.ts";
import { buildJudge } from "./judge.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import type { AssertionResult, ScoringContext, StreamEvent } from "../types.ts";

function ctxWith(over: Partial<ScoringContext> = {}): ScoringContext {
  const events = (over.events ?? []) as StreamEvent[];
  return {
    events,
    facts: deriveRunFacts(events),
    diff: { generatedFiles: {}, deletedFiles: [] },
    scripts: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed",
    coverage: resolveAgentCoverage(completeCoverage),
    readFile: async () => undefined,
    ...over,
  };
}

const UNKNOWN = resolveAgentCoverage(undefined);

describe("coverage 代数", () => {
  it("未声明 = unknown,不是 complete", () => {
    expect(UNKNOWN.actions.status).toBe("unknown");
    expect(UNKNOWN.usage.status).toBe("unknown");
  });

  it("Turn 只能降级,不能把 Agent 未声明的通道升格成 complete", () => {
    const upgraded = downgradeCoverage(UNKNOWN, { actions: { status: "complete" } });
    expect(upgraded.actions.status).toBe("unknown");
    const downgraded = downgradeCoverage(resolveAgentCoverage(completeCoverage), {
      actions: { status: "partial", reason: "stream reconnected" },
    });
    expect(downgraded.actions).toEqual({ status: "partial", reason: "stream reconnected" });
  });

  it("聚合取最差值(unknown/unavailable < partial < complete)", () => {
    const a = resolveAgentCoverage(completeCoverage);
    const b = downgradeCoverage(a, { usage: { status: "unavailable" } });
    const worst = worstCoverage([a, b]);
    expect(worst.usage.status).toBe("unavailable");
    expect(worst.events.status).toBe("complete");
  });
});

async function evaluate(spec: ReturnType<typeof Scoped.usedNoTools>, ctx: ScoringContext): Promise<AssertionResult> {
  const collector = new AssertionCollector();
  collector.record(spec);
  const [result] = await collector.finalize(ctx);
  return result!;
}

describe("作用域断言的三值折叠", () => {
  const toolEvents: StreamEvent[] = [
    { type: "action.called", callId: "c1", name: "shell", input: { cmd: "ls" } } as StreamEvent,
    { type: "action.result", callId: "c1", output: {}, status: "completed" } as StreamEvent,
  ];

  it("正断言:非 complete 通道上找到匹配仍通过(证据存在就是证据)", async () => {
    const ctx = ctxWith({ events: toolEvents, coverage: UNKNOWN });
    const r = await evaluate(Scoped.calledTool("shell"), ctx);
    expect(r.outcome).toBe("passed");
  });

  it("正断言:非 complete 通道上没找到记 unavailable,不判失败", async () => {
    const ctx = ctxWith({ coverage: UNKNOWN });
    const r = await evaluate(Scoped.calledTool("shell"), ctx);
    expect(r.outcome).toBe("unavailable");
    expect(r.outcome === "unavailable" && r.reason).toContain("coverage:actions=unknown");
  });

  it("正断言:complete 通道上没找到才是 failed", async () => {
    const r = await evaluate(Scoped.calledTool("shell"), ctxWith());
    expect(r.outcome).toBe("failed");
  });

  it("负断言:找到反例即 failed(与覆盖无关)", async () => {
    const ctx = ctxWith({ events: toolEvents, coverage: UNKNOWN });
    const r = await evaluate(Scoped.notCalledTool("shell"), ctx);
    expect(r.outcome).toBe("failed");
  });

  it("负断言:空流 + 非 complete 通道 = unavailable(空流证明不了「没发生」)", async () => {
    const ctx = ctxWith({ coverage: UNKNOWN });
    const r = await evaluate(Scoped.usedNoTools(), ctx);
    expect(r.outcome).toBe("unavailable");
  });

  it("上限断言:实测已超限即 failed(partial 只会少采)", async () => {
    const ctx = ctxWith({ usage: { inputTokens: 900, outputTokens: 200 }, coverage: UNKNOWN });
    const r = await evaluate(Scoped.maxTokens(1000), ctx);
    expect(r.outcome).toBe("failed");
  });

  it("上限断言:未超限但 usage 通道非 complete = unavailable(不能按零聚合)", async () => {
    const ctx = ctxWith({ coverage: UNKNOWN });
    const r = await evaluate(Scoped.maxTokens(1000), ctx);
    expect(r.outcome).toBe("unavailable");
    expect(r.outcome === "unavailable" && r.reason).toContain("coverage:usage=unknown");
  });
});

describe("判定折叠:非 optional unavailable → errored", () => {
  const unavailableGate: AssertionResult = {
    name: "notCalledTool(bash)",
    severity: "gate",
    outcome: "unavailable",
    reason: "coverage:actions=partial",
  };
  const passedGate: AssertionResult = { name: "ok", severity: "gate", outcome: "passed", score: 1 };

  it("任一非 optional 断言 unavailable,attempt 即 errored(不分 gate/soft)", () => {
    expect(computeVerdict({ assertions: [passedGate, unavailableGate] })).toBe("errored");
    const softUnavailable: AssertionResult = { ...unavailableGate, severity: "soft" };
    expect(computeVerdict({ assertions: [passedGate, softUnavailable] })).toBe("errored");
  });

  it(".optional() 的 unavailable 只保留在记录里,不影响 Verdict", () => {
    const optional: AssertionResult = { ...unavailableGate, optional: true };
    expect(computeVerdict({ assertions: [passedGate, optional] })).toBe("passed");
  });

  it("errored 压过 failed;failed 压过 skipped", () => {
    const failedGate: AssertionResult = { name: "x", severity: "gate", outcome: "failed", score: 0 };
    expect(computeVerdict({ assertions: [failedGate, unavailableGate] })).toBe("errored");
    expect(computeVerdict({ assertions: [failedGate], skipReason: "later" })).toBe("failed");
  });
});

describe("judge 未解析到模型 / key:记 unavailable,绝不静默、不崩", () => {
  it("缺 key 时该条断言照常记录,finalize 落 unavailable(reason: judge-key-unresolved)", async () => {
    const collector = new AssertionCollector();
    const judge = buildJudge({
      record: (spec) => collector.record(spec),
      judge: { model: "gpt-x", apiKeyEnv: "NICEEVAL_TEST_NO_SUCH_KEY" },
      getOutput: () => "output",
      getInput: () => "input",
    });
    judge.autoevals.closedQA("是否切题?");
    const [r] = await collector.finalize(ctxWith());
    expect(r!.outcome).toBe("unavailable");
    expect(r!.outcome === "unavailable" && r!.reason).toContain("judge-key-unresolved");
  });

  it("缺 model 时不在调用点抛错,落 unavailable(reason: judge-model-unresolved)", async () => {
    const prevModel = process.env.NICEEVAL_JUDGE_MODEL;
    delete process.env.NICEEVAL_JUDGE_MODEL;
    try {
      const collector = new AssertionCollector();
      const judge = buildJudge({
        record: (spec) => collector.record(spec),
        judge: undefined,
        getOutput: () => "output",
        getInput: () => "input",
      });
      expect(() => judge.autoevals.factuality("参考答案").optional()).not.toThrow();
      const [r] = await collector.finalize(ctxWith());
      expect(r!.outcome).toBe("unavailable");
      expect(r!.outcome === "unavailable" && r!.reason).toContain("judge-model-unresolved");
      expect(r!.optional).toBe(true);
    } finally {
      if (prevModel !== undefined) process.env.NICEEVAL_JUDGE_MODEL = prevModel;
    }
  });
});
