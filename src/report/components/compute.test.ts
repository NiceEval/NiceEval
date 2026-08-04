// cases: docs/engineering/testing/unit/reports.md
// niceeval/report 计算层的单元测试:全部用内存 fake(Run / AttemptHandle 按
// niceeval/record 的读取契约手工构造)。覆盖登记行:两级聚合 vs 平铺、errored=0 口径、
// skipped=null、null≠0、Scoreboard 固定分母(notRun/unscorable 分开)、权重最长前缀、
// 身份键去重、现刻水位、自定义指标 where/aggregate、evalGroup 完整父路径、verdict 权威、
// MetricValue 诚实、durationMs 超时删失(线值不进均值、samples<total 覆盖率缺口)、缺 artifact 指标、repeatedFailedCommands、实体列表 failureSummary、
// sampleSummary 两级计票、experimentListData/sampleSummary 的 selectedEvalIds 投影、conditionsByFlag、
// MetricLine 点身份、空数组反馈、measureRowsData sort、series 配色的确定性索引计算(colorIndexForKey /
// colorIndicesForKeys,纯函数,不断言渲染出的颜色值)。Scatter 的 text 面(`scatterText`)本身是
// 终端排版渲染——图例分配、connect 位移摘要的字符串产物归 E2E 报告域(docs/engineering/testing/e2e/
// report.md §5 终端排版),不在本文件内。

import { describe, expect, it } from "vitest";

import type { AssertionResult, AttemptError, EvalResult, O11ySummary, Verdict } from "../../types.ts";
import { completeEvidenceCoverage } from "../../assertions/coverage.ts";
import type { AttemptHandle, Sample, SampleIssue, Run } from "../../record/index.ts";
import { attemptHandleOf, scopeOf } from "./scope.harness.ts";
import { makeSample } from "../../sample/index.ts";
import { encodeAttemptLocator } from "../../record/locator.ts";
import { COVERAGE_ROW_PREFIX, experimentListContent } from "./entity-lists/content.ts";
import { formatCellText, type Cell } from "../definition/cell.ts";
import type { Record } from "../../record/types.ts";
import {
  assistantTurns,
  costUSD,
  durationMs,
  passRate,
  examScore,
  executionReliability,
  repeatedFailedCommands,
  taskPassRate,
  totalScore,
} from "../model/metrics.ts";
import { flag, label, numericFlag, numericLabel } from "../model/flag.ts";
import { colorIndexForKey, colorIndicesForKeys } from "../assets/colors.ts";
import { attemptListData, evalListData, experimentListData } from "./entity-lists/compute.ts";
import { validateAttemptListData, validateEvalListData, validateExperimentListData } from "./entity-lists/validate.ts";
import {
  conditionsByFlag,
  deltaTableData,
  metricLineData,
  metricMatrixData,
  measureRowsData,
  scoreboardData,
  stabilityMatrixData,
} from "../slices/compute.ts";
import {
  validateDeltaData,
  validateLineData,
  validateMatrixData,
  validateScoreboardData,
  validateStabilityMatrixData,
} from "../slices/validate.ts";
import { sampleSummary } from "./summaries/compute.ts";
import { validateSampleSummaryContent } from "./summaries/validate.ts";
import { evalGroupOf } from "../model/aggregate.ts";
import { evaluationKindComposition } from "../model/evaluation-kind.ts";
import { isDataset, isMetricValue } from "../model/dataset.ts";
import type { AttemptMetric, DatasetRow, MetricValue } from "../model/types.ts";

function metricCell(row: DatasetRow, name: string): MetricValue {
  const value = row.values[name];
  if (!isMetricValue(value)) throw new Error(`expected metric cell ${JSON.stringify(name)} in row ${JSON.stringify(row.key)}`);
  return value;
}

// ───────────────────────── fake 数据(按 results 读取契约造)─────────────────────────

/** 结构化 `AttemptError` 的最小构造(测试用)。 */
function erroredWith(message: string): AttemptError {
  return { code: "unexpected-error", message, origin: { scope: "attempt" as const, phase: "eval.run" } };
}

let seq = 0;

/** 造一条结果;默认给每条唯一 startedAt —— 身份键含 startedAt,免得普通样本被去重误伤。 */
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
    evidenceCoverage: completeEvidenceCoverage,
    ...extra,
  };
}

function softAssertion(name: string, score: number, extra: Partial<AssertionResult> = {}): AssertionResult {
  return { name, severity: "soft", score, outcome: "passed" as const, ...extra } as AssertionResult;
}

/** 计分制断言:.points(n) 挂了才有的 points 字段(n × score,由调用方直接传最终挣分)。 */
function pointsAssertion(name: string, points: number, extra: Partial<AssertionResult> = {}): AssertionResult {
  return { name, severity: "gate", score: 1, outcome: "passed" as const, points, ...extra } as AssertionResult;
}

/** 最小合规 O11ySummary;shellCommands / totalTurns 按需变。 */
function o11ySummary(partial: Partial<O11ySummary> = {}): O11ySummary {
  return {
    totalTurns: 0,
    toolCalls: {},
    totalToolCalls: 0,
    filesRead: [],
    filesModified: [],
    shellCommands: [],
    webFetches: [],
    errors: [],
    thinkingBlocks: 0,
    compactions: 0,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    ...partial,
  } as O11ySummary;
}

interface SnapSpec {
  experimentId: string;
  results: EvalResult[];
  agent?: string;
  model?: string;
  runStartedAt?: string;
  knownEvalIds?: string[];
  experiment?: Omit<NonNullable<Run["experiment"]>, "sandboxLayer" | "sandboxPlansByEval" | "agentInstalls"> &
    Partial<Pick<NonNullable<Run["experiment"]>, "sandboxLayer" | "sandboxPlansByEval" | "agentInstalls">>;
}

function experimentInfo(
  info: NonNullable<SnapSpec["experiment"]>,
): NonNullable<Run["experiment"]> {
  return {
    sandboxLayer: {},
    sandboxPlansByEval: {},
    agentInstalls: [],
    ...info,
  };
}

let runSeq = 0;

/** 最小构造:一个快照目录装一个快照。runStartedAt 决定去重时谁是「最新快照」。 */
function snap(spec: SnapSpec): Run {
  runSeq += 1;
  const startedAt = spec.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const dir = `/results/exp/snap-${runSeq}`;
  const run = {
    runId: `run-${runSeq}`,
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: spec.agent ?? "agent-x",
    model: spec.model,
    experiment: spec.experiment === undefined ? undefined : experimentInfo(spec.experiment),
    schemaVersion: 1,
    dir,
    knownEvalIds: spec.knownEvalIds,
  } as Run;
  const attempts: AttemptHandle[] = spec.results.map((r) =>
    attemptHandleOf(
      run,
      r,
      { run: `exp/snap-${runSeq}`, attempt: `${r.id}/a${r.attempt}` },
      { o11y: async () => r.o11y ?? null },
    ),
  );
  const evals = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) {
    const list = evals.get(attempt.evalId);
    if (list) list.push(attempt);
    else evals.set(attempt.evalId, [attempt]);
  }
  run.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  run.attempts = attempts;
  return run;
}

// ───────────────────────── 指标聚合口径 ─────────────────────────

