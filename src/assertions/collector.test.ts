// cases: docs/engineering/testing/unit/assertions.md
// computePassed 的 gate 默认通过线单测(契约见
// docs/feature/verdict/architecture.md「Severity」与
// docs/feature/assertions/library/value-assertions.md「改严重度与阈值」):
// 省略阈值时 gate 的判定线是满分(score >= 1),不是「任意正分即过」。

import { describe, expect, it } from "vitest";
import { AssertionCollector } from "./collector.ts";
import * as Scoped from "./scoped.ts";
import { completeEvidenceCoverage } from "./coverage.ts";
import { emptyDiffData } from "./diff.ts";
import { computeVerdict } from "../shared/verdict.ts";
import { equals, includes, makeAssertion, similarity } from "../expect/index.ts";
import { EvalRequirementFailed } from "../context/control-flow.ts";
import type { AssertionResult, AssertionEvaluationContext, ValueAssertion } from "../types.ts";

function ctxWith(over: Partial<AssertionEvaluationContext> = {}): AssertionEvaluationContext {
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
    evidenceCoverage: completeEvidenceCoverage,
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
    expect(hit!.pointsAvailable).toBe(5);
    expect(miss!.pointsAvailable).toBe(5);
    expect([hit!.sourceOrder, miss!.sourceOrder]).toEqual([1, 2]);
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
    expect(result!.pointsAvailable).toBeUndefined();
  });

  it("unavailable 得分点保留可得分值但没有实得分", async () => {
    const collector = new AssertionCollector();
    collector.record({
      name: "judge unavailable",
      severity: "soft",
      evaluate: () => ({ unavailable: true, reason: "judge-call-failed" }),
    }).points(8);
    const [result] = await collector.finalize(ctxWith());
    expect(result).toMatchObject({
      outcome: "unavailable",
      reason: "judge-call-failed",
      pointsAvailable: 8,
      sourceOrder: 1,
    });
    expect(result).not.toHaveProperty("points");
  });

  it("持久化边界未开启 points 时，即使运行时链了 .points() 也不输出 points", async () => {
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 4)).points(5);
    const [result] = await collector.finalize(ctxWith(), { includePoints: false });
    expect(result!.outcome === "unavailable" ? undefined : result!.points).toBeUndefined();
    expect(result!.pointsAvailable).toBeUndefined();
  });

  it("n <= 0 或非有限数立即抛错(不是记一条失败断言)", () => {
    const collector = new AssertionCollector();
    const handle = collector.record(specForAssertion(equals(4), 4));
    expect(() => handle.points(0)).toThrow();
    expect(() => handle.points(-1)).toThrow();
    expect(() => handle.points(Number.NaN)).toThrow();
    expect(() => handle.points(Number.POSITIVE_INFINITY)).toThrow();
  });

  it(".points(n).gate() 同时进入分数面与判定面，但不隐式中止", async () => {
    const collector = new AssertionCollector({ evaluationKind: "points", liveContext: async () => ctxWith() });
    collector.record(specForAssertion(equals(4), 5)).points(10).gate();
    collector.record(specForAssertion(equals(4), 4)).points(2);
    expect(await collector.settlePrerequisites()).toBeUndefined();
    const results = await collector.finalize(ctxWith());
    expect(results).toHaveLength(2);
    expect(results[0]!.outcome === "unavailable" ? undefined : results[0]!.points).toBe(0);
    expect(results[0]).toMatchObject({ severity: "gate", outcome: "failed" });
    expect(results[0]).not.toHaveProperty("stopOnFailure");
    expect(computeVerdict({ assertions: results })).toBe("failed");
  });
});

