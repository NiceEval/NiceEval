// cases: docs/engineering/testing/unit/scoring.md
// computePassed 的 gate 默认通过线单测(契约见
// docs/feature/verdict/architecture.md「Severity」与
// docs/feature/assertions/library/value-assertions.md「改严重度与阈值」):
// 省略阈值时 gate 的判定线是满分(score >= 1),不是「任意正分即过」。

import { describe, expect, it } from "vitest";
import { AssertionCollector } from "./collector.ts";
import { completeCoverage, resolveAgentCoverage } from "./coverage.ts";
import { emptyDiffData } from "./diff.ts";
import { computeVerdict } from "./verdict.ts";
import { equals, includes, makeAssertion, similarity } from "../expect/index.ts";
import type { AssertionResult, ScoringContext, ValueAssertion } from "../types.ts";

function ctxWith(over: Partial<ScoringContext> = {}): ScoringContext {
  return {
    events: [],
    facts: {
      toolCalls: [],
      subagentCalls: [],
      inputRequests: [],
      parked: false,
      messageCount: 0,
      compactions: 0,
      contextInjections: 0,
    },
    diff: emptyDiffData(),
    scripts: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed",
    coverage: resolveAgentCoverage(completeCoverage),
    readFile: async () => undefined,
    ...over,
  };
}

// 镜像 context.ts 里 t.check 的包装口径:evaluate 只返回原始 score,
// outcome 完全交给 collector.finalize 里的 computePassed 判定。
function specForAssertion(assertion: ValueAssertion, value: unknown) {
  return {
    name: assertion.name,
    severity: assertion.severity,
    threshold: assertion.threshold,
    evaluate: async () => await assertion.score(value),
  };
}

async function evaluate(assertion: ValueAssertion, value: unknown): Promise<AssertionResult> {
  const collector = new AssertionCollector();
  collector.record(specForAssertion(assertion, value));
  const [result] = await collector.finalize(ctxWith());
  return result!;
}

// unavailable 没有 score 字段;测试只关心 passed/failed 分支,评不了直接报错暴露问题。
function scoreOf(result: AssertionResult): number {
  if (result.outcome === "unavailable") throw new Error(`unexpected unavailable: ${result.reason}`);
  return result.score;
}

describe("gate 省略阈值:0/1 matcher 不受满分线改动影响(回归)", () => {
  it("equals 命中记满分通过,未命中记 0 分失败", async () => {
    const hit = await evaluate(equals(4), 4);
    expect(hit.outcome).toBe("passed");
    expect(scoreOf(hit)).toBe(1);

    const miss = await evaluate(equals(4), 5);
    expect(miss.outcome).toBe("failed");
    expect(scoreOf(miss)).toBe(0);
  });

  it("includes 命中通过,未命中失败", async () => {
    const hit = await evaluate(includes("Brooklyn"), "天气见 Brooklyn 播报");
    expect(hit.outcome).toBe("passed");

    const miss = await evaluate(includes("Brooklyn"), "天气见 Chicago 播报");
    expect(miss.outcome).toBe("failed");
  });
});

describe("gate 省略阈值:连续打分断言(judge 类)按满分线判定", () => {
  it("0.7 分未达满分,记为 failed", async () => {
    const partial = makeAssertion({ name: "continuousScore", score: () => 0.7 });
    const result = await evaluate(partial, "irrelevant");
    expect(result.outcome).toBe("failed");
    expect(scoreOf(result)).toBe(0.7);
  });

  it("1.0 分满分,记为 passed", async () => {
    const perfect = makeAssertion({ name: "continuousScore", score: () => 1.0 });
    const result = await evaluate(perfect, "irrelevant");
    expect(result.outcome).toBe("passed");
    expect(scoreOf(result)).toBe(1);
  });
});