describe("两级聚合口径", () => {
  // 区分力 fixture:题级值 [1, 2/3, 0] → 两级 5/9;attempt 平铺 3/5;
  // 条件任务通过率 5/6(errored 不进分母);「任一轮通过」2/3。四种口径互不相等。
  const discriminating = snap({
    experimentId: "exp/a",
    results: [
      res("e1", "passed"),
      res("e2", "passed", { attempt: 0 }),
      res("e2", "passed", { attempt: 1 }),
      res("e2", "failed", { attempt: 2 }),
      res("e3", "errored", { error: erroredWith("boom") }),
    ],
  });

  it("passRate 先题内折叠再跨题折叠:5/9,不是平铺 3/5、条件 5/6 或任一轮 2/3", async () => {
    const data = await sampleSummary([discriminating]);
    expect(data.endToEndPassRate.value).toBeCloseTo(5 / 9);
    expect(data.endToEndPassRate.value).not.toBeCloseTo(3 / 5);
    expect(data.endToEndPassRate.value).not.toBeCloseTo(5 / 6);
    expect(data.endToEndPassRate.value).not.toBeCloseTo(2 / 3);
    expect(data.endToEndPassRate.unit).toBe("%");
    expect(data.endToEndPassRate.value).toBeCloseTo(5 / 9);
    expect(data.endToEndPassRate.samples).toBe(5);
    expect(data.endToEndPassRate.total).toBe(5);
  });

  it("taskPassRate 排除 errored,只能作为带限定名称的诊断指标:同 fixture 得 5/6", async () => {
    const table = await measureRowsData([discriminating], {
      dimensions: ["agent"],
      measures: [passRate, taskPassRate, executionReliability],
    });
    const row = table.rows[0]!;
    expect(metricCell(row, taskPassRate.name).value).toBeCloseTo(5 / 6);
    expect(metricCell(row, passRate.name).value).toBeCloseTo(5 / 9);
    // executionReliability:e1=1、e2=1、e3=0 → 2/3
    expect(metricCell(row, executionReliability.name).value).toBeCloseTo(2 / 3);
  });

  it("2 passed + 5 errored 的默认通过率是 2/7,不是 100%", async () => {
    const s = snap({
      experimentId: "exp/err",
      results: [
        res("q1", "passed"),
        res("q2", "passed"),
        ...[3, 4, 5, 6, 7].map((n) => res(`q${n}`, "errored", { error: erroredWith("x") })),
      ],
    });
    const data = await sampleSummary([s]);
    expect(data.endToEndPassRate.value).toBeCloseTo(2 / 7);
  });

  it("skipped 对内置指标返回 null:不进有效样本但保留在 total,value 不受影响", async () => {
    const s = snap({
      experimentId: "exp/skip",
      results: [res("a", "passed"), res("b", "skipped"), res("c", "failed")],
    });
    const data = await sampleSummary([s]);
    expect(data.endToEndPassRate.value).toBeCloseTo(0.5); // (1+0)/2,skipped 不稀释
    expect(data.endToEndPassRate.samples).toBe(2);
    expect(data.endToEndPassRate.total).toBe(3);
  });

  it("null 表示测不了不参与聚合,0 正常参与:[null, 0, 1] 的 mean 是 0.5 而非 1/3", async () => {
    const values = new Map([
      ["a", null],
      ["b", 0],
      ["c", 1],
    ]);
    const metric: AttemptMetric = {
      name: "tri",
      value: (attempt) => values.get(attempt.evalId) ?? null,
    };
    const s = snap({ experimentId: "exp/tri", results: [res("a", "passed"), res("b", "passed"), res("c", "passed")] });
    const table = await measureRowsData([s], { dimensions: ["agent"], measures: [metric] });
    expect(metricCell(table.rows[0]!, "tri").value).toBeCloseTo(0.5);
  });

  it("跨快照计算先按身份键去重:局部补跑重叠快照下 samples 不虚增", async () => {
    const carried = res("dup/a", "passed", { startedAt: "2026-07-01T09:00:00.000Z" });
    const s1 = snap({ experimentId: "exp/dup", results: [carried], runStartedAt: "2026-07-01T09:00:00.000Z" });
    // 携带合入:同一条结果(同身份键)原样出现在更新的快照里
    const s2 = snap({ experimentId: "exp/dup", results: [{ ...carried }], runStartedAt: "2026-07-02T09:00:00.000Z" });
    const data = await sampleSummary([s1, s2]);
    expect(data.attempts).toBe(1);
    expect(data.endToEndPassRate.samples).toBe(1);
  });

  it("自定义指标:where 是进入计算前的过滤;perEval + acrossEvals 两级分别生效", async () => {
    const s = snap({
      experimentId: "exp/custom",
      results: [
        res("a", "passed", { durationMs: 100, attempt: 0 }),
        res("a", "passed", { durationMs: 300, attempt: 1 }),
        res("b", "failed", { durationMs: 900 }),
        res("c", "passed", { durationMs: 500 }),
      ],
    });
    const fastest: AttemptMetric = {
      name: "fastest-pass",
      where: (attempt) => attempt.result.verdict === "passed",
      value: (attempt) => attempt.result.durationMs,
      perEval: "min",
      acrossEvals: "mean",
    };
    const table = await measureRowsData([s], { dimensions: ["agent"], measures: [fastest] });
    const cell = metricCell(table.rows[0]!, "fastest-pass");
    // b 被 where 排除;a 题内 min = 100,c = 500 → mean 300(双 mean 会是 (200+500)/2=350,可区分)
    expect(cell.value).toBe(300);
    expect(cell.samples).toBe(3);
    expect(cell.total).toBe(4);

    const allExcluded: AttemptMetric = {
      name: "none",
      where: () => false,
      value: () => 1,
    };
    const empty = await measureRowsData([s], { dimensions: ["agent"], measures: [allExcluded] });
    expect(metricCell(empty.rows[0]!, "none").value).toBeNull();
  });

  it("evalGroup 按完整父路径分组(无 / 取完整 id),与可比组同一条派生规则", async () => {
    expect(evalGroupOf("a/b/c")).toBe("a/b");
    expect(evalGroupOf("security/sql-injection")).toBe("security");
    expect(evalGroupOf("standalone")).toBe("standalone");
    const s = snap({
      experimentId: "exp/g",
      results: [res("a/b/c", "passed"), res("a/b/d", "failed"), res("solo", "passed")],
    });
    const matrix = await metricMatrixData([s], { rows: "evalGroup", columns: "agent", cell: passRate });
    const rowKeys = [...new Set(matrix.cells.map((c) => c.row))];
    expect(rowKeys.sort()).toEqual(["a/b", "solo"]);
  });

  it("报告消费落盘 verdict,不重新判卷:断言与 verdict 矛盾时以 verdict 为准", async () => {
    const s = snap({
      experimentId: "exp/v",
      results: [
        res("a", "failed", {
          // 断言看起来全过,但 verdict 是 failed(如 --strict 翻案):按 verdict 记 0
          assertions: [softAssertion("s", 1)],
        }),
      ],
    });
    const data = await sampleSummary([s]);
    expect(data.endToEndPassRate.value).toBe(0);
  });
});

// ───────────────────────── MetricValue 与缺数据行为 ─────────────────────────

describe("MetricValue 诚实契约", () => {
  it("measuredZero / partial / missing 三种格子互不混淆;refs 序列化后不丢", async () => {
    const zero = snap({ experimentId: "exp/zero", results: [res("a", "failed")] });
    const partial = snap({ experimentId: "exp/partial", results: [res("a", "passed"), res("b", "skipped")] });
    const missing = snap({ experimentId: "exp/missing", results: [res("a", "skipped")] });
    const table = await measureRowsData([zero, partial, missing], {
      dimensions: ["experiment"],
      measures: [passRate],
    });
    const cellOf = (key: string) => metricCell(table.rows.find((r) => r.key === key)!, passRate.name);
    expect(cellOf("exp/zero")).toMatchObject({ value: 0, samples: 1, total: 1 });
    expect(cellOf("exp/partial")).toMatchObject({ value: 1, samples: 1, total: 2 });
    expect(cellOf("exp/missing")).toMatchObject({ value: null, samples: 0, total: 1 });
    // 覆盖率与 refs 不因 JSON 序列化丢失;refs 跟随覆盖范围(含 null 值的 attempt)
    const roundTrip = JSON.parse(JSON.stringify(table)) as typeof table;
    expect(metricCell(roundTrip.rows.find((r) => r.key === "exp/partial")!, passRate.name).refs).toHaveLength(2);
    expect(cellOf("exp/missing").refs).toHaveLength(1);
  });

  it("缺 o11y.json 时 assistantTurns / repeatedFailedCommands 为 missing;result.json 指标不受影响", async () => {
    const s = snap({ experimentId: "exp/noo11y", results: [res("a", "passed", { durationMs: 1234 })] });
    const table = await measureRowsData([s], {
      dimensions: ["agent"],
      measures: [assistantTurns, repeatedFailedCommands, durationMs],
    });
    const row = table.rows[0]!;
    expect(metricCell(row, assistantTurns.name).value).toBeNull();
    expect(metricCell(row, repeatedFailedCommands.name).value).toBeNull();
    expect(metricCell(row, durationMs.name).value).toBe(1234);
  });

  it("durationMs 对 timeout attempt 删失:线值不进均值,cell.samples < cell.total 如实呈现覆盖率缺口", async () => {
    const s = snap({
      experimentId: "exp/censor",
      results: [
        res("a", "passed", { durationMs: 100 }),
        res("b", "passed", { durationMs: 300 }),
        // 撞 1200000ms(20m)硬线被砍断:durationMs 是右删失点,不是「跑了这么久」
        res("c", "errored", { durationMs: 1200000, error: { code: "timeout", message: "timed out", origin: { scope: "attempt" as const, phase: "eval.run" } } }),
      ],
    });
    const table = await measureRowsData([s], { dimensions: ["experiment"], measures: [durationMs] });
    const cell = metricCell(table.rows[0]!, durationMs.name);
    // 均值只在 a/b 上算:(100+300)/2 = 200;若线值 1200000 混进来均值会失真到 400100
    expect(cell.value).toBe(200);
    expect(cell.samples).toBe(2);
    expect(cell.total).toBe(3);
    // 覆盖范围仍含被删失的 attempt(可下钻到「为什么测不了」),不是从格子里静默消失
    expect(cell.refs).toHaveLength(3);
  });

  it("durationMs 只删失 timeout:其它 error.code 的 errored attempt 仍实测计入", async () => {
    const s = snap({
      experimentId: "exp/other-error",
      results: [res("a", "errored", { durationMs: 500, error: erroredWith("boom") })],
    });
    const table = await measureRowsData([s], { dimensions: ["experiment"], measures: [durationMs] });
    const cell = metricCell(table.rows[0]!, durationMs.name);
    expect(cell.value).toBe(500);
    expect(cell.samples).toBe(1);
    expect(cell.total).toBe(1);
  });

  it("repeatedFailedCommands:同命令失败 3 次记 2;两条不同命令各失败 1 次记 0", async () => {
    const repeat = snap({
      experimentId: "exp/repeat",
      results: [
        res("a", "failed", {
          o11y: o11ySummary({
            shellCommands: [
              { command: "pnpm test", success: false },
              { command: "pnpm test", success: false },
              { command: "pnpm test", success: false },
              { command: "ls", success: true },
            ],
          }),
        }),
      ],
    });
    const distinct = snap({
      experimentId: "exp/distinct",
      results: [
        res("a", "failed", {
          o11y: o11ySummary({
            shellCommands: [
              { command: "pnpm test", success: false },
              { command: "pnpm build", success: false },
            ],
          }),
        }),
      ],
    });
    const table = await measureRowsData([repeat, distinct], {
      dimensions: ["experiment"],
      measures: [repeatedFailedCommands],
    });
    const cellOf = (key: string) => metricCell(table.rows.find((r) => r.key === key)!, repeatedFailedCommands.name);
    expect(cellOf("exp/repeat").value).toBe(2);
    expect(cellOf("exp/distinct").value).toBe(0);
  });

  it("value 与 display 分别可断言;display 由 unit 或自定义 display(value, locale) 驱动", async () => {
    const s = snap({
      experimentId: "exp/display",
      results: [
        ...[1, 1, 1, 1, 1].map((_, i) => res(`q${i}`, "passed")),
        res("q5", "failed"),
      ],
    });
    const data = await sampleSummary([s]);
    expect(data.endToEndPassRate.value).toBeCloseTo(5 / 6);
    expect(data.endToEndPassRate.unit).toBe("%");

    const localized: AttemptMetric = {
      name: "loc",
      value: () => 1,
      display: (value, locale) => (locale === "zh-CN" ? `${value} 个` : `${value} item`),
    };
    const table = await measureRowsData([s], { dimensions: ["agent"], measures: [localized] });
    const loc = metricCell(table.rows[0]!, "loc");
    expect(loc.format && typeof loc.format === "object" && loc.format.kind === "custom").toBe(true);
    if (loc.format && typeof loc.format === "object" && loc.format.kind === "custom") {
      expect(loc.format.format(1, "en")).toBe("1 item");
      expect(loc.format.format(1, "zh-CN")).toBe("1 个");
    }
  });

  it("value() 抛错时整个计算失败,错误带 metric name 与 attempt locator,不伪装成测不了", async () => {
    const bad: AttemptMetric = {
      name: "explode",
      value: () => {
        throw new Error("boom");
      },
    };
    const s = snap({ experimentId: "exp/bad", results: [res("a", "passed")] });
    await expect(measureRowsData([s], { dimensions: ["agent"], measures: [bad] })).rejects.toThrow(/explode.*boom/s);
  });
});

