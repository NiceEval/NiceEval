// cases: docs/engineering/testing/unit/reports.md
// 「show 的范围 × 切片正交」deltaTableData 判据段。
// deltaTableData(对照矩阵):配对身份是 eval id、翻转标记的数据面、逐行 Δ 为原始差值且缺失不为
// 0、runs>1 的格内折叠(verdict 按默认报告口径、tokens/成本合计)、totals 与 pairedDelta 两个不同分母
// 的口径(fixture 让两侧覆盖不同,抓出直接相减各自 totals 的错误算法)、混型分段、conditionsByFlag
// 派生(单一可比性桶、0 候选空态、by 非 experiment 报错)。show/compare.md 示例数字复算作 fixture。

import { describe, expect, it } from "vitest";
import type { EvalResult, ScoreEntry, Usage, Verdict } from "../../../types.ts";
import type { AttemptHandle, Run } from "../../../record/index.ts";
import { attemptHandleOf, scopeOf } from "../scope.harness.ts";
import { conditionsByFlag, deltaTableData } from "./compute.ts";
import { validateDeltaData } from "./validate.ts";

let seq = 0;
function res(id: string, verdict: Verdict, extra: Partial<EvalResult> = {}): EvalResult {
  seq += 1;
  return {
    id,
    agent: "agent-x",
    verdict,
    attempt: 0,
    startedAt: `2026-07-01T00:00:00.${String(seq).padStart(6, "0")}Z`,
    durationMs: 1000,
    assertions: [],
    ...extra,
  };
}

function usage(inputTokens: number, costUSD: number): Usage {
  return { inputTokens, outputTokens: 0, costUSD };
}

function scoreEntry(label: string, points: number): ScoreEntry {
  return { label, points };
}

let runSeq = 0;
function snap(
  experimentId: string,
  results: EvalResult[],
  opts: { runStartedAt?: string; flags?: globalThis.Record<string, string>; model?: string } = {},
): Run {
  runSeq += 1;
  const startedAt = opts.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const run = {
    experimentId,
    startedAt,
    completedAt: startedAt,
    agent: "agent-x",
    model: opts.model,
    schemaVersion: 1,
    dir: `/results/${experimentId}/snap-${runSeq}`,
    ...(opts.flags ? { experiment: { attempts: 1, earlyExit: false, selectedEvalIds: [], flags: opts.flags } } : {}),
  } as Run;
  const attempts: AttemptHandle[] = results.map((r) =>
    attemptHandleOf(run, r, {
      run: `${experimentId}/snap-${runSeq}`,
      attempt: `${r.id}/a${r.attempt}`,
    }),
  );
  const evals = new Map<string, AttemptHandle[]>();
  for (const a of attempts) evals.set(a.evalId, [...(evals.get(a.evalId) ?? []), a]);
  run.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  run.attempts = attempts;
  return run;
}

