// cases: docs/engineering/testing/unit/experiments-runner.md
// evalConclusionRows 是 human/json 两个 profile 共用的纯派生:跑满给 attempts/rate,首过即停给
// attempts/planned/unstarted/reason=early_exit;fail-fast 与 budget 未派发的份额不得混进
// reason=early_exit(docs/feature/experiments/cli.md「runs 与首过即停怎样展示」)。

import { describe, expect, it } from "vitest";
import { evalConclusionRows } from "./eval-conclusions.ts";
import type { DiagnosticNotice, EvalResult } from "../types.ts";
import { completeEvidenceCoverage } from "../../assertions/coverage.ts";

function result(id: string, attempt: number, verdict: EvalResult["verdict"], extra: Partial<EvalResult> = {}): EvalResult {
  return {
    id,
    agent: "agent-x",
    verdict,
    attempt,
    durationMs: 1000,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    experimentId: "exp-a",
    locator: `@locator-${id}-${attempt}`,
    ...extra,
  };
}

function failFastDiagnostic(count: number, identity: DiagnosticNotice["identity"]): DiagnosticNotice {
  return {
    at: 0,
    key: "fail-fast:exp-a|agent-x|model-x|q1",
    severity: "warning",
    message: "deterministic error, stopped dispatching",
    count,
    identity,
  };
}

describe("evalConclusionRows", () => {
  it("纯跑满:attempts/passed/rate 从真实分母算出,代表 attempt 是序号最大的一条(最后完成的确定性近似)", () => {
    const results = [result("q1", 0, "passed"), result("q1", 1, "failed"), result("q1", 2, "passed")];
    const rows = evalConclusionRows(results, new Map(), []);
    expect(rows).toEqual([
      {
        experimentId: "exp-a",
        evalId: "q1",
        locator: "@locator-q1-2",
        verdict: "passed",
        attempts: 3,
        passed: 2,
        rate: 0.667,
      },
    ]);
  });

  it("首过即停:attempts/planned/unstarted/reason 按真正省略的次数给出,代表 attempt 是命中通过的那一次", () => {
    const results = [result("q1", 0, "passed")];
    const earlyExitByEval = new Map([["exp-a|q1", 2]]);
    const rows = evalConclusionRows(results, earlyExitByEval, []);
    expect(rows).toEqual([
      {
        experimentId: "exp-a",
        evalId: "q1",
        locator: "@locator-q1-0",
        verdict: "passed",
        attempts: 1,
        planned: 3,
        unstarted: 2,
        reason: "early_exit",
      },
    ]);
  });

  it("并发时已有在飞 attempt:passed 触发省略之前已经跑完的 attempt 照常计入 attempts,不是幽灵 unstarted", () => {
    // 3 个 attempt 并发在飞:一个 passed 触发首过即停,另一个已经在跑、跑完后照常计入(即便
    // verdict 是 failed);只有第三个还在等待集里的才真正被跳过。
    const results = [result("q1", 0, "passed"), result("q1", 1, "failed")];
    const earlyExitByEval = new Map([["exp-a|q1", 1]]);
    const rows = evalConclusionRows(results, earlyExitByEval, []);
    expect(rows[0]).toMatchObject({ attempts: 2, planned: 3, unstarted: 1, reason: "early_exit" });
  });

  it("fail-fast 未派发不得误标 early_exit:诊断份额从 earlyExitByEval 里扣完后按跑满渲染", () => {
    const results = [result("q1", 0, "errored")];
    const earlyExitByEval = new Map([["exp-a|q1", 2]]);
    const diagnostics = [failFastDiagnostic(2, { experimentId: "exp-a", evalId: "q1", attempt: 1 })];
    const rows = evalConclusionRows(results, earlyExitByEval, diagnostics);
    expect(rows[0]).toEqual({
      experimentId: "exp-a",
      evalId: "q1",
      locator: "@locator-q1-0",
      verdict: "errored",
      attempts: 1,
      passed: 0,
      rate: 0,
    });
    expect(rows[0]).not.toHaveProperty("reason");
  });

  it("fail-fast 只吃掉自己的份额:真正的首过即停省略与 fail-fast 未派发混在同一个 eval 时分开计数", () => {
    // 3 次 attempt:early-exit 里,2 次是 fail-fast(诊断 count=2),剩下 1 次才是真的首过即停。
    const results = [result("q1", 0, "passed")];
    const earlyExitByEval = new Map([["exp-a|q1", 3]]);
    const diagnostics = [failFastDiagnostic(2, { experimentId: "exp-a", evalId: "q1", attempt: 1 })];
    const rows = evalConclusionRows(results, earlyExitByEval, diagnostics);
    expect(rows[0]).toMatchObject({ attempts: 1, planned: 2, unstarted: 1, reason: "early_exit" });
  });

  it("budget 未派发的 attempt 没有对应 EvalResult、也不产生 attempt:early-exit,不误标 early_exit", () => {
    // budget 未派发不进 earlyExitByEval(结构性事实,这里用空 Map 模拟),即便这个 eval 明显
    // 没跑满(其它同 key 的 attempt 被 budget 挡下),该函数也只按已跑的分母给跑满分支,不猜。
    const results = [result("q1", 0, "passed"), result("q1", 1, "passed")];
    const rows = evalConclusionRows(results, new Map(), []);
    expect(rows[0]).not.toHaveProperty("reason");
    expect(rows[0]).toMatchObject({ attempts: 2, passed: 2, rate: 1 });
  });

  it("按 results 中每个 (experiment, eval) 首次出现的顺序返回;不同 experiment 各自一行,不合并", () => {
    const results = [
      result("q1", 0, "passed", { experimentId: "exp-b" }),
      result("q1", 0, "passed", { experimentId: "exp-a" }),
      result("q2", 0, "passed", { experimentId: "exp-a" }),
    ];
    const rows = evalConclusionRows(results, new Map(), []);
    expect(rows.map((r) => `${r.experimentId}|${r.evalId}`)).toEqual(["exp-b|q1", "exp-a|q1", "exp-a|q2"]);
  });

  it("没有 experimentId 的裸 run:字段省略(undefined),不是空字符串占位", () => {
    const results = [result("q1", 0, "passed", { experimentId: undefined })];
    const rows = evalConclusionRows(results, new Map(), []);
    expect(rows[0]!.experimentId).toBeUndefined();
  });

  it("空 results:空数组,不编造行", () => {
    expect(evalConclusionRows([], new Map(), [])).toEqual([]);
  });
});