// ───────────────────────── Scoreboard ─────────────────────────

describe("scoreboardData", () => {
  it("固定题集分母:未跑题按 0 分计入 notRun;跑了但 null 的题计入 unscorable,两个计数不合并", async () => {
    const nullScore: AttemptMetric = {
      name: "maybe-score",
      value: (attempt) => (attempt.evalId === "s/unscorable" ? null : attempt.result.verdict === "passed" ? 1 : 0),
    };
    const s = snap({
      experimentId: "exp/board",
      results: [res("s/ran", "passed"), res("s/unscorable", "passed")],
    });
    const data = await scoreboardData([s], {
      rows: "agent",
      questions: ["s/ran", "s/unscorable", "s/never-1", "s/never-2"],
      score: nullScore,
    });
    const row = data.rows[0]!;
    // 分母恒 4:1 分挣到 1(s/ran),其余 0 → 100 × 1/4 = 25
    expect(row.total.value).toBe(25);
    expect(row.total.notRun).toBe(2);
    expect(row.total.unscorable).toBe(1);
    expect(row.subjects[0]!.questions).toBe(4);
  });

  it("权重按最长前缀命中;无命中默认 1;总分 fullMarks × earned / possible", async () => {
    const s = snap({
      experimentId: "exp/w",
      results: [res("security/auth/a", "passed"), res("security/b", "failed"), res("misc", "passed")],
    });
    const data = await scoreboardData([s], {
      rows: "agent",
      questions: ["security/auth/a", "security/b", "misc"],
      weights: { "security/": 2, "security/auth/": 4 },
      fullMarks: 100,
    });
    const row = data.rows[0]!;
    // earned = 4(auth/a) + 0 + 1(misc) = 5;possible = 4 + 2 + 1 = 7
    expect(row.total.value).toBeCloseTo((100 * 5) / 7);
    expect(data.weights[0]).toEqual({ prefix: "security/auth/", weight: 4 }); // 最长前缀在前
  });

  it("subject 缺省与 evalGroup 同一条规则(完整父路径);题集外的 eval 忽略并计入 ignoredEvals", async () => {
    const s = snap({
      experimentId: "exp/subject",
      results: [res("a/b/c", "passed"), res("outside", "passed")],
    });
    const data = await scoreboardData([s], { rows: "agent", questions: ["a/b/c"] });
    expect(data.rows[0]!.subjects[0]!.key).toBe("a/b");
    expect(data.ignoredEvals).toBe(1);
  });

  it("questions 空数组 / 重复、非法权重、fullMarks<=0、score 出界、subject 空串都按完整用户反馈失败", async () => {
    const s = snap({ experimentId: "exp/e", results: [res("a", "passed")] });
    await expect(scoreboardData([s], { rows: "agent", questions: [] })).rejects.toThrow(/non-empty/);
    await expect(scoreboardData([s], { rows: "agent", questions: ["a", "a"] })).rejects.toThrow(/twice/);
    await expect(
      scoreboardData([s], { rows: "agent", questions: ["a"], weights: { a: 0 } }),
    ).rejects.toThrow(/positive finite/);
    await expect(scoreboardData([s], { rows: "agent", questions: ["a"], fullMarks: 0 })).rejects.toThrow(/fullMarks/);
    await expect(
      scoreboardData([s], { rows: "agent", questions: ["a"], score: { name: "big", value: () => 2 } }),
    ).rejects.toThrow(/\[0, 1\]/);
    await expect(
      scoreboardData([s], { rows: "agent", questions: ["a"], subject: () => "" }),
    ).rejects.toThrow(/empty/);
  });
});

// ───────────────────────── 实体列表 ─────────────────────────