describe("severity 与 stopOnFailure 正交", () => {
  const points = () => new AssertionCollector({ evaluationKind: "points", liveContext: async () => ctxWith() });

  it("matcher 自带的默认 gate 只贡献通过线,不使断言成为前置(回归:否则第一条检查点腰斩整题)", async () => {
    const collector = points();
    collector.record(specForAssertion(equals(4), 5)).points(3); // equals 默认 severity 是 gate
    expect(await collector.settlePrerequisites()).toBeUndefined(); // 没有前置,不中止
    const [result] = await collector.finalize(ctxWith());
    expect(result!.severity).toBe("soft"); // 降级为观测:丢分不参与判定
    expect(result!.outcome).toBe("failed"); // 通过线保留,没做到照记 failed
    expect(result!.outcome === "unavailable" ? undefined : result!.points).toBe(0);
    expect(computeVerdict({ assertions: [result!], strict: false })).toBe("passed");
    expect(computeVerdict({ assertions: [result!], strict: true })).toBe("failed");
  });

  it(".gate().stopOnFailure() 未过:保留失败结果并以 EvalRequirementFailed 就地中止", async () => {
    const collector = points();
    collector.score("早期给分", 5);
    const stopping = collector.record(specForAssertion(equals(4), 5)).points(1).gate();

    await expect(stopping.stopOnFailure()).rejects.toBeInstanceOf(EvalRequirementFailed);
    expect(collector.scoreEntries.map((e) => e.label)).toEqual(["早期给分"]);
    const results = await collector.finalize(ctxWith());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ severity: "gate", outcome: "failed", stopOnFailure: true, points: 0 });
    expect(computeVerdict({ assertions: results })).toBe("failed");
  });

  it(".atLeast(x).stopOnFailure() 中止控制流，但保持 soft severity", async () => {
    const collector = points();
    const stopping = collector.record({ name: "quality", severity: "soft", evaluate: () => 0.4 }).atLeast(0.7);

    await expect(stopping.stopOnFailure()).rejects.toBeInstanceOf(EvalRequirementFailed);
    const [result] = await collector.finalize(ctxWith());
    expect(result).toMatchObject({ severity: "soft", threshold: 0.7, outcome: "failed", stopOnFailure: true });
    expect(computeVerdict({ assertions: [result!], strict: false })).toBe("passed");
    expect(computeVerdict({ assertions: [result!], strict: true })).toBe("failed");
  });

  it("stopOnFailure 就地求值:结论定在链的位置，finalize 不按后续状态重算", async () => {
    let value = 5;
    const collector = points();
    const stopping = collector.record({
      name: "moving target",
      severity: "soft",
      evaluate: async () => (value === 4 ? 1 : 0),
    }).gate();
    await expect(stopping.stopOnFailure()).rejects.toBeInstanceOf(EvalRequirementFailed);
    value = 4;
    const [result] = await collector.finalize(ctxWith());
    expect(result!.outcome).toBe("failed");
  });

  it("stopOnFailure 求值异常在 catch 边界归一，finalize 仍保留错误链诊断", async () => {
    const collector = points();
    const socket = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const stopping = collector.record({
      name: "external prerequisite",
      severity: "gate",
      evaluate: async () => {
        throw new Error("judge wrapper", { cause: socket });
      },
    });

    await expect(stopping.stopOnFailure()).rejects.toBeInstanceOf(EvalRequirementFailed);
    const [result] = await collector.finalize(ctxWith());
    expect(result).toMatchObject({ outcome: "failed", score: 0, stopOnFailure: true });
    expect(result!.detail).toContain("judge wrapper");
    expect(result!.detail).toContain("caused by: Error (ECONNRESET): socket reset");
  });

  it("stopOnFailure 通过时返回原句柄，后续断言与给分照常保留", async () => {
    const collector = points();
    const stopping = collector.record(specForAssertion(equals(4), 4)).gate();
    expect(await stopping.stopOnFailure()).toBe(stopping);
    collector.record(specForAssertion(equals(4), 4)).points(2);
    collector.score("后续给分", 7);
    const results = await collector.finalize(ctxWith());
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ severity: "gate", outcome: "passed", stopOnFailure: true });
    expect(collector.scoreEntries).toHaveLength(1);
  });

  it("通过制同样只有 stopOnFailure 才中止；单独 gate 继续收集", async () => {
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 5)).gate();
    collector.record(specForAssertion(equals(4), 4));
    expect(await collector.settlePrerequisites()).toBeUndefined();
    const results = await collector.finalize(ctxWith());
    expect(results).toHaveLength(2); // 不截断
    expect(results[0]!.severity).toBe("gate");
    expect(computeVerdict({ assertions: results })).toBe("failed");
  });

  it("无线 soft 不能单独 stopOnFailure：报错要求先声明通过线", () => {
    const collector = points();
    const handle = collector.record({ name: "observation", severity: "soft", evaluate: () => 0.2 }).soft();
    expect(() => handle.stopOnFailure()).toThrow(/requires a passing line/);
  });
});