describe("deltaTableData", () => {
  it("配对身份是 eval id:同一 eval id 在各条件下的结果进同一行,条件没有这道题时该条件缺键(渲染占位 —)", async () => {
    const base = snap("exp/base", [res("a", "passed"), res("b", "passed")]);
    const cond = snap("exp/cond", [res("a", "passed")]); // "b" 在 cond 侧没有结果
    const scope = scopeOf([base, cond]);
    const data = await deltaTableData(scope, { by: "experiment", conditions: ["exp/base", "exp/cond"] });

    expect(data.rows.map((r) => r.key)).toEqual(["a", "b"]);
    const rowB = data.rows.find((r) => r.key === "b")!;
    expect(rowB.cells["exp/base"]).toBeDefined();
    expect(rowB.cells["exp/cond"]).toBeUndefined();
  });

  it("翻转标记:各条件判定不一致时为真;一致(含只有一侧有结果)的行不加噪声", async () => {
    const base = snap("exp/base", [res("flip", "failed"), res("agree", "passed"), res("solo", "passed")]);
    const cond = snap("exp/cond", [res("flip", "passed"), res("agree", "passed")]);
    const scope = scopeOf([base, cond]);
    const data = await deltaTableData(scope, { by: "experiment", conditions: ["exp/base", "exp/cond"] });

    expect(data.rows.find((r) => r.key === "flip")!.flipped).toBe(true);
    expect(data.rows.find((r) => r.key === "agree")!.flipped).toBe(false);
    expect(data.rows.find((r) => r.key === "solo")!.flipped).toBe(false);
  });

  it("delta 是原始差值;任一侧缺数据时该条件不出现在 delta 里,不把缺失当 0", async () => {
    const base = snap("exp/base", [
      res("both", "passed", { usage: usage(1000, 1) }),
      res("baseOnly", "passed", { usage: usage(500, 0.5) }),
    ]);
    const cond = snap("exp/cond", [
      res("both", "passed", { usage: usage(700, 0.6) }),
      res("condOnly", "passed", { usage: usage(200, 0.2) }),
    ]);
    const scope = scopeOf([base, cond]);
    const data = await deltaTableData(scope, { by: "experiment", conditions: ["exp/base", "exp/cond"] });

    const both = data.rows.find((r) => r.key === "both")!;
    expect(both.delta?.["exp/cond"]).toMatchObject({ tokens: -300, costUSD: expect.closeTo(-0.4, 5) });
    // 任一侧缺数据的行:delta 整条不出现(不硬算成 0)
    expect(data.rows.find((r) => r.key === "baseOnly")!.delta).toBeUndefined();
    expect(data.rows.find((r) => r.key === "condOnly")!.delta).toBeUndefined();
  });

  it("runs>1 的格内折叠:verdict 按默认报告口径(任一轮通过则通过),tokens/成本按全部 attempt 合计不是均值", async () => {
    const base = snap("exp/base", [
      res("retry", "failed", { attempt: 0, usage: usage(300, 0.4) }),
      res("retry", "passed", { attempt: 1, usage: usage(344, 0.47) }),
    ]);
    const cond = snap("exp/cond", [res("retry", "passed", { usage: usage(200, 0.3) })]);
    const scope = scopeOf([base, cond]);
    const data = await deltaTableData(scope, { by: "experiment", conditions: ["exp/base", "exp/cond"] });

    const cell = data.rows.find((r) => r.key === "retry")!.cells["exp/base"]!;
    expect(cell.verdict).toBe("passed"); // 任一轮通过 → 该 eval 通过,不是平铺多数
    expect(cell.totalTokens).toBe(644); // 300 + 344 合计,不是均值
    expect(cell.totalCostUSD).toBeCloseTo(0.87, 5);
    expect(cell.attempts).toHaveLength(2);
  });

  it("totals 按条件自身覆盖面描述,pairedDelta 只在与基准的共同 eval 交集上归因——两个分母不能互相替代", async () => {
    // baseline 覆盖 {a, b};cond 覆盖 {b, c}——两侧覆盖故意不同,common 只有 {b}。
    const base = snap("exp/base", [
      res("a", "passed", { usage: usage(100, 0.1) }),
      res("b", "failed", { usage: usage(200, 0.2) }),
    ]);
    const cond = snap("exp/cond", [
      res("b", "passed", { usage: usage(150, 0.15) }),
      res("c", "passed", { usage: usage(300, 0.3) }),
    ]);
    const scope = scopeOf([base, cond]);
    const data = await deltaTableData(scope, { by: "experiment", conditions: ["exp/base", "exp/cond"] });

    // totals:各自覆盖面描述,分母互不相同(base=2, cond=2)
    expect(data.totals["exp/base"]).toMatchObject({ passed: 1, denominator: 2 });
    expect(data.totals["exp/cond"]).toMatchObject({ passed: 2, denominator: 2 });

    // pairedDelta:只在共同 eval {b} 上配对——如果错误算法直接拿各自 totals 相减
    // (1/2 → 2/2 = +50pt),会与正确算法(共同题 b:base failed→cond passed = +100pt)不同,
    // 这条断言能抓出这个错误。
    const pd = data.pairedDelta["exp/cond"]!;
    expect(pd.commonEvalIds).toEqual(["b"]);
    expect(pd.pass!.passRatePoints).toBeCloseTo(100, 5);
    expect(pd.tokens).toBe(-50);
    expect(pd.costUSD).toBeCloseTo(-0.05, 5);
  });

  it("混型:eval 集横跨通过制与计分制时 totals.scoringComposition 为 mixed,pass/points 子集分开报,不共用分母", async () => {
    const base = snap("exp/base", [
      res("passEval", "passed"),
      res("scoreEval", "passed", { scoring: "points", scoreEntries: [scoreEntry("quality", 3)] }),
    ]);
    const cond = snap("exp/cond", [
      res("passEval", "failed"),
      res("scoreEval", "passed", { scoring: "points", scoreEntries: [scoreEntry("quality", 7)] }),
    ]);
    const scope = scopeOf([base, cond]);
    const data = await deltaTableData(scope, { by: "experiment", conditions: ["exp/base", "exp/cond"] });

    expect(data.totals["exp/base"].scoringComposition).toBe("mixed");
    expect(data.totals["exp/base"]).toMatchObject({ passed: 1, denominator: 1, totalScore: 3 });
    expect(data.totals["exp/cond"]).toMatchObject({ passed: 0, denominator: 1, totalScore: 7 });

    const pd = data.pairedDelta["exp/cond"]!;
    expect(pd.pass!.knownEvalIds).toEqual(["passEval"]);
    expect(pd.points!.knownEvalIds).toEqual(["scoreEval"]);
    expect(pd.pass!.passRatePoints).toBeCloseTo(-100, 5);
    expect(pd.points!.totalScore).toBe(4);

    const row = data.rows.find((r) => r.key === "scoreEval")!;
    expect(row.cells["exp/base"].scoring).toBe("points");
    expect(row.delta?.["exp/cond"]).toMatchObject({ score: 4 });
  });

  it("historical:格来自跨快照携带的历史执行时 historical 为 true(真实来源早于该实验的水位基准)", async () => {
    const older = snap("exp/cond", [res("q", "passed", { usage: usage(100, 0.1) })], { runStartedAt: "2026-01-01T00:00:00.000Z" });
    const newer = snap("exp/cond", [res("q2", "passed")], { runStartedAt: "2026-02-01T00:00:00.000Z" });
    const base = snap("exp/base", [res("q", "passed", { usage: usage(90, 0.09) })]);
    // 裸 Run[] 输入:watermark 取该 experiment 在 runs 里 startedAt 最新者(newer)。
    const data = await deltaTableData([base, older, newer], { by: "experiment", conditions: ["exp/base", "exp/cond"] });

    expect(data.rows.find((r) => r.key === "q")!.cells["exp/cond"]!.historical).toBe(true);
  });

  it("空 rows 零输出;conditions 长度 < 2 或含重复值按完整用户反馈报错", async () => {
    const s = snap("exp/only", []);
    await expect(deltaTableData(scopeOf([s]), { by: "experiment", conditions: ["exp/only"] as unknown as [string, string] })).rejects.toThrow(
      /at least 2/,
    );
    await expect(
      deltaTableData(scopeOf([s]), { by: "experiment", conditions: ["exp/a", "exp/a"] }),
    ).rejects.toThrow(/twice/);
  });

  describe("conditionsByFlag", () => {
    /** 三 experiment(带 memory flag 的两个 + 未声明的一个)共享同一份可比性配置。 */
    const flagSnaps = () => [
      snap("mem/none", [res("q", "passed")]),
      snap("mem/on", [res("q", "passed")], { flags: { memory: "on" } }),
      snap("mem/alt", [res("q", "passed")], { flags: { memory: "alt" } }),
    ];

    it("基准缺省 = 未声明该 flag;候选按显示键字典序排在基准之后", async () => {
      const data = await deltaTableData(flagSnaps(), { by: "experiment", conditions: conditionsByFlag("memory") });
      expect(data.conditions).toEqual(["(missing)", "alt", "on"]);
      expect(data.experiments).toBe(3);
    });

    it("baseline 显式声明时基准取该 flag 值", async () => {
      const data = await deltaTableData(flagSnaps(), {
        by: "experiment",
        conditions: conditionsByFlag("memory", { baseline: "on" }),
      });
      expect(data.conditions[0]).toBe("on");
    });

    it("0 候选不是错误:单实验收窄后空 rows,experiments 报配对域实验数", async () => {
      const single = snap("solo/x", [res("q", "passed")]);
      const data = await deltaTableData([single], { by: "experiment", conditions: conditionsByFlag("memory") });
      expect(data.rows).toEqual([]);
      expect(data.experiments).toBe(1);
    });

    it("by 非 experiment 时按完整用户反馈报错", async () => {
      const single = snap("solo/x", [res("q", "passed")]);
      await expect(
        deltaTableData([single], { by: "agent", conditions: conditionsByFlag("memory") }),
      ).rejects.toThrow(/by: "experiment"/);
    });

    it("删除该 flag 后配置仍不可比(如 model 不同)时按完整用户反馈报错,提示收窄范围", async () => {
      const a = snap("mm/a", [res("q", "passed")], { model: "gpt-a" });
      const b = snap("mm/b", [res("q", "passed")], { flags: { memory: "on" }, model: "gpt-b" });
      await expect(
        deltaTableData([a, b], { by: "experiment", conditions: conditionsByFlag("memory") }),
      ).rejects.toThrow(/configuration differs/);
    });
  });

  it("复算 show/compare.md 示例数字:共同 7 题 · 通过率 +28.6pt · tokens -642.8k · 成本 -$0.78", async () => {
    const baseline = snap("memory/claude-baseline", [
      res("agent-037-updatetag-cache", "passed", { usage: usage(512_300, 0.71) }),
      res("repomod-hello-world-api", "passed", { usage: usage(688_900, 0.95) }),
      res("swelancer-manager-proposals", "failed", { usage: usage(621_000, 0.83) }),
      res("terminal-cancel-async-tasks", "passed", { usage: usage(455_700, 0.63) }),
      res("terminal-pypi-server", "failed", { usage: usage(890_100, 1.21) }),
      res("tool-call-observability", "passed", { usage: usage(102_600, 0.14) }),
      res("flaky-retry", "failed", { usage: usage(731_500, 0.99) }),
    ]);
    const mempal = snap("memory/claude-mempal", [
      res("agent-037-updatetag-cache", "passed", { usage: usage(305_100, 0.44) }),
      res("repomod-hello-world-api", "passed", { usage: usage(701_200, 0.98) }),
      res("swelancer-manager-proposals", "passed", { usage: usage(298_400, 0.41) }),
      res("terminal-cancel-async-tasks", "passed", { usage: usage(402_000, 0.55) }),
      res("terminal-pypi-server", "failed", { usage: usage(910_400, 1.30) }),
      res("tool-call-observability", "passed", { usage: usage(98_200, 0.13) }),
      res("flaky-retry", "passed", { usage: usage(644_000, 0.87) }),
      res("uv-lock-refresh", "passed", { usage: usage(511_800, 0.70) }),
    ]);
    const scope = scopeOf([baseline, mempal]);
    const data = await deltaTableData(scope, {
      by: "experiment",
      conditions: ["memory/claude-baseline", "memory/claude-mempal"],
    });

    const pd = data.pairedDelta["memory/claude-mempal"]!;
    expect(pd.commonEvalIds).toHaveLength(7);
    expect(pd.pass!.passRatePoints).toBeCloseTo(200 / 7, 5); // ≈ +28.6pt
    expect(pd.tokens).toBeCloseTo(-642_800, 1);
    expect(pd.costUSD).toBeCloseTo(-0.78, 5);

    // 汇总(各条件自身覆盖面):baseline 4/7 通过、mempal 7/8 通过(含 uv-lock-refresh)
    expect(data.totals["memory/claude-baseline"]).toMatchObject({ passed: 4, denominator: 7 });
    expect(data.totals["memory/claude-mempal"]).toMatchObject({ passed: 7, denominator: 8 });

    expect(validateDeltaData(data)).toBeNull();
  });
});