describe("实体列表 data", () => {
  const failed = res("list/failed", "failed", {
    assertions: [
      {
        name: "equals",
        severity: "gate",
        outcome: "failed" as const,
        score: 0,
        detail: "equals(42)",
        expected: "42",
        received: "41",
      },
      { name: "second", severity: "gate", outcome: "failed" as const, score: 0, detail: "second-check" },
    ] as AssertionResult[],
    usage: { inputTokens: 10, outputTokens: 5, costUSD: 0.1 },
  });
  const errored = res("list/errored", "errored", {
    error: {
      code: "sandbox-create-failed",
      message: "docker daemon unreachable",
      origin: { scope: "attempt" as const, phase: "sandbox.create" },
      stack: "Error: docker daemon unreachable\n    at boot (sandbox.ts:10:3)",
    },
  });
  const passed = res("list/passed", "passed");
  const skipped = res("list/skipped", "skipped");
  const listSnap = () => snap({ experimentId: "exp/list", results: [failed, errored, passed, skipped] });

  it("failureSummary 三态:failed 取主失败断言摘要、errored 取 error 一层摘要(phase · code · message)、passed/skipped 为 null", async () => {
    const items = await attemptListData([listSnap()]);
    const byEval = new Map(items.map((item) => [item.evalId, item]));
    expect(byEval.get("list/failed")!.failureSummary).toContain("equals(42)");
    expect(byEval.get("list/failed")!.failureSummary).toContain("received 41");
    expect(byEval.get("list/failed")!.moreFailures).toBe(1);
    expect(byEval.get("list/errored")!.failureSummary).toBe(
      "sandbox.create · sandbox-create-failed · docker daemon unreachable",
    );
    expect(byEval.get("list/passed")!.failureSummary).toBeNull();
    expect(byEval.get("list/skipped")!.failureSummary).toBeNull();
  });

  it("failureSummary 计分制口径(规则 6):passed 全部得分点挣满为 null,存在丢分得分点时取记录顺序第一条(含挣分尾缀),其余计入 moreFailures;中止 attempt 仍由既有规则 1 选中前置,不受规则 6 影响", async () => {
    // 挣满:唯一得分点满分(pointsAssertion 默认 outcome passed、score 1),不是「没有得分点」的
    // null,是「挣满」的 null——两种 null 的根因不同,fixture 用真实挣满而非省略得分点来区分。
    const earnedInFull = res("exam/earned", "passed", {
      evaluationKind: "points",
      assertions: [pointsAssertion("installed", 1), pointsAssertion("configured", 1)],
    });
    // 丢分:两个得分点失败(严重度必须是 soft——points Eval 下失败的 gate 会中止,不可能与 passed
    // 并存),取记录顺序第一条(healthy)为主摘要,second-loss 计入 moreFailures。
    const lostPoints = res("exam/lost", "passed", {
      evaluationKind: "points",
      assertions: [
        pointsAssertion("installed", 1), // 挣满,不是候选
        pointsAssertion("healthy", 16, { severity: "soft", outcome: "failed", score: 0.8 }),
        pointsAssertion("second-loss", 0, { severity: "soft", outcome: "failed", score: 0 }),
      ],
    });
    // 中止:记录顺序最后一条、唯一 failed 的 gate——既有规则 1 自然选中,计分制不改选择逻辑
    // (docs/feature/assertions/library/display.md「主失败断言怎样选」规则 5)。
    const aborted = res("exam/aborted", "failed", {
      evaluationKind: "points",
      assertions: [
        pointsAssertion("cloned repo", 1),
        { name: "installed deps", severity: "gate", outcome: "failed" as const, score: 0 },
      ] as AssertionResult[],
    });
    const s = snap({ experimentId: "exam/rule6", results: [earnedInFull, lostPoints, aborted] });
    const items = await attemptListData([s]);
    const byEval = new Map(items.map((item) => [item.evalId, item]));

    expect(byEval.get("exam/earned")!.failureSummary).toBeNull();
    expect(byEval.get("exam/earned")!.moreFailures).toBe(0);

    const lostSummary = byEval.get("exam/lost")!;
    expect(lostSummary.failureSummary).toContain("healthy");
    expect(lostSummary.failureSummary).not.toContain("second-loss"); // 只有首条丢分进正文
    expect(lostSummary.failureSummary).toMatch(/\+16 pts/); // 首条丢分得分点的挣分尾缀
    expect(lostSummary.moreFailures).toBe(1); // second-loss 单独计数,不进 failureSummary 正文

    expect(byEval.get("exam/aborted")!.failureSummary).toContain("installed deps");
    expect(byEval.get("exam/aborted")!.moreFailures).toBe(0);
  });

  it("序列化 JSON 不含第二条断言文本、stack、evidence 或 diagnostics;costUSD 缺失一律 null", async () => {
    const items = await attemptListData([listSnap()]);
    const json = JSON.stringify(items);
    expect(json).not.toContain("second-check");
    expect(json).not.toContain("sandbox.ts:10:3");
    expect(json).not.toContain('"assertions"');
    expect(json).not.toContain('"diagnostics"');
    const byEval = new Map(items.map((item) => [item.evalId, item]));
    expect(byEval.get("list/failed")!.costUSD).toBe(0.1);
    expect(byEval.get("list/errored")!.costUSD).toBeNull();
  });

  it("experimentListData:evalVerdicts / passRate / costUSD / durationMs / tokens 齐全,默认按端到端通过率降序", async () => {
    const winner = snap({ experimentId: "exp/win", results: [res("a", "passed"), res("b", "passed")] });
    const loser = snap({ experimentId: "exp/lose", results: [res("a", "failed"), res("b", "passed")] });
    const items = await experimentListData([loser, winner]);
    expect(items.map((item) => item.experimentId)).toEqual(["exp/win", "exp/lose"]);
    expect(items[0]!.evalVerdicts).toEqual({ passed: 2, failed: 0, errored: 0, skipped: 0 });
    expect(items[0]!.endToEndPassRate.value).toBe(1);
    expect(items[1]!.evals).toBe(2);
  });

  it("同一 experiment 的输入含不一致可比性配置时按完整用户反馈失败,指引 run 维度 / MetricLine", async () => {
    const a = snap({ experimentId: "exp/mixed", model: "gpt-a", results: [res("x", "passed")] });
    const b = snap({ experimentId: "exp/mixed", model: "gpt-b", results: [res("y", "passed")] });
    await expect(experimentListData([a, b])).rejects.toThrow(/run.*MetricLine|MetricLine/s);
    // current() 口径的 Sample(一实验一配置)照常计算
    const clean = scopeOf([a]);
    await expect(experimentListData(clean)).resolves.toHaveLength(1);
  });

  it("时效字段:attemptListData.historical 是 carried 的投影;experimentListData.historicalAttempts 计入携带的 attempt", async () => {
    const carriedB = res("b", "passed", { artifactBase: "exp/hist/old-snap/b/a0" });
    const s = snap({ experimentId: "exp/hist", results: [res("a", "passed"), carriedB] });
    const attempts = await attemptListData([s]);
    expect(attempts.find((item) => item.evalId === "a")!.historical).toBe(false);
    expect(attempts.find((item) => item.evalId === "b")!.historical).toBe(true); // 携带条目

    const items = await experimentListData([s]);
    expect(items[0]!.historicalAttempts).toBe(1);
    expect(items[0]!.attempts).toBe(2); // historicalAttempts 是子集,不改变 attempts 总数口径
  });

  it("current() 下跨快照拼入的历史执行(非携带)以水位基准比较标 historical;run 维度按真实来源分组、显示真实 startedAt", async () => {
    // 两个真实贡献 Run:周一(旧,贡献 q2)与周二(新,贡献 q1)——不用 artifactBase/carried,
    // 单纯是「所属快照早于该 experiment 的水位基准」这条 historicalOf 的第二个分支。
    const monday = snap({ experimentId: "exp/multi", results: [res("q2", "passed")], runStartedAt: "2026-07-01T08:00:00.000Z" });
    const tuesday = snap({ experimentId: "exp/multi", results: [res("q1", "passed")], runStartedAt: "2026-07-02T08:00:00.000Z" });
    const scope = scopeOf([monday, tuesday]);

    const attempts = await attemptListData(scope);
    expect(attempts.find((item) => item.evalId === "q2")!.historical).toBe(true); // 来自旧快照,非携带
    expect(attempts.find((item) => item.evalId === "q1")!.historical).toBe(false); // 来自水位基准本身

    const items = await experimentListData(scope);
    expect(items[0]!.historicalAttempts).toBe(1);
    expect(items[0]!.attempts).toBe(2);

    // run 维度按真实来源分组:两条 attempt 各自的真实 startedAt 不同,不被合并成一个键。
    const table = await measureRowsData(scope, { dimensions: ["run"], measures: [passRate] });
    expect(table.rows.map((r) => r.key).sort()).toEqual([
      "exp/multi @ 2026-07-01T08:00:00.000Z",
      "exp/multi @ 2026-07-02T08:00:00.000Z",
    ]);
  });

  it("占位行数据:missingEvalIds 来自 scope.coverage,不参与 evals/attempts 计数或任何指标聚合", async () => {
    const s = snap({ experimentId: "exp/gap", results: [res("a", "passed"), res("b", "failed")] });
    const scope = scopeOf([s], [], [{ experimentId: "exp/gap", run: s, knownEvalIds: ["a", "b", "c"], missingEvalIds: ["c"] }]);
    const items = await experimentListData(scope);
    expect(items[0]!.missingEvalIds).toEqual(["c"]);
    // 占位行(c)不冒充有 attempt 的题:evals/attempts 分母仍是 2 道有 attempt 的题,不是 3。
    expect(items[0]!.evals).toBe(2);
    expect(items[0]!.attempts).toBe(2);
    expect(items[0]!.evalRows.map((row) => row.evalId)).toEqual(["a", "b"]); // 占位行不在 evalRows 里(占位行只在渲染面合成)
  });

  it("coverage-only 实验也产生覆盖占位行；--fresh 清空全部 attempt 时缺口不再静默消失", async () => {
    const anchor = snap({ experimentId: "exp/fresh", results: [] });
    const scope = scopeOf([], [], [{ experimentId: "exp/fresh", run: anchor, knownEvalIds: ["a", "b"], missingEvalIds: ["a", "b"] }]);
    const items = await experimentListData(scope);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      experimentId: "exp/fresh",
      agent: "agent-x",
      missingEvalIds: ["a", "b"],
      evals: 0,
      attempts: 0,
      evalRows: [],
    });
  });

  // ─────── 覆盖缺口的两档占位与过期结论参考(experiment-table.md「覆盖缺口的两档占位行」) ───────

  describe("覆盖缺口的两档占位与过期结论参考", () => {
    /**
     * 区分力场景:evalId "b" 只在两份旧 configHash 快照下跑过(与当前基准不可比,过期结论候选
     * 多于一条),"c" 从未在任何快照出现过(未跑到)。`current` 是当前基准,只贡献 "a"。
     */
    function staleScope(opts: { fresh?: boolean } = {}): { scope: Sample; older: Run; newerStale: Run } {
      const current = snap({ experimentId: "exp/stale", results: [res("a", "passed")] });
      current.configHash = "cfg-2";
      const older = snap({
        experimentId: "exp/stale",
        results: [res("b", "failed")],
        runStartedAt: "2026-01-01T00:00:00.000Z",
      });
      older.configHash = "cfg-1";
      const newerStale = snap({
        experimentId: "exp/stale",
        results: [res("b", "passed")],
        runStartedAt: "2026-02-01T00:00:00.000Z",
      });
      newerStale.configHash = "cfg-1"; // 同样不可比,但比 older 晚出现——参考要取这一条
      const coverage = [
        { experimentId: "exp/stale", run: current, knownEvalIds: ["a", "b", "c"], missingEvalIds: ["b", "c"] },
      ];
      const scope = makeSample(
        "current",
        [current],
        [...current.attempts],
        [],
        coverage,
        opts.fresh ?? false,
        [...current.attempts, ...older.attempts, ...newerStale.attempts],
      );
      return { scope, older, newerStale };
    }

    function recordCellOf(row: { cells: Readonly<globalThis.Record<string, Cell>> }): Cell {
      return row.cells.record!;
    }

    it("两档占位行的结果格都是 missing 且都带补跑命令;只有过期结论的那档带 reference,取候选中最新的一条", async () => {
      const { scope, newerStale } = staleScope();
      const items = await experimentListData(scope);
      const content = experimentListContent(items);
      const sub = content.rows[0]!.subRows!;
      const staleRow = sub.find((row) => row.key.endsWith("b:missing"))!;
      const notRunRow = sub.find((row) => row.key.endsWith("c:missing"))!;
      expect(staleRow.variant).toBe("placeholder");
      expect(notRunRow.variant).toBe("placeholder");

      const staleCell = recordCellOf(staleRow);
      const notRunCell = recordCellOf(notRunRow);
      if (staleCell.kind !== "missing" || notRunCell.kind !== "missing") throw new Error("expected missing cells");
      expect(staleCell.code).toBe("noCurrentResult");
      expect(notRunCell.code).toBe("noCurrentResult");
      expect(staleCell.detail).toBe("niceeval exp exp/stale");
      expect(notRunCell.detail).toBe("niceeval exp exp/stale");
      expect(notRunCell.reference).toBeUndefined();
      expect(staleCell.reference).toBeDefined();
      // 两档必须给出不同的格——把两档折成同一种占位的实现在这里失败。
      expect(staleCell).not.toEqual(notRunCell);
      // 候选多于一条(older 与 newerStale 都不可比)时取最新那条:newerStale 的判定是 "passed"。
      expect(staleCell.reference!.verdict).toBe("passed");
      expect(staleCell.reference!.locator).toBe(
        encodeAttemptLocator({ runId: newerStale.runId, evalId: "b", attempt: 0 }),
      );

      // text 面:带参考时用参考替代原因文案,不把「当前配置下无结果」再说一遍。
      expect(formatCellText(staleCell, "en")).toMatch(/^✓ /);
      expect(formatCellText(notRunCell, "en")).toBe("no result for current config · niceeval exp exp/stale");
      expect(formatCellText(notRunCell, "zh-CN")).toBe("当前配置下无结果 · niceeval exp exp/stale");
    });

    it("reference 不进任何计数:带参考前后,该 experiment 的判定计票、通过率与覆盖分母逐字不变", async () => {
      const { scope } = staleScope();
      const [item] = await experimentListData(scope);
      // 分母只数 "a" 这一道有 attempt 的题,"b" 的参考不进 evals/attempts/passRate 分母。
      expect(item!.evals).toBe(1);
      expect(item!.attempts).toBe(1);
      expect(item!.endToEndPassRate).toMatchObject({ value: 1, samples: 1, total: 1 });
      expect(item!.evalVerdicts).toEqual({ passed: 1, failed: 0, errored: 0, skipped: 0 });
    });

    it("sample.fresh 为 true 时两档占位行都不带 reference", async () => {
      const nonFresh = experimentListContent(await experimentListData(staleScope({ fresh: false }).scope));
      const fresh = experimentListContent(await experimentListData(staleScope({ fresh: true }).scope));
      const staleCellNonFresh = recordCellOf(nonFresh.rows[0]!.subRows!.find((row) => row.key.endsWith("b:missing"))!);
      const staleCellFresh = recordCellOf(fresh.rows[0]!.subRows!.find((row) => row.key.endsWith("b:missing"))!);
      if (staleCellNonFresh.kind !== "missing" || staleCellFresh.kind !== "missing") throw new Error("expected missing cells");
      expect(staleCellNonFresh.reference).toBeDefined();
      expect(staleCellFresh.reference).toBeUndefined();
    });
  });

  // ─────── 覆盖构成的四段与两面(experiment-table.md「覆盖构成」) ───────

  describe("覆盖构成的四段与两面", () => {
    /**
     * 区分力场景:"retry" 重试两次,第一次携带(历史执行)、第二次新执行——按 attempt 计数的
     * 错误实现会让合计超过题数;"solo" 只有历史执行;"stale" 只有过期结论;"gone" 未跑到。
     */
    function compositionScope(): Sample {
      const current = snap({
        experimentId: "exp/composition",
        results: [
          res("retry", "passed", { artifactBase: "exp/composition/old/retry/a0" }), // 携带,attempt 0
          res("retry", "passed", { attempt: 1 }), // 新执行,attempt 1
          res("solo", "passed", { artifactBase: "exp/composition/old/solo/a0" }),
        ],
      });
      current.configHash = "cfg-current";
      const staleRun = snap({ experimentId: "exp/composition", results: [res("stale", "failed")] });
      staleRun.configHash = "cfg-old";
      const coverage = [
        {
          experimentId: "exp/composition",
          run: current,
          knownEvalIds: ["retry", "solo", "stale", "gone"],
          missingEvalIds: ["stale", "gone"],
        },
      ];
      return makeSample("current", [current], [...current.attempts], [], coverage, false, [
        ...current.attempts,
        ...staleRun.attempts,
      ]);
    }

    /** experiment 行的覆盖构成副行(subRows 末尾,key 以 `coverage:` 起头)的 record 格。 */
    function coverageCellOf(content: ReturnType<typeof experimentListContent>, experimentId: string): Cell {
      const row = content.rows[0]!.subRows!.find((r) => r.key === `${COVERAGE_ROW_PREFIX}${experimentId}`)!;
      return row.cells.record!;
    }

    it("四段互斥且合计等于已知题数;一题同时有新执行与携带 attempt 时只落新执行段", async () => {
      const [item] = await experimentListData(compositionScope());
      const content = experimentListContent([item!]);
      const coverageCell = coverageCellOf(content, "exp/composition");
      if (coverageCell.kind !== "composition") throw new Error("expected composition cell");
      const byLabel = new Map(
        coverageCell.segments.map((segment) => [
          typeof segment.label === "string" ? segment.label : segment.label.en,
          segment.count,
        ]),
      );
      expect(byLabel.get("fresh")).toBe(1); // retry 只落新执行段,不因为它也有携带 attempt 而重复计
      expect(byLabel.get("historical")).toBe(1); // solo
      expect(byLabel.get("stale")).toBe(1); // stale
      expect(byLabel.get("not run")).toBe(1); // gone
      const total = [...coverageCell.segments].reduce((sum, s) => sum + s.count, 0);
      expect(total).toBe(4); // 合计 = knownEvalIds 数,不是 attempts 数
    });

    it("计数为零的段不出现在两面输出里,与判定计票同一条规则", async () => {
      const s = snap({ experimentId: "exp/all-fresh", results: [res("q", "passed")] });
      const [item] = await experimentListData([s]);
      const content = experimentListContent([item!]);
      const coverageCell = coverageCellOf(content, "exp/all-fresh");
      if (coverageCell.kind !== "composition") throw new Error("expected composition cell");
      expect(coverageCell.segments.filter((s) => s.count > 0)).toHaveLength(1);
      expect(formatCellText(coverageCell, "en")).toBe("1 fresh");
      expect(formatCellText(coverageCell, "zh-CN")).toBe("1 新执行");
    });

    it("段名走 LocalizedText:zh-CN 与 en 取同一份 segments,只有文案不同,计数与段序逐字相同", async () => {
      const [item] = await experimentListData(compositionScope());
      const content = experimentListContent([item!]);
      const coverageCell = coverageCellOf(content, "exp/composition");
      if (coverageCell.kind !== "composition") throw new Error("expected composition cell");
      const en = formatCellText(coverageCell, "en");
      const zh = formatCellText(coverageCell, "zh-CN");
      expect(en).toBe("1 fresh · 1 historical · 1 stale · 1 not run");
      expect(zh).toBe("1 新执行 · 1 历史执行 · 1 过期结论 · 1 未跑到");
      expect(coverageCell.segments.map((s) => s.count)).toEqual([1, 1, 1, 1]);
    });

    it("构成格不携带业务语义:它是 experiment 副行独有的格,换一套无关段名照常渲染,渲染面不认识段含义", async () => {
      const [item] = await experimentListData(compositionScope());
      const content = experimentListContent([item!]);
      // 副行紧跟在 Eval / 组行之后,key 前缀把它与题目行区分开——它不是又一道 "retry" 之类的题。
      const rowKeys = content.rows[0]!.subRows!.map((r) => r.key);
      expect(rowKeys.at(-1)).toBe(`${COVERAGE_ROW_PREFIX}exp/composition`);
      expect(rowKeys).toContain("retry");

      const arbitrarySegments: Cell = {
        kind: "composition",
        segments: [{ label: "x", count: 2 }, { label: "y", count: 0 }],
      };
      expect(formatCellText(arbitrarySegments)).toBe("2 x");
    });
  });

  // ─────── 计分制字段:evaluationKind 定义期投影 / totalScore 的两级聚合方向 / 预排 ───────

  it('ExperimentListItem.evaluationKind 是定义期事实投影,不从 attempt 判定推断:failed 的计分制 eval 仍读 "points",passed 的通过制 eval 仍读 "pass"', async () => {
    const pointsFailed = snap({ experimentId: "exam/points-fail", results: [res("a", "failed", { evaluationKind: "points" })] });
    const plainPassed = snap({ experimentId: "exam/plain-pass", results: [res("a", "passed")] });
    const items = await experimentListData([pointsFailed, plainPassed]);
    const byId = new Map(items.map((item) => [item.experimentId, item]));
    expect(byId.get("exam/points-fail")!.evaluationKind).toBe("points");
    expect(byId.get("exam/plain-pass")!.evaluationKind).toBe("pass");
  });

  it("单一 Experiment 混型:题型为 mixed，通过率只读 pass Eval，总分只读 points Eval", async () => {
    const mixed = snap({
      experimentId: "exam/mixed-one",
      results: [
        res("plain", "failed"),
        res("score", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 5)] }),
      ],
    });
    const [item] = await experimentListData([mixed]);
    expect(item!.evaluationKind).toBe("mixed");
    expect(item!.endToEndPassRate.value).toBe(0);
    expect(item!.endToEndPassRate.total).toBe(1);
    expect(item!.totalScore.value).toBe(5);
    expect(item!.evalRows.map((row) => [row.evalId, row.evaluationKind])).toEqual([
      ["plain", "pass"],
      ["score", "points"],
    ]);
  });

  it("ExperimentListItem.totalScore 是跨题 sum,不是 mean:3 分 + 5 分 = 8,不是 4", async () => {
    const s = snap({
      experimentId: "exam/multi",
      results: [
        res("q1", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 3)] }),
        res("q2", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 5)] }),
      ],
    });
    const items = await experimentListData([s]);
    expect(items[0]!.totalScore.value).toBe(8);
    expect(items[0]!.totalScore.value).not.toBe(4); // 区分力:sum ≠ mean,同分 fixture 证明不了聚合方向
  });

  it("EvalListItem.totalScore / ExperimentListEvalRow.totalScore 是题内多轮的 mean,不是 sum:4 分与 2 分平均 3,不是 6", async () => {
    const s = snap({
      experimentId: "exam/retry",
      results: [
        res("q1", "passed", { attempt: 0, evaluationKind: "points", assertions: [pointsAssertion("x", 4)] }),
        res("q1", "passed", { attempt: 1, evaluationKind: "points", assertions: [pointsAssertion("x", 2)] }),
      ],
    });
    const evalItems = await evalListData([s]);
    expect(evalItems[0]!.totalScore.value).toBe(3);
    expect(evalItems[0]!.totalScore.value).not.toBe(6); // 区分力:mean ≠ sum

    const expItems = await experimentListData([s]);
    expect(expItems[0]!.evalRows[0]!.totalScore.value).toBe(3);
  });

  it("通过制 experiment:ExperimentListItem.totalScore 为 null cell,同一行 passRate 仍是良态数字,二者并存不互斥", async () => {
    const s = snap({ experimentId: "exam/passonly", results: [res("a", "passed"), res("b", "failed")] });
    const items = await experimentListData([s]);
    expect(items[0]!.totalScore.value).toBeNull();
    expect(items[0]!.endToEndPassRate.value).toBe(0.5);
  });

  it("默认预排:纯计分制列表按 totalScore 降序,不是 passRate(两个 experiment 端到端通过率同为 1,只有总分能分出高低)", async () => {
    const low = snap({
      experimentId: "exam/a-lowscore",
      results: [res("q1", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 3)] })],
    });
    const high = snap({
      experimentId: "exam/z-highscore",
      results: [res("q1", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 9)] })],
    });
    const items = await experimentListData([low, high]);
    expect(items.map((item) => item.experimentId)).toEqual(["exam/z-highscore", "exam/a-lowscore"]);
  });

  it("默认预排:pass 与 points 混型退回 experiment id 字典序,两种读数不能互相排名", async () => {
    const pointsExp = snap({
      experimentId: "exam/z-points",
      results: [res("q1", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 100)] })],
    });
    const passExp = snap({ experimentId: "exam/a-pass", results: [res("q1", "passed")] });
    const items = await experimentListData([pointsExp, passExp]);
    // 若混型误走「只要有 points 行就按总分排」的分支,总分良态数字的 points 行会排到
    // totalScore=null(沉底)的 pass 行前面,顺序会是 [z-points, a-pass];正确的混型退回
    // 字典序应是 [a-pass, z-points]。
    expect(items.map((item) => item.experimentId)).toEqual(["exam/a-pass", "exam/z-points"]);
  });
});