describe("计分制给分链路:t.score(label, n) 直接给分", () => {
  it("立即记录 ScoreEntry(不像断言那样等 finalize 求值),label 与 points 原样落盘", () => {
    const collector = new AssertionCollector();
    collector.score("代码精简", 15);
    expect(collector.scoreEntries).toEqual([{
      label: "代码精简",
      points: 15,
      sourceOrder: 1,
      loc: expect.anything(),
    }]);
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

// finalize 的判分推进回调(契约见 docs/feature/experiments/cli.md「Attempt 阶段」):
// 逐条 judge 断言在求值开始前报一次进度,纯反馈通道,不进 AssertionResult、不落盘。
describe("finalize 的 judge 推进回调", () => {
  /** 一条判分断言的最小 spec:带 judge 标记与检查方式摘要,求值记录调用顺序。 */
  function judgeSpec(check: string, order: string[]) {
    return {
      name: "judge:autoevals:closedQA",
      severity: "soft" as const,
      detail: check,
      judge: true as const,
      evaluate: async () => {
        order.push(`evaluate:${check}`);
        return 1;
      },
    };
  }

  it("逐条 judge 在求值开始前回调一次,携带第几条 / 总数 / 检查方式;非 judge 断言不回调", async () => {
    const order: string[] = [];
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 4));
    collector.record(judgeSpec('closedQA("是否切题?")', order));
    collector.record(specForAssertion(includes("Brooklyn"), "Brooklyn"));
    collector.record(judgeSpec('factuality("布鲁克林今天是晴天")', order));

    const seen: Array<{ index: number; total: number; check: string }> = [];
    const results = await collector.finalize(ctxWith(), {
      onJudgeProgress: (p) => {
        order.push(`progress:${p.index}/${p.total}`);
        seen.push(p);
      },
    });

    expect(seen).toEqual([
      { index: 1, total: 2, check: 'closedQA("是否切题?")' },
      { index: 2, total: 2, check: 'factuality("布鲁克林今天是晴天")' },
    ]);
    // 「求值开始前」:每条的 progress 都排在自己的 evaluate 之前。
    expect(order).toEqual([
      "progress:1/2",
      'evaluate:closedQA("是否切题?")',
      "progress:2/2",
      'evaluate:factuality("布鲁克林今天是晴天")',
    ]);
    expect(results).toHaveLength(4);
  });

  it("没有 judge 断言时一次都不回调", async () => {
    const collector = new AssertionCollector();
    collector.record(specForAssertion(equals(4), 4));
    collector.record(specForAssertion(includes("Brooklyn"), "Brooklyn"));

    const seen: unknown[] = [];
    await collector.finalize(ctxWith(), { onJudgeProgress: (p) => seen.push(p) });

    expect(seen).toEqual([]);
  });

  it("推进内容不进 AssertionResult(落盘形状与不带回调时逐字节相同)", async () => {
    const withCallback = new AssertionCollector();
    withCallback.record(judgeSpec('closedQA("是否切题?")', []));
    const [reported] = await withCallback.finalize(ctxWith(), { onJudgeProgress: () => {} });

    const without = new AssertionCollector();
    without.record(judgeSpec('closedQA("是否切题?")', []));
    const [plain] = await without.finalize(ctxWith());

    // loc 是各自 record 调用点的栈快照,天然不同;其余字段必须逐一相同。
    const withoutLoc = ({ loc: _loc, ...rest }: AssertionResult): Omit<AssertionResult, "loc"> => rest;
    expect(withoutLoc(reported!)).toEqual(withoutLoc(plain!));
    expect(reported).not.toHaveProperty("judge");
    expect(reported).not.toHaveProperty("index");
    expect(reported).not.toHaveProperty("total");
  });
});

describe("证据需求快照与 unavailable", () => {
  it("只把非 optional diff 消费者标成 required，且不把空 collector 误标 required", () => {
    const empty = new AssertionCollector();
    expect(empty.evidenceRequirementSnapshot().diff.required).toBe(false);

    const collector = new AssertionCollector();
    collector.record(Scoped.fileChanged("src/app.ts")).optional();
    expect(collector.evidenceRequirements().diff).toMatchObject({
      required: false,
      requiredConsumers: 0,
      optionalConsumers: 1,
    });

    collector.record(Scoped.fileDeleted("src/old.ts"));
    expect(collector.evidenceRequirements().diff).toMatchObject({
      required: true,
      requiredConsumers: 1,
      optionalConsumers: 1,
    });
  });

  it("diff unavailable 直接冻结对应断言；optional 不改变 Verdict", async () => {
    const collector = new AssertionCollector();
    collector.record(Scoped.fileChanged("src/required.ts"));
    collector.record(Scoped.fileChanged("src/optional.ts")).optional();
    collector.markEvidenceUnavailable("diff", "workspace-diff-unavailable");
    const results = await collector.finalize(ctxWith());

    expect(results.map((r) => r.outcome)).toEqual(["unavailable", "unavailable"]);
    expect(computeVerdict({ assertions: results, strict: false })).toBe("errored");
  });

  it("直接读取 diff 保守登记 required，不猜测任意值流绑定到哪条断言", () => {
    const collector = new AssertionCollector();
    collector.requireEvidence("diff");
    collector.record({
      name: "unrelated-value",
      severity: "gate",
      evaluate: () => 1,
    });
    expect(collector.evidenceRequirements().diff).toMatchObject({
      required: true,
      directReads: 1,
      requiredConsumers: 0,
    });
  });
});