describe("计分制给分链路:.points(n) 挂在断言上", () => {
  it("0/1 断言通过挣满 n 分,不过挣 0 分", async () => {
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 4)).points(5);
    collector.record(specForAssertion(equals(4), 5)).points(5);
    const [hit, miss] = await collector.finalize(ctxWith());
    expect(hit!.outcome === "unavailable" ? undefined : hit!.points).toBe(5);
    expect(miss!.outcome === "unavailable" ? undefined : miss!.points).toBe(0);
  });

  it("连续打分断言(judge 类)按 n × score 比例挣分", async () => {
    const collector = new AssertionCollector();
    const partial = makeAssertion({ name: "continuousScore", score: () => 0.8 });
    collector.record(specForAssertion(partial, "irrelevant")).points(20);
    const [result] = await collector.finalize(ctxWith());
    expect(result!.outcome === "unavailable" ? undefined : result!.points).toBe(16);
  });

  it("未链 .points() 的断言:AssertionResult.points 省略,不是 0(两个读数不同)", async () => {
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 4));
    const [result] = await collector.finalize(ctxWith());
    expect(result!.outcome === "unavailable" ? undefined : result!.points).toBeUndefined();
  });

  it("持久化边界未开启 points 时，即使运行时链了 .points() 也不输出 points", async () => {
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 4)).points(5);
    const [result] = await collector.finalize(ctxWith(), { includePoints: false });
    expect(result!.outcome === "unavailable" ? undefined : result!.points).toBeUndefined();
  });

  it("n <= 0 或非有限数立即抛错(不是记一条失败断言)", () => {
    const collector = new AssertionCollector();
    const handle = collector.record(specForAssertion(equals(4), 4));
    expect(() => handle.points(0)).toThrow();
    expect(() => handle.points(-1)).toThrow();
    expect(() => handle.points(Number.NaN)).toThrow();
    expect(() => handle.points(Number.POSITIVE_INFINITY)).toThrow();
  });

  it(".points(n).gate() 同时挣分与声明前置,两个字段互不覆盖", async () => {
    const collector = new AssertionCollector({ scoring: "points", liveContext: async () => ctxWith() });
    collector.record(specForAssertion(equals(4), 4)).points(10).gate();
    expect(await collector.settlePrerequisites()).toBeUndefined(); // 前置过了,不中止
    const [result] = await collector.finalize(ctxWith());
    expect(result!.outcome === "unavailable" ? undefined : result!.points).toBe(10);
    expect(result!.severity).toBe("gate");
  });
});

describe("计分制的角色互斥:severity 只从断言句柄读", () => {
  const points = () => new AssertionCollector({ scoring: "points", liveContext: async () => ctxWith() });

  it("matcher 自带的默认 gate 只贡献通过线,不使断言成为前置(回归:否则第一条检查点腰斩整题)", async () => {
    const collector = points();
    collector.record(specForAssertion(equals(4), 5)).points(3); // equals 默认 severity 是 gate
    expect(await collector.settlePrerequisites()).toBeUndefined(); // 没有前置,不中止
    const [result] = await collector.finalize(ctxWith());
    expect(result!.severity).toBe("soft"); // 降级为观测:丢分不参与判定
    expect(result!.outcome).toBe("failed"); // 通过线保留,没做到照记 failed
    expect(result!.outcome === "unavailable" ? undefined : result!.points).toBe(0);
    expect(computeVerdict({ assertions: [result!], strict: true, scoring: "points" })).toBe("passed");
  });

  it("句柄上的 .gate() 未过:就地求值 + 截断到中止点(后面记录的断言与给分一律丢弃)", async () => {
    const collector = points();
    collector.score("早期给分", 5);
    collector.record(specForAssertion(equals(4), 5)).points(1).gate();
    // 作者没 await:中止之后的同步记录照样进了 collector,由 settle 统一截断回中止点。
    collector.record(specForAssertion(equals(4), 4)).points(99);
    collector.score("永不计入", 100);

    expect(await collector.settlePrerequisites()).toBe('equals(4)');
    expect(collector.scoreEntries.map((e) => e.label)).toEqual(["早期给分"]);
    const results = await collector.finalize(ctxWith());
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("gate");
    expect(results[0]!.outcome).toBe("failed");
    expect(computeVerdict({ assertions: results, scoring: "points" })).toBe("failed");
  });

  it("前置就地求值:结论定在写下的位置,之后运行结果再变也不改判(finalize 不重新求值)", async () => {
    let value = 5;
    const collector = points();
    collector.record({
      name: "moving target",
      severity: "soft",
      evaluate: async () => (value === 4 ? 1 : 0),
    }).gate();
    expect(await collector.settlePrerequisites()).toBe("moving target");
    value = 4; // 前置之后世界变了:结论不跟着变
    const [result] = await collector.finalize(ctxWith());
    expect(result!.outcome).toBe("failed");
  });

  it("前置过了就不中止,后续断言与给分照常保留", async () => {
    const collector = points();
    collector.record(specForAssertion(equals(4), 4)).gate();
    collector.record(specForAssertion(equals(4), 4)).points(2);
    collector.score("后续给分", 7);
    expect(await collector.settlePrerequisites()).toBeUndefined();
    const results = await collector.finalize(ctxWith());
    expect(results).toHaveLength(2);
    expect(collector.scoreEntries).toHaveLength(1);
  });

  it("通过制不受影响:matcher 的默认 gate 照旧是硬门槛,.gate() 不中止执行", async () => {
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 5));
    collector.record(specForAssertion(equals(4), 4));
    expect(await collector.settlePrerequisites()).toBeUndefined();
    const results = await collector.finalize(ctxWith());
    expect(results).toHaveLength(2); // 不截断
    expect(results[0]!.severity).toBe("gate");
    expect(computeVerdict({ assertions: results })).toBe("failed");
  });
});