// ───────────────────────── sampleSummary ─────────────────────────

describe("sampleSummary", () => {
  it("evals 按 experimentId + evalId 计数(2 实验 × 6 题 = 12),与 evalVerdicts 同分母;两级计票在含重试时不同", async () => {
    const mk = (experimentId: string) =>
      snap({
        experimentId,
        results: [
          res("q1", "passed"),
          res("q2", "failed", { attempt: 0 }),
          res("q2", "passed", { attempt: 1 }), // 重试后过:eval 级 passed,attempt 级 1 failed + 1 passed
          res("q3", "passed"),
          res("q4", "failed"),
          res("q5", "errored", { error: erroredWith("x") }),
          res("q6", "skipped"),
        ],
      });
    const data = await sampleSummary([mk("cmp/a"), mk("cmp/b")]);
    expect(data.experiments).toBe(2);
    expect(data.evals).toBe(12);
    expect(data.evalVerdicts).toEqual({ passed: 6, failed: 2, errored: 2, skipped: 2 });
    expect(
      data.evalVerdicts.passed + data.evalVerdicts.failed + data.evalVerdicts.errored + data.evalVerdicts.skipped,
    ).toBe(data.evals);
    expect(data.attemptVerdicts).toEqual({ passed: 6, failed: 4, errored: 2, skipped: 2 });
    expect(data.attemptVerdicts).not.toEqual(data.evalVerdicts);
    expect(data.range.earliestStartedAt).not.toBeNull();
    expect(data.range.latestStartedAt).not.toBeNull();
  });

  it("totalCostUSD 按 attempt 求和;一次成本都没报时 value 为 null,不伪造 0", async () => {
    const withCost = snap({
      experimentId: "exp/cost",
      results: [
        res("a", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.25 } }),
        res("b", "failed", { estimatedCostUSD: 0.05 }),
        res("c", "passed"),
      ],
    });
    const data = await sampleSummary([withCost]);
    expect(data.totalCostUSD.value).toBeCloseTo(0.3);
    const none = await sampleSummary([snap({ experimentId: "exp/free", results: [res("a", "passed")] })]);
    expect(none.totalCostUSD.value).toBeNull();
  });

  it("空范围的 range 为 null,不编造当前时间", async () => {
    const data = await sampleSummary([]);
    expect(data.range).toEqual({ earliestStartedAt: null, latestStartedAt: null });
    expect(data.evals).toBe(0);
  });

  it("evaluationKindComposition 与 totalScore:纯通过制 Sample 省略 totalScore(不摆空列)", async () => {
    const data = await sampleSummary([snap({ experimentId: "exp/pass", results: [res("a", "passed")] })]);
    expect(data.evaluationKindComposition).toBe("pass");
    expect(data.totalScore).toBeUndefined();
  });

  it("evaluationKindComposition 与 totalScore:纯计分制 Sample 携带 totalScore", async () => {
    const s = snap({
      experimentId: "exp/points",
      results: [res("a", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 3)] })],
    });
    const data = await sampleSummary([s]);
    expect(data.evaluationKindComposition).toBe("points");
    expect(data.totalScore?.value).toBe(3);
  });

  it("evaluationKindComposition:一个 Sample 里并排通过制与计分制两个 experiment → \"mixed\"", async () => {
    const passExp = snap({ experimentId: "exp/a-pass", results: [res("a", "passed")] });
    const pointsExp = snap({
      experimentId: "exp/b-points",
      results: [res("b", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 5)] })],
    });
    const data = await sampleSummary([passExp, pointsExp]);
    expect(data.evaluationKindComposition).toBe("mixed");
    expect(data.totalScore).toBeDefined();
  });

  it("evaluationKindComposition:同一 experiment 混型时通过率不被 points Eval 稀释", async () => {
    const mixed = snap({
      experimentId: "exp/mixed-one",
      results: [
        res("plain", "failed"),
        res("score", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 5)] }),
      ],
    });
    const data = await sampleSummary([mixed]);
    expect(data.evaluationKindComposition).toBe("mixed");
    expect(data.endToEndPassRate.value).toBe(0);
    expect(data.endToEndPassRate.total).toBe(1);
    expect(data.totalScore?.value).toBe(5);
  });

  it("evaluationKindComposition() 与 SampleSummaryContent.evaluationKindComposition 同一 fixture 下一致(同规则同值,不各自重复判据)", async () => {
    const passInput = [snap({ experimentId: "exp/agree-pass", results: [res("a", "passed")] })];
    expect(await evaluationKindComposition(passInput)).toBe((await sampleSummary(passInput)).evaluationKindComposition);

    const pointsInput = [
      snap({
        experimentId: "exp/agree-points",
        results: [res("a", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 3)] })],
      }),
    ];
    expect(await evaluationKindComposition(pointsInput)).toBe((await sampleSummary(pointsInput)).evaluationKindComposition);

    // 混型:一个通过制 experiment 快照 + 一个计分制 experiment 快照并排——最可能出现
    // 复制粘贴分叉的形态。
    const mixedInput = [
      snap({ experimentId: "exp/agree-a-pass", results: [res("a", "passed")] }),
      snap({
        experimentId: "exp/agree-b-points",
        results: [res("b", "passed", { evaluationKind: "points", assertions: [pointsAssertion("x", 5)] })],
      }),
    ];
    expect(await evaluationKindComposition(mixedInput)).toBe((await sampleSummary(mixedInput)).evaluationKindComposition);
  });
});

