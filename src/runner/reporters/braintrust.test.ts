import { describe, expect, it } from "vitest";
import { toBraintrustEvent } from "./braintrust.ts";
import type { EvalResult } from "../../types.ts";

function baseResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "algebra/quadratic",
    agent: "codex",
    verdict: "passed",
    attempt: 0,
    durationMs: 42_000,
    assertions: [],
    ...overrides,
  };
}

describe("toBraintrustEvent", () => {
  it("soft 断言按名字记分,gate 断言带 gate: 前缀", () => {
    const event = toBraintrustEvent(
      baseResult({
        assertions: [
          { name: "compiles", severity: "gate", score: 1, passed: true },
          { name: "closedQA", severity: "soft", score: 0.7, passed: true },
        ],
      }),
    );
    expect(event.scores).toEqual({ "gate:compiles": 1, closedQA: 0.7 });
  });

  it("重名断言追加 #n 消歧,分数被夹到 0..1", () => {
    const event = toBraintrustEvent(
      baseResult({
        assertions: [
          { name: "check", severity: "soft", score: 0.5, passed: true },
          { name: "check", severity: "soft", score: 2, passed: true },
          { name: "check", severity: "soft", score: -1, passed: false },
        ],
      }),
    );
    expect(event.scores).toEqual({ check: 0.5, "check#2": 1, "check#3": 0 });
  });

  it("metrics:start/end 由 startedAt+durationMs 推出,token/成本缺就不写", () => {
    const event = toBraintrustEvent(
      baseResult({
        startedAt: "2026-07-07T00:00:00.000Z",
        durationMs: 2_000,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
        estimatedCostUSD: 0.31,
      }),
    );
    const start = Date.parse("2026-07-07T00:00:00.000Z") / 1000;
    expect(event.metrics).toEqual({
      start,
      end: start + 2,
      prompt_tokens: 100,
      completion_tokens: 50,
      tokens: 150,
      cache_read_tokens: 10,
      estimated_cost_usd: 0.31,
    });

    const bare = toBraintrustEvent(baseResult());
    expect(bare.metrics).toEqual({});
  });

  it("output 取事件流里最后一条 assistant message", () => {
    const event = toBraintrustEvent(
      baseResult({
        events: [
          { type: "message", role: "user", text: "question" },
          { type: "message", role: "assistant", text: "draft" },
          { type: "message", role: "assistant", text: "final answer" },
        ],
      }),
    );
    expect(event.output).toBe("final answer");
    expect(toBraintrustEvent(baseResult()).output).toBeUndefined();
  });

  it("metadata 带身份维度与失败断言明细;id 在 (experiment, eval, agent, model, attempt) 上唯一", () => {
    const event = toBraintrustEvent(
      baseResult({
        experimentId: "compare/codex",
        model: "gpt-5.2",
        attempt: 1,
        verdict: "failed",
        experiment: { id: "compare/codex", flags: { tape: true } },
        assertions: [{ name: "compiles", severity: "gate", score: 0, passed: false, detail: "tsc failed" }],
      }),
    );
    expect(event.metadata).toEqual({
      eval: "algebra/quadratic",
      agent: "codex",
      attempt: 1,
      verdict: "failed",
      model: "gpt-5.2",
      experiment: "compare/codex",
      flags: { tape: true },
      failedAssertions: [{ name: "compiles", detail: "tsc failed" }],
    });
    expect(event.id).toBe("compare/codex|algebra/quadratic|codex|gpt-5.2|a1");
    const other = toBraintrustEvent(baseResult({ experimentId: "compare/codex", model: "gpt-5.2", attempt: 2 }));
    expect(other.id).not.toBe(event.id);
  });
});