describe("计分制给分链路:t.score(label, n) 直接给分", () => {
  it("立即记录 ScoreEntry(不像断言那样等 finalize 求值),label 与 points 原样落盘", () => {
    const collector = new AssertionCollector();
    collector.score("代码精简", 15);
    expect(collector.scoreEntries).toEqual([{ label: "代码精简", points: 15, loc: expect.anything() }]);
  });

  it("groupPath 跟随当前 t.group 栈,与断言同一份分组约定", async () => {
    const collector = new AssertionCollector();
    await collector.withGroup("代码质量", () => {
      collector.score("代码精简", 15);
    });
    collector.score("无分组", 3);
    expect(collector.scoreEntries[0]!.groupPath).toEqual(["代码质量"]);
    expect(collector.scoreEntries[1]!.groupPath).toBeUndefined();
  });

  it("n < 0 或非有限数立即抛错", () => {
    const collector = new AssertionCollector();
    expect(() => collector.score("x", -1)).toThrow();
    expect(() => collector.score("x", Number.NaN)).toThrow();
    expect(() => collector.score("x", Number.POSITIVE_INFINITY)).toThrow();
  });

  it("n === 0 合法(叠加制允许贡献 0 分)", () => {
    const collector = new AssertionCollector();
    expect(() => collector.score("x", 0)).not.toThrow();
    expect(collector.scoreEntries).toHaveLength(1);
  });
});

describe("无参 .soft():降级为纯记录,不设线", () => {
  it("分数照实落盘,即便原始条件不成立(score=0 依旧记 passed)", async () => {
    const result = await evaluate(equals(4).soft(), 5);
    expect(result.outcome).toBe("passed");
    expect(scoreOf(result)).toBe(0);
    expect(result.outcome === "unavailable" ? undefined : result.threshold).toBeUndefined();
  });

  it("即便此前链过 .atLeast(x) 留下阈值,.soft() 也会清空阈值、永不判 failed", async () => {
    // "completely different" 与 "Brooklyn" 编辑距离很大,相似度远低于 0.9 的旧阈值。
    const result = await evaluate(similarity("Brooklyn").atLeast(0.9).soft(), "completely different");
    expect(result.outcome).toBe("passed");
    expect(result.outcome === "unavailable" ? undefined : result.threshold).toBeUndefined();
  });

  it("--strict 模式下无阈值的 soft 依旧只记录、不改判 failed(strict 只翻转有阈值的 soft)", async () => {
    const result = await evaluate(equals(4).soft(), 5);
    expect(computeVerdict({ assertions: [result], strict: false })).toBe("passed");
    expect(computeVerdict({ assertions: [result], strict: true })).toBe("passed");
  });
});