// ───────────────────────── experimentListData / sampleSummary 的 selectedEvalIds 投影 ─────────────────────────
// SampleOverview 是普通组合组件(把同一个 input 原样透传给 SampleSummary /
// ExperimentScatter / ExperimentTable,不再有自己的 data 形态);经它展开后与直接调用这三个
// 函数深等的验证挪到 dual-render.test.tsx(需要 resolve 管线)。这里只测三个函数自己的
// selectedEvalIds 投影契约。

describe("experimentListData / sampleSummary 的 selectedEvalIds 投影", () => {
  it("不同深度目录的 experiments 一律进同一份 data,不按父路径分组比较", async () => {
    const g1a = snap({ experimentId: "compare/a", agent: "bub", results: [res("q", "passed")] });
    const g1b = snap({ experimentId: "compare/b", agent: "codex", results: [res("q", "failed")] });
    const g2 = snap({ experimentId: "bench/long/x", results: [res("q", "passed")] });
    const solo = snap({ experimentId: "standalone", results: [res("q", "errored", { error: erroredWith("x") })] });
    const items = await experimentListData([g1a, g1b, g2, solo]);
    expect(items.map((e) => e.experimentId).sort()).toEqual([
      "bench/long/x",
      "compare/a",
      "compare/b",
      "standalone",
    ]);
  });

  it("每个 experiment 只保留自己选择的 eval:A 声明 selectedEvalIds:[q1] 但夹带 q2 attempt,B 只选 q2;q2 不污染 A", async () => {
    const a = snap({
      experimentId: "exp/a",
      results: [res("q1", "passed"), res("q2", "failed")],
      experiment: { attempts: 1, earlyExit: false, selectedEvalIds: ["q1"] },
    });
    const b = snap({
      experimentId: "exp/b",
      results: [res("q2", "passed")],
      experiment: { attempts: 1, earlyExit: false, selectedEvalIds: ["q2"] },
    });

    const items = await experimentListData([a, b]);
    const rowA = items.find((e) => e.experimentId === "exp/a")!;
    const rowB = items.find((e) => e.experimentId === "exp/b")!;
    expect(rowA.evals).toBe(1); // 只统计 q1,夹带的 q2 attempt 不计入
    expect(rowA.evalRows.map((r) => r.evalId)).toEqual(["q1"]);
    expect(rowB.evals).toBe(1);
    expect(rowB.evalRows.map((r) => r.evalId)).toEqual(["q2"]);

    // 汇总口径同样不被污染:全 Sample 只有 2 个 eval(exp/a·q1、exp/b·q2),不是 3 个。
    const summary = await sampleSummary([a, b]);
    expect(summary.evals).toBe(2);
  });

  it("第三方快照缺 experiment 信息时仍可见,按其实际 evals 参与(selectedEvalIdsOf 退化)", async () => {
    const thirdParty = snap({ experimentId: "third-party/exp", results: [res("q", "passed")] });
    expect(thirdParty.experiment).toBeUndefined();

    const items = await experimentListData([thirdParty]);
    expect(items.map((e) => e.experimentId)).toEqual(["third-party/exp"]);
    expect(items[0]!.evals).toBe(1);
  });
});

// ───────────────────────── metricMatrixData / measureRowsData ─────────────────────────

describe("metricMatrixData / measureRowsData", () => {
  it("矩阵稀疏:无 attempt 的组合不生成格子", async () => {
    const withCost = snap({
      experimentId: "cmp/priced",
      agent: "bub",
      results: [res("a", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.2 } })],
    });
    const noCost = snap({ experimentId: "cmp/free", agent: "codex", results: [res("b", "passed")] });
    const matrix = await metricMatrixData([withCost, noCost], {
      rows: "eval",
      columns: "agent",
      cell: passRate,
    });
    // a×codex、b×bub 没有样本 → 不出现(不是 value: 0)
    expect(matrix.cells).toHaveLength(2);
    expect(matrix.rowDimension).toBe("eval");
    expect(matrix.columnDimension).toBe("agent");
  });

  it("分组维度上未声明的 flag 归 (missing) 组,不丢行", async () => {
    const withFlag = snap({
      experimentId: "f/on",
      results: [res("a", "passed")],
      experiment: { attempts: 1, earlyExit: false, selectedEvalIds: [], flags: { memory: "mempal" } },
    });
    const withoutFlag = snap({ experimentId: "f/off", results: [res("a", "failed")] });
    const table = await measureRowsData([withFlag, withoutFlag], {
      dimensions: [flag("memory")],
      measures: [passRate],
    });
    expect(table.rows.map((r) => r.key).sort()).toEqual(["(missing)", "mempal"]);
  });

  it("measureRowsData sort:必须是 columns 中同一实例且声明 better;方向随 better,缺数据沉底", async () => {
    const hi = snap({ experimentId: "s/hi", results: [res("a", "passed")] });
    const lo = snap({ experimentId: "s/lo", results: [res("a", "failed")] });
    const na = snap({ experimentId: "s/na", results: [res("a", "skipped")] });
    const byPass = await measureRowsData([lo, hi, na], {
      dimensions: ["experiment"],
      measures: [passRate],
      sort: passRate,
    });
    expect(byPass.rows.map((r) => r.key)).toEqual(["s/hi", "s/lo", "s/na"]);

    const fast = snap({ experimentId: "d/fast", results: [res("a", "passed", { durationMs: 10 })] });
    const slow = snap({ experimentId: "d/slow", results: [res("a", "passed", { durationMs: 99 })] });
    const byDuration = await measureRowsData([slow, fast], {
      dimensions: ["experiment"],
      measures: [durationMs],
      sort: durationMs,
    });
    expect(byDuration.rows.map((r) => r.key)).toEqual(["d/fast", "d/slow"]); // lower better:低在前

    await expect(
      measureRowsData([hi], { dimensions: ["experiment"], measures: [passRate], sort: durationMs }),
    ).rejects.toThrow(/measures/);
    const noBetter: AttemptMetric = { name: "plain", value: () => 1 };
    await expect(
      measureRowsData([hi], { dimensions: ["experiment"], measures: [noBetter], sort: noBetter }),
    ).rejects.toThrow(/better/);
  });

  it("省略 sort 时按行 key 字典序(维度 domain 稳定序,不随文件扫描顺序)", async () => {
    const b = snap({ experimentId: "o/bbb", results: [res("a", "passed")] });
    const a = snap({ experimentId: "o/aaa", results: [res("a", "failed")] });
    const table = await measureRowsData([b, a], { dimensions: ["experiment"], measures: [passRate] });
    expect(table.rows.map((r) => r.key)).toEqual(["o/aaa", "o/bbb"]);
  });
});

// ───────────────────────── metricLineData ─────────────────────────

describe("metricLineData", () => {
  const flaggedSnap = (experimentId: string, budget: number | undefined, verdicts: Verdict[]) =>
    snap({
      experimentId,
      results: verdicts.map((v, i) => res(`q${i}`, v)),
      experiment: {
        attempts: 1,
        earlyExit: false,
        selectedEvalIds: [],
        ...(budget !== undefined ? { flags: { budget } } : {}),
      },
    });

  it("未声明数值 flag 的 experiment 不伪造 x 值(不落到 x=0)并可数", async () => {
    const data = await metricLineData(
      [flaggedSnap("l/100", 100, ["passed"]), flaggedSnap("l/none", undefined, ["passed"])],
      { x: numericFlag("budget"), y: passRate },
    );
    const missing = data.rows.filter((r) => r.x === null);
    expect(missing).toHaveLength(1);
    expect(data.rows.some((r) => r.x === 0)).toBe(false);
  });

  it("点身份 = (series, x):同桶多 experiment 合成一个点,y 按 (series, x, experiment, eval) 顺序聚合", async () => {
    // 两个 experiment 同 x=100:各 1 题,一个 passed 一个 failed → 合成一点 y = (1+0)/2
    const data = await metricLineData(
      [flaggedSnap("m/one", 100, ["passed"]), flaggedSnap("m/two", 100, ["failed"])],
      { x: numericFlag("budget"), y: passRate },
    );
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]!.key).toBe("100"); // x 的稳定十进制字符串
    expect(data.rows[0]!.x).toBe(100);
    expect(data.rows[0]!.y.value).toBeCloseTo(0.5);
  });

  it("自定义 NumericAxis.of 在同一 experiment × eval 内不恒定时报完整用户反馈,不静默取首值", async () => {
    const s = snap({
      experimentId: "l/vary",
      results: [res("q", "passed", { attempt: 0, durationMs: 10 }), res("q", "passed", { attempt: 1, durationMs: 20 })],
    });
    const perAttempt = {
      name: "per-attempt",
      of: (attempt: AttemptHandle) => attempt.result.durationMs,
    };
    await expect(metricLineData([s], { x: perAttempt, y: passRate })).rejects.toThrow(/not constant/);
  });
});

// deltaTableData(对照矩阵)与 stabilityMatrixData(稳定性矩阵)的测试住
// src/report/slices/delta-table.test.ts 与 stability-matrix.test.ts
// (专用组件测试文件,不挤共享 compute.test.ts)。

// ───────────────────────── examScore ─────────────────────────

describe("examScore", () => {
  it("gate 决定能否得分,soft 给质量分;errored 交白卷是 0 分不是缺数据", async () => {
    const s = snap({
      experimentId: "exam/x",
      results: [
        res("soft", "passed", { assertions: [softAssertion("a", 0.5), softAssertion("b", 1)] }),
        res("allgate", "passed"),
        res("crashed", "errored", { error: erroredWith("boom") }),
      ],
    });
    const table = await measureRowsData([s], { dimensions: ["eval"], measures: [examScore] });
    const cellOf = (key: string) => metricCell(table.rows.find((r) => r.key === key)!, examScore.name);
    expect(cellOf("soft").value).toBeCloseTo(0.75);
    expect(cellOf("allgate").value).toBe(1);
    expect(cellOf("crashed").value).toBe(0);
    expect(cellOf("crashed").samples).toBe(1); // 0 分是测得的事实,不是缺数据
  });
});

// ───────────────────────── totalScore ─────────────────────────

describe("totalScore", () => {
  it("计分制 eval:assertions[].points 之和 + scoreEntries[].points 之和,纯累加", async () => {
    const s = snap({
      experimentId: "score/x",
      results: [
        res("checkpoints", "passed", {
          evaluationKind: "points",
          assertions: [pointsAssertion("a", 1), pointsAssertion("b", 1), pointsAssertion("c", 0)],
          scoreEntries: [{ label: "代码精简", points: 15 }],
        }),
      ],
    });
    const table = await measureRowsData([s], { dimensions: ["eval"], measures: [totalScore] });
    const cellOf = (key: string) => metricCell(table.rows.find((r) => r.key === key)!, totalScore.name);
    expect(cellOf("checkpoints").value).toBe(17); // 1 + 1 + 0 + 15
  });

  it("errored 记 null(基础设施得 null,不折成 0),不进分母", async () => {
    const s = snap({
      experimentId: "score/errored",
      results: [res("crashed", "errored", { evaluationKind: "points", error: erroredWith("boom") })],
    });
    const table = await measureRowsData([s], { dimensions: ["eval"], measures: [totalScore] });
    const cell = metricCell(table.rows.find((r) => r.key === "crashed")!, totalScore.name);
    expect(cell.value).toBeNull();
    expect(cell.samples).toBe(0);
  });

  it("skipped 记 null", async () => {
    const s = snap({
      experimentId: "score/skipped",
      results: [res("skip", "skipped", { evaluationKind: "points", skipReason: "not applicable" })],
    });
    const table = await measureRowsData([s], { dimensions: ["eval"], measures: [totalScore] });
    expect(metricCell(table.rows.find((r) => r.key === "skip")!, totalScore.name).value).toBeNull();
  });

  it("failed(gate 挂了)仍照实求和已挣到的分——中止挣 0 靠 test() 控制流,不靠这个指标折成 0", async () => {
    const s = snap({
      experimentId: "score/failed",
      results: [
        res("partial", "failed", {
          evaluationKind: "points",
          assertions: [
            pointsAssertion("step1", 1),
            pointsAssertion("step2", 0, { outcome: "failed" as const, severity: "gate" }),
          ],
        }),
      ],
    });
    const table = await measureRowsData([s], { dimensions: ["eval"], measures: [totalScore] });
    expect(metricCell(table.rows.find((r) => r.key === "partial")!, totalScore.name).value).toBe(1);
  });

  it("通过制 eval(evaluationKind 省略或 \"pass\"):恒 null,不参与聚合——两种题型天然不互相污染", async () => {
    const s = snap({
      experimentId: "score/mixed-scope",
      results: [res("pass-eval", "passed"), res("also-pass-eval", "passed", { evaluationKind: "pass" })],
    });
    const table = await measureRowsData([s], { dimensions: ["eval"], measures: [totalScore] });
    expect(metricCell(table.rows.find((r) => r.key === "pass-eval")!, totalScore.name).value).toBeNull();
    expect(metricCell(table.rows.find((r) => r.key === "also-pass-eval")!, totalScore.name).value).toBeNull();
  });

  it("聚合口径:同一 eval 的多个 attempt 取均值(perEval mean),跨 eval 求和(acrossEvals sum)", async () => {
    const s = snap({
      experimentId: "score/aggregate",
      results: [
        // 同一题 "q1" 跑两轮:4 分与 2 分 → perEval mean = 3
        res("q1", "passed", { attempt: 0, evaluationKind: "points", assertions: [pointsAssertion("a", 4)] }),
        res("q1", "passed", { attempt: 1, evaluationKind: "points", assertions: [pointsAssertion("a", 2)] }),
        // 另一题 "q2" 跑一轮:5 分
        res("q2", "passed", { evaluationKind: "points", assertions: [pointsAssertion("a", 5)] }),
      ],
    });
    const table = await measureRowsData([s], { dimensions: ["experiment"], measures: [totalScore] });
    // acrossEvals sum:q1 的 perEval 均值(3)+ q2 的值(5)= 8,不是全部 attempt 直接相加(11)。
    expect(metricCell(table.rows[0]!, totalScore.name).value).toBe(8);
  });

  it("从公开导出面(niceeval/report 顶层)可以拿到同一个 totalScore Calculation,构建自定义报告不需要下钻内部模块", async () => {
    const { totalScore: totalScoreFromBarrel, aggregate, experiment } = await import("../index.ts");
    const { totalScore: totalScoreCalc } = await import("../model/calculation.ts");
    expect(totalScoreFromBarrel).toBe(totalScoreCalc); // 同引用:barrel 不复制一份新计算
    const s = snap({
      experimentId: "score/barrel",
      results: [res("checkpoints", "passed", { evaluationKind: "points", assertions: [pointsAssertion("a", 4)] })],
    });
    const rows = await aggregate(scopeOf([s]), {
      by: { experiment },
      values: { totalScore: totalScoreFromBarrel },
    });
    expect(rows[0]!.totalScore.value).toBe(4);
  });
});

// ───────────────────────── labels 维度、series 归类与 connect ─────────────────────────

describe("labels 维度、series 归类与 connect", () => {
  const labeled = (
    experimentId: string,
    labels: globalThis.Record<string, string | number> | undefined,
    verdicts: Verdict[],
    agent = "agent-x",
  ) =>
    snap({
      experimentId,
      agent,
      results: verdicts.map((v, i) => res(`q${i}`, v, { agent })),
      experiment: {
        attempts: 1,
        earlyExit: false,
        selectedEvalIds: verdicts.map((_, i) => `q${i}`),
        ...(labels ? { labels } : {}),
      },
    });

  it("label() 按声明值分组、未声明归 (missing);numericLabel 对字符串值返回 null 不猜序", async () => {
    const table = await measureRowsData(
      [labeled("m/one", { memory: "mempal" }, ["passed"]), labeled("m/two", undefined, ["failed"])],
      { dimensions: [label("memory")], measures: [passRate] },
    );
    expect(table.rows.map((r) => r.key).sort()).toEqual(["(missing)", "mempal"]);

    const line = await metricLineData(
      [labeled("m/num", { contextK: 32 }, ["passed"]), labeled("m/str", { contextK: "big" }, ["passed"])],
      { x: numericLabel("contextK"), y: passRate },
    );
    expect(line.rows.filter((r) => r.x === null)).toHaveLength(1);
    expect(line.rows.some((r) => r.x === 32)).toBe(true);
    expect(line.rows.some((r) => r.x === 0)).toBe(false);
  });

  it("同图撞色按图例顺序线性探测空格;无冲突键仍取散列格;超过色板才复用", () => {
    // 真实回归现场:bub / claude-code / codex 在同一张图里必须三色互异
    const real = colorIndicesForKeys(["bub", "claude-code", "codex"]);
    expect(new Set(real.values()).size).toBe(3);
    // 构造性冲突:找两个散列同格的键,后到者让位,先到者保持散列格(跨图稳定)
    const pool = Array.from({ length: 40 }, (_, i) => `k${i}`);
    const byIdx = new Map<number, string[]>();
    for (const k of pool) {
      const idx = colorIndexForKey(k);
      byIdx.set(idx, [...(byIdx.get(idx) ?? []), k]);
    }
    const [first, second] = [...byIdx.values()].find((keys) => keys.length >= 2)!;
    const resolved = colorIndicesForKeys([first, second]);
    expect(resolved.get(first)).toBe(colorIndexForKey(first));
    expect(resolved.get(second)).not.toBe(resolved.get(first));
    // 前 6 个键占满 6 色;第 7 个开始只能复用
    const seven = colorIndicesForKeys(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(new Set([...seven.values()].slice(0, 6)).size).toBe(6);
  });
});

describe("validate*Data 接受真实计算产物(不是只接受手写 literal)", () => {
  // 手写 literal 通过校验只证明 validator 认得自己设想的形状;真正的把关是喂真实计算产物——
  // 尤其是省略可选字段(如自定义指标不声明 label)的真实路径,不是校验作者假想的边界。
  const a = snap({ experimentId: "compare/a", results: [res("q1", "passed"), res("q2", "failed")] });
  const b = snap({ experimentId: "compare/b", results: [res("q1", "failed"), res("q2", "passed")] });
  const scope = scopeOf([a, b]);
  const noLabelMetric: AttemptMetric = { name: "custom-no-label", value: (attempt) => (attempt.result.verdict === "passed" ? 1 : 0) };

  it("measureRowsData:含未声明 label 的自定义指标", async () => {
    const table = await measureRowsData(scope, { dimensions: ["agent"], measures: [costUSD, noLabelMetric] });
    expect(isDataset(table)).toBe(true);
  });

  it("metricMatrixData", async () => {
    const matrix = await metricMatrixData(scope, { rows: "experiment", columns: "eval", cell: passRate });
    expect(validateMatrixData(matrix)).toBeNull();
  });

  it("metricLineData", async () => {
    const line = await metricLineData(scope, { x: numericFlag("budget"), y: passRate });
    expect(validateLineData(line)).toBeNull();
  });

  it("scoreboardData", async () => {
    const board = await scoreboardData(scope, { rows: "agent", questions: ["q1", "q2"] });
    expect(validateScoreboardData(board)).toBeNull();
  });

  it("deltaTableData(含 conditionsByFlag 派生条件)", async () => {
    const withFlag = snap({
      experimentId: "compare/withflag",
      results: [res("q1", "passed")],
      experiment: { attempts: 1, earlyExit: false, selectedEvalIds: [], flags: { memory: "on" } },
    });
    const withoutFlag = snap({
      experimentId: "compare/noflag",
      results: [res("q1", "failed")],
      experiment: { attempts: 1, earlyExit: false, selectedEvalIds: [], flags: {} },
    });
    const deltaScope = scopeOf([withFlag, withoutFlag]);
    const delta = await deltaTableData(deltaScope, { by: "experiment", conditions: conditionsByFlag("memory") });
    expect(validateDeltaData(delta)).toBeNull();
  });

  it("stabilityMatrixData", async () => {
    const stability = await stabilityMatrixData(scope, { by: "experiment" });
    expect(validateStabilityMatrixData(stability)).toBeNull();
  });

  it("sampleSummary", async () => {
    const summary = await sampleSummary(scope);
    expect(validateSampleSummaryContent(summary)).toBeNull();
  });

  it("experimentListData / evalListData / attemptListData(同一 Sample 三种粒度)", async () => {
    expect(validateExperimentListData(await experimentListData(scope))).toBeNull();
    expect(validateEvalListData(await evalListData(scope))).toBeNull();
    expect(validateAttemptListData(await attemptListData(scope))).toBeNull();
  });
});
