// cases: docs/engineering/testing/unit/reports.md
// 「数据源」行:`experimentRows` 的 Eval 分组层——按 evalId 目录前缀分区、两条收起条件、
// 无 `/` 题与组行同级、身份格内联实体计数、组行读数聚合而占位行不进分母、子行去前缀但 key 仍是完整 evalId;
// attempt 行 duration/tokens/cost 走 measure 格式化(table.md 渲染契约)。
// 断言面是 Content,不经浏览器。

import { describe, expect, it } from "vitest";
import type { AttemptListItem, ExperimentListEvalRow, ExperimentListItem, MetricValue } from "../../model/types.ts";
import { attemptListContent, evalListContent, experimentListContent } from "./content.ts";
import type { Cell, TableContentRow } from "../../definition/cell.ts";
import { resolveLocalizedText } from "../../model/locale.ts";
import type { AttemptLocator } from "../../../record/locator.ts";
import { formatCellText } from "../../definition/cell.ts";

const emptyCell: MetricValue = { value: null, basis: "eval", samples: 0, total: 0, refs: [] };
const locator = (s: string): AttemptLocator => s as AttemptLocator;

function cell(value: number, total = 1): MetricValue {
  return { value, samples: 1, total, basis: "eval", refs: [] };
}

function tokenCell(value: number, total = 1): MetricValue {
  return { ...cell(value, total), unit: "tokens", better: "lower", bounds: { min: 0 } };
}

function attempt(
  evalId: string,
  verdict: AttemptListItem["verdict"],
  overrides: Partial<AttemptListItem> = {},
): AttemptListItem {
  const id = evalId.replace(/\W/g, "").slice(0, 6).padEnd(6, "0");
  return {
    experimentId: "exp/x",
    evalId,
    attempt: 0,
    agent: "codex",
    evaluationKind: "pass",
    verdict,
    failureSummary: null,
    moreFailures: 0,
    examScore: emptyCell,
    totalScore: emptyCell,
    tokens: tokenCell(10_000),
    durationMs: 385_652,
    costUSD: 0.077336,
    startedAt: "2026-07-01T00:00:00Z",
    locator: locator(`@1${id}01`),
    ...overrides,
  };
}

function evalRow(
  evalId: string,
  verdict: ExperimentListEvalRow["verdict"],
  attempts: AttemptListItem[],
  overrides: Partial<ExperimentListEvalRow> = {},
): ExperimentListEvalRow {
  const evaluationKind = overrides.evaluationKind ?? (attempts.some((item) => item.evaluationKind === "points") ? "points" : "pass");
  const passAttempts = evaluationKind === "points" ? [] : attempts.filter((item) => item.evaluationKind === "pass");
  const readablePassAttempts = passAttempts.filter((item) => item.verdict !== "skipped");
  const passRefs = passAttempts.map((item) => item.locator);
  return {
    evalId,
    evaluationKind,
    verdict,
    endToEndPassRate: {
      value: readablePassAttempts.length === 0
        ? null
        : readablePassAttempts.filter((item) => item.verdict === "passed").length / readablePassAttempts.length,
      unit: "%",
      better: "higher",
      bounds: { min: 0, max: 1 },
      basis: "eval",
      samples: readablePassAttempts.length,
      total: passAttempts.length,
      refs: passRefs,
    },
    totalScore: emptyCell,
    durationMs: cell(attempts[0]?.durationMs ?? 0),
    costUSD: cell(attempts[0]?.costUSD ?? 0),
    tokens: emptyCell,
    attempts,
    ...overrides,
  };
}

function experimentItem(partial: Partial<ExperimentListItem> & Pick<ExperimentListItem, "evalRows" | "missing">): ExperimentListItem {
  return {
    experimentId: "exp/x",
    agent: "codex",
    evaluationKind: "pass",
    evalVerdicts: { passed: 0, failed: 0, errored: 0, skipped: 0 },
    endToEndPassRate: emptyCell,
    totalScore: emptyCell,
    costUSD: emptyCell,
    durationMs: emptyCell,
    tokens: emptyCell,
    evals: partial.evalRows.length,
    attempts: partial.evalRows.reduce((sum, row) => sum + row.attempts.length, 0),
    knownEvalIds: [],
    lastRunAt: "2026-07-01T00:00:00Z",
    ...partial,
  };
}

function entityText(cell: Cell | undefined): string {
  if (cell?.kind === "text") return cell.text;
  return "";
}

/** experiment 行的 Eval / 组行。 */
function realSubRows(row: TableContentRow): readonly TableContentRow[] {
  return row.subRows ?? [];
}

describe("experimentListContent Eval 分组层", () => {
  it("按目录前缀分区:组行带聚合读数,子行去掉前缀但 key 仍是完整 evalId", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("downshift/pr-1484", "passed", [attempt("downshift/pr-1484", "passed")]),
          evalRow("downshift/pr-1500", "failed", [attempt("downshift/pr-1500", "failed")]),
          evalRow("weather/tool", "passed", [attempt("weather/tool", "passed")]),
          evalRow("weather/rerank", "failed", [attempt("weather/rerank", "failed")]),
        ],
        missing: [],
      }),
    ]);
    const sub = realSubRows(content.rows[0]!);
    expect(sub.map((row) => row.variant)).toEqual(["group", "group"]);
    expect(sub.map((row) => row.key)).toEqual(["group:downshift", "group:weather"]);
    // 两组通过率都是 50%,按 groupKey 字典序收口
    expect(entityText(sub[0]!.cells.entity)).toBe("downshift (2 evals)");
    expect(sub[0]!.cells.entity).toEqual({ kind: "text", text: "downshift (2 evals)" });
    expect(sub[0]!.cells.passRate).toMatchObject({ kind: "metric", metric: { value: 0.5 } });
    expect(sub[0]!.cells.model).toEqual({ kind: "notApplicable" });
    expect(sub[0]!.cells.agent).toEqual({ kind: "notApplicable" });

    const kids = sub[0]!.subRows!;
    expect(kids.map((row) => row.key)).toEqual(["downshift/pr-1484", "downshift/pr-1500"]);
    expect(kids.map((row) => entityText(row.cells.entity))).toEqual(["pr-1484", "pr-1500"]);
    // Eval 行没有主读数(单题 0/100 是判定的重复表达):格子在场且显式不适用,不是缺格
    expect(kids[0]!.cells.passRate).toEqual({ kind: "notApplicable" });
  });

  it("只有一个组时整层收起,Eval 行标签退回完整 evalId", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("algebra/retry", "passed", [attempt("algebra/retry", "passed")]),
          evalRow("algebra/simple", "failed", [attempt("algebra/simple", "failed")]),
        ],
        missing: [],
      }),
    ]);
    const sub = realSubRows(content.rows[0]!);
    expect(sub.every((row) => row.variant !== "group")).toBe(true);
    expect(sub.map((row) => row.key)).toEqual(["algebra/retry", "algebra/simple"]);
    expect(sub.map((row) => entityText(row.cells.entity))).toEqual(["algebra/retry", "algebra/simple"]);
  });

  it("每个组都只有一道题时整层收起", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("algebra/retry", "passed", [attempt("algebra/retry", "passed")]),
          evalRow("weather/tool", "failed", [attempt("weather/tool", "failed")]),
        ],
        missing: [],
      }),
    ]);
    const sub = realSubRows(content.rows[0]!);
    expect(sub.every((row) => row.variant !== "group")).toBe(true);
    expect(sub.map((row) => entityText(row.cells.entity))).toEqual(["algebra/retry", "weather/tool"]);
  });

  it("不含 / 的题与组行同级,不造未分组假组", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("downshift/a", "passed", [attempt("downshift/a", "passed")]),
          evalRow("downshift/b", "failed", [attempt("downshift/b", "failed")]),
          evalRow("standalone", "passed", [attempt("standalone", "passed")]),
        ],
        missing: [],
      }),
    ]);
    const sub = realSubRows(content.rows[0]!);
    expect(sub.map((row) => row.key)).toEqual(["group:downshift", "standalone"]);
    expect(sub[0]!.variant).toBe("group");
    expect(sub[1]!.variant).toBeUndefined();
    expect(entityText(sub[1]!.cells.entity)).toBe("standalone");
    expect(sub.some((row) => entityText(row.cells.entity) === "未分组" || entityText(row.cells.entity) === "其它")).toBe(
      false,
    );
  });

  it("占位行入组且不进读数分母;全组缺失时读数格是 missing 而非 notApplicable", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("weather/tool", "passed", [attempt("weather/tool", "passed")]),
          evalRow("weather/rerank", "failed", [attempt("weather/rerank", "failed")]),
        ],
        missing: ["weather/gap", "ghost/a", "ghost/b"].map((evalId) => ({ evalId, reason: "never-run" as const })),
      }),
    ]);
    const sub = realSubRows(content.rows[0]!);
    // weather 有 2 道实题 + 1 占位 → 保留组;ghost 两道全缺失也保留组
    expect(sub.map((row) => row.key)).toEqual(["group:weather", "group:ghost"]);

    const weather = sub[0]!;
    expect(entityText(weather.cells.entity)).toBe("weather (2/3 evals)");
    // 占位不进通过率分母:仍是 1 passed / 1 failed = 50%,不是 /3
    expect(weather.cells.passRate).toMatchObject({ kind: "metric", metric: { value: 0.5, total: 2 } });
    expect(weather.subRows!.some((row) => row.variant === "placeholder" && row.key.endsWith("weather/gap:missing"))).toBe(
      true,
    );
    expect(entityText(weather.subRows!.find((row) => row.variant === "placeholder")!.cells.entity)).toBe("gap");

    const ghost = sub[1]!;
    expect(entityText(ghost.cells.entity)).toBe("ghost (0/2 evals)");
    expect(ghost.cells.passRate).toEqual({ kind: "missing", code: "noSamples" });
    expect(ghost.cells.durationMs).toEqual({ kind: "missing", code: "noSamples" });
    expect(ghost.cells.costUSD).toEqual({ kind: "missing", code: "noSamples" });
    expect(ghost.cells.record).toEqual({ kind: "missing", code: "noSamples" });
    // Model/Agent 仍是 notApplicable(对分组行没有意义),与 missing 读数格对照
    expect(ghost.cells.model).toEqual({ kind: "notApplicable" });
    // missing.code 经 locale 映射,中文面与空 measure 格同文「无数据」,不落英文 no data
    expect(formatCellText(ghost.cells.passRate, "zh-CN")).toBe("无数据");
    expect(formatCellText(ghost.cells.passRate, "en")).toBe("no data");
  });

  it("Experiment 身份格只显示实验名,路径段计数留在所属组行", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("downshift/a", "passed", [attempt("downshift/a", "passed")]),
          evalRow("downshift/b", "failed", [attempt("downshift/b", "failed"), attempt("downshift/b", "passed", { attempt: 1 })]),
          evalRow("weather/a", "passed", [attempt("weather/a", "passed")]),
          evalRow("weather/b", "failed", [attempt("weather/b", "failed")]),
        ],
        missing: [],
      }),
    ]);

    expect(content.rows[0]!.cells.entity).toEqual({
      kind: "text",
      text: "exp/x",
    });
    expect(content.rows[0]!.subRows![0]!.cells.entity).toEqual({ kind: "text", text: "downshift (2 evals)" });
  });

  it("组行 tokens / totalScore 走统一格式化入口,不落裸数字", () => {
    const content = experimentListContent([
      experimentItem({
        evaluationKind: "points",
        evalRows: [
          evalRow("downshift/a", "passed", [attempt("downshift/a", "passed")], {
            tokens: { value: 40_000, basis: "eval", samples: 1, total: 1, refs: [] },
            totalScore: { value: 800, basis: "eval", samples: 1, total: 1, refs: [] },
          }),
          evalRow("downshift/b", "passed", [attempt("downshift/b", "passed")], {
            tokens: { value: 53_000, basis: "eval", samples: 1, total: 1, refs: [] },
            totalScore: { value: 434, basis: "eval", samples: 1, total: 1, refs: [] },
          }),
          evalRow("weather/tool", "passed", [attempt("weather/tool", "passed")], {
            tokens: { value: 9_000, basis: "eval", samples: 1, total: 1, refs: [] },
            totalScore: { value: 10, basis: "eval", samples: 1, total: 1, refs: [] },
          }),
          evalRow("weather/rerank", "failed", [attempt("weather/rerank", "failed")], {
            tokens: { value: 9_000, basis: "eval", samples: 1, total: 1, refs: [] },
            totalScore: { value: 0, basis: "eval", samples: 1, total: 1, refs: [] },
          }),
        ],
        missing: [],
      }),
    ]);
    const downshift = content.rows[0]!.subRows!.find((row) => row.key === "group:downshift")!;
    // mean(40000, 53000) = 46500 → "46.5k tokens"; sum(800, 434) = 1234 → "1.2k"
    expect(downshift.cells.tokens).toMatchObject({
      kind: "metric",
      metric: { value: 46_500 },
    });
    expect(downshift.cells.totalScore).toMatchObject({
      kind: "metric",
      metric: { value: 1_234 },
    });
    expect(JSON.stringify(downshift.cells.tokens)).not.toContain('"display":"46500"');
    expect(JSON.stringify(downshift.cells.totalScore)).not.toContain('"display":"1234"');
  });

  it("路径段递归嵌套:a/b/c 在兄弟组有区分力时逐层展开,不是只取首段", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("pkg/sub/a", "passed", [attempt("pkg/sub/a", "passed")]),
          evalRow("pkg/sub/b", "failed", [attempt("pkg/sub/b", "failed")]),
          evalRow("pkg/other/c", "passed", [attempt("pkg/other/c", "passed")]),
          evalRow("pkg/other/d", "failed", [attempt("pkg/other/d", "failed")]),
        ],
        missing: [],
      }),
    ]);
    const sub = realSubRows(content.rows[0]!);
    // 顶层只有 pkg → 剥壳;下层 sub/other 各两题 → 插组
    expect(sub.map((row) => row.key)).toEqual(["group:pkg/other", "group:pkg/sub"]);
    expect(sub.map((row) => entityText(row.cells.entity))).toEqual(["other (2 evals)", "sub (2 evals)"]);
    const subGroup = sub.find((row) => row.key === "group:pkg/sub")!;
    expect(subGroup.subRows!.map((row) => row.key)).toEqual(["pkg/sub/a", "pkg/sub/b"]);
    expect(subGroup.subRows!.map((row) => entityText(row.cells.entity))).toEqual(["a", "b"]);
  });

  it("三层同壳无兄弟区分时整链剥掉,叶子标签退回完整 evalId", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("111/111/aaa", "passed", [attempt("111/111/aaa", "passed")]),
          evalRow("111/111/bbb", "failed", [attempt("111/111/bbb", "failed")]),
        ],
        missing: [],
      }),
    ]);
    const sub = realSubRows(content.rows[0]!);
    expect(sub.every((row) => row.variant !== "group")).toBe(true);
    expect(sub.map((row) => entityText(row.cells.entity))).toEqual(["111/111/aaa", "111/111/bbb"]);
  });
});

describe("attempt 行 measure 格式化", () => {
  it("独立列表与 Experiment 展开层的 durationMs / costUSD 都保留 unit,不落原始数字字符串", () => {
    const content = attemptListContent([attempt("q", "failed", { durationMs: 385_652, costUSD: 0.007336 })]);
    const row = content.rows[0]!;
    expect(row.cells.durationMs).toMatchObject({
      kind: "metric",
      metric: { value: 385_652, unit: "ms" },
    });
    expect(row.cells.costUSD).toMatchObject({
      kind: "metric",
      metric: { value: 0.007336, unit: "$" },
    });

    const nested = experimentListContent([
      experimentItem({
        evalRows: [evalRow("q", "failed", [attempt("q", "failed", { durationMs: 385_652, costUSD: 0.007336 })])],
        missing: [],
      }),
    ]).rows[0]!.subRows![0]!.subRows![0]!;
    expect(nested.cells.durationMs).toMatchObject({
      kind: "metric",
      metric: { value: 385_652, unit: "ms" },
    });
    expect(nested.cells.costUSD).toMatchObject({
      kind: "metric",
      metric: { value: 0.007336, unit: "$" },
    });

    // 区分力:若仍写 String(durationMs)/String(costUSD),会命中这些原文
    const flat = JSON.stringify([row.cells, nested.cells]);
    expect(flat).not.toContain('"text":"385652"');
    expect(flat).not.toContain('"text":"0.007336"');
  });
});

describe("attempt 行的判定长在 locator 上", () => {
  // cases: docs/engineering/testing/unit/reports.md「Attempt 行的判定长在 locator 上」。
  it("Experiment 展开层里 failed 与 errored 的 locator 格各带自己的判定", () => {
    const nested = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("q", "failed", [
            attempt("q", "failed", { locator: locator("@1aaaaa01") }),
            attempt("q", "errored", { locator: locator("@1bbbbb01") }),
          ]),
        ],
        missing: [],
      }),
    ]).rows[0]!.subRows![0]!.subRows!;
    // 区分力:两行的判定不同,没有被折成「非 passed」一档
    expect(nested[0]!.cells.entity).toMatchObject({ kind: "locator", verdict: "failed" });
    expect(nested[1]!.cells.entity).toMatchObject({ kind: "locator", verdict: "errored" });
  });

  it("独立 attempt 列表同样把判定带在 locator 上", () => {
    const content = attemptListContent([attempt("q", "passed")]);
    expect(content.rows[0]!.cells.entity).toMatchObject({ kind: "locator", verdict: "passed" });
  });

  it("text 面在 locator 前打判定符,不靠 class 单独表意", () => {
    expect(formatCellText({ kind: "locator", locator: locator("@1aaaaa01"), verdict: "passed" })).toBe("✓ @1aaaaa01");
    expect(formatCellText({ kind: "locator", locator: locator("@1bbbbb01"), verdict: "errored" })).toBe("! @1bbbbb01");
    // 没有判定的 locator 格不凭空补判定符
    expect(formatCellText({ kind: "locator", locator: locator("@1ccccc01") })).toBe("@1ccccc01");
  });
});

describe("行形状与列集同源", () => {
  // cases: docs/engineering/testing/unit/reports.md「表格行形状与列集同源」。
  // 区分力场景:同一个 attempt 行构造被层级表与平铺表两种列集消费。
  const columnKeys = (content: { columns: readonly { key: string }[] }): string[] =>
    content.columns.map((column) => column.key);

  function assertRowShapes(content: { columns: readonly { key: string }[]; rows: readonly TableContentRow[] }): void {
    const expected = columnKeys(content).sort();
    const walk = (row: TableContentRow): void => {
      expect({ row: row.key, keys: Object.keys(row.cells).sort() }).toEqual({ row: row.key, keys: expected });
      for (const child of row.subRows ?? []) walk(child);
    };
    for (const row of content.rows) walk(row);
  }

  it("层级表:每一行(含 group / placeholder / 各层子行)的 cells key 集合等于列集", () => {
    const content = experimentListContent([
      experimentItem({
        evaluationKind: "points",
        evalRows: [
          evalRow("weather/tool", "passed", [attempt("weather/tool", "passed")]),
          evalRow("weather/rerank", "failed", [attempt("weather/rerank", "failed")]),
          evalRow("standalone", "passed", [attempt("standalone", "passed")]),
        ],
        missing: [{ evalId: "weather/gap", reason: "never-run" }],
      }),
    ]);
    // 组行、占位行与两层子行都在这棵树里
    const variants = new Set<string | undefined>();
    const collect = (row: TableContentRow): void => {
      variants.add(row.variant);
      for (const child of row.subRows ?? []) collect(child);
    };
    for (const row of content.rows) collect(row);
    expect(variants).toEqual(new Set([undefined, "group", "placeholder"]));
    assertRowShapes(content);
  });

  it("平铺表:attempt 行按平铺列集填格,不写层级表才有的 record", () => {
    const flat = attemptListContent([attempt("q", "failed")]);
    expect(columnKeys(flat)).toEqual(["entity", "verdict", "result", "durationMs", "costUSD", "score"]);
    assertRowShapes(flat);
    expect(flat.rows[0]!.cells.record).toBeUndefined();

    const evals = evalListContent([
      {
        experimentId: "exp/x",
        evalId: "q",
        verdict: "failed",
        examScore: emptyCell,
        totalScore: emptyCell,
        durationMs: emptyCell,
        costUSD: emptyCell,
        attempts: [attempt("q", "failed")],
      },
    ]);
    assertRowShapes(evals);
    expect(evals.rows[0]!.subRows![0]!.cells.record).toBeUndefined();
  });

  it("区分力:同一个 attempt 在两种列集下各自成行,不是一份格子四处塞", () => {
    const item = attempt("q", "failed", { locator: locator("@1aaaaa01") });
    const nested = experimentListContent([
      experimentItem({ evalRows: [evalRow("q", "failed", [item])], missing: [] }),
    ]);
    const flat = attemptListContent([item]);
    const nestedAttempt = nested.rows[0]!.subRows![0]!.subRows![0]!;
    const flatAttempt = flat.rows[0]!;
    expect(nestedAttempt.key).toBe(flatAttempt.key);
    // 两张表的列集不同,同一次 attempt 的格子集合各自与自己那张表的列集相等
    expect(Object.keys(nestedAttempt.cells).sort()).toEqual(columnKeys(nested).sort());
    expect(Object.keys(flatAttempt.cells).sort()).toEqual(columnKeys(flat).sort());
    expect(Object.keys(nestedAttempt.cells).sort()).not.toEqual(Object.keys(flatAttempt.cells).sort());
    // 共有的列取同一份原料
    expect(nestedAttempt.cells.entity).toEqual(flatAttempt.cells.entity);
    expect(nestedAttempt.cells.durationMs).toEqual(flatAttempt.cells.durationMs);
  });

  it("不适用的列是显式 notApplicable 格:Eval 行的 model / agent 在场且渲染成 —", () => {
    const content = experimentListContent([
      experimentItem({ evalRows: [evalRow("q", "passed", [attempt("q", "passed")])], missing: [] }),
    ]);
    const evalCells = content.rows[0]!.subRows![0]!.cells;
    for (const key of ["model", "agent"]) {
      // 与「缺格」在校验层可区分:格子在场,值是 notApplicable
      expect(evalCells[key]).toEqual({ kind: "notApplicable" });
      expect(formatCellText(evalCells[key], "zh-CN")).toBe("—");
    }
  });

  it("Tokens 四层都有值：Experiment / 组 / Eval 显示各自聚合，Attempt 显示该次精确值", () => {
    const first = attempt("suite/a", "passed", { tokens: tokenCell(30_000), locator: locator("@1aaaaa01") });
    const second = attempt("suite/a", "failed", { attempt: 1, tokens: tokenCell(54_000), locator: locator("@1bbbbb01") });
    const other = attempt("suite/b", "passed", { tokens: tokenCell(18_000), locator: locator("@1cccccc1") });
    const content = experimentListContent([
      experimentItem({
        tokens: tokenCell(30_000),
        evalRows: [
          evalRow("suite/a", "passed", [first, second], { tokens: tokenCell(42_000) }),
          evalRow("suite/b", "passed", [other], { tokens: tokenCell(18_000) }),
        ],
        missing: [],
      }),
    ]);

    const experiment = content.rows[0]!;
    const evalA = experiment.subRows!.find((row) => row.key === "suite/a")!;
    expect(formatCellText(experiment.cells.tokens, "zh-CN")).toBe("30k tokens");
    expect(formatCellText(evalA.cells.tokens, "zh-CN")).toBe("42k tokens");
    expect(evalA.subRows!.map((row) => formatCellText(row.cells.tokens, "zh-CN"))).toEqual([
      "30k tokens",
      "54k tokens",
    ]);
  });

  it("列集随 composition 变时行跟着变:纯计分制没有 passRate 列,行上也没有那一格", () => {
    const points = experimentListContent([
      experimentItem({ evaluationKind: "points", evalRows: [evalRow("q", "passed", [attempt("q", "passed")])], missing: [] }),
    ]);
    expect(columnKeys(points)).not.toContain("passRate");
    expect(points.rows[0]!.cells.passRate).toBeUndefined();
    assertRowShapes(points);

    const pass = experimentListContent([
      experimentItem({ evalRows: [evalRow("q", "passed", [attempt("q", "passed")])], missing: [] }),
    ]);
    expect(columnKeys(pass)).not.toContain("totalScore");
    expect(pass.rows[0]!.cells.totalScore).toBeUndefined();
    assertRowShapes(pass);
  });

  it("单一 Experiment 混型时两列并排，Experiment 行分别填写两种主读数", () => {
    const plainAttempt = attempt("plain", "failed");
    const scoreAttempt = attempt("score", "passed", {
      evaluationKind: "points",
      totalScore: cell(5),
    });
    const content = experimentListContent([
      experimentItem({
        evaluationKind: "mixed",
        endToEndPassRate: cell(0),
        totalScore: cell(5),
        evalRows: [
          evalRow("plain", "failed", [plainAttempt]),
          evalRow("score", "passed", [scoreAttempt], { evaluationKind: "points", totalScore: cell(5) }),
        ],
        missing: [],
      }),
    ]);
    expect(columnKeys(content)).toEqual(expect.arrayContaining(["passRate", "totalScore"]));
    expect(content.rows[0]!.cells.passRate).toMatchObject({ kind: "metric", metric: { value: 0 } });
    expect(content.rows[0]!.cells.totalScore).toMatchObject({ kind: "metric", metric: { value: 5 } });
    const [plainRow, scoreRow] = content.rows[0]!.subRows!;
    // Eval / Attempt 层沿用原有表格纪律：主读数只在 Experiment / group 行展示，叶子以 verdict 表意。
    expect(plainRow!.cells.passRate).toEqual({ kind: "notApplicable" });
    expect(plainRow!.cells.totalScore).toEqual({ kind: "notApplicable" });
    expect(scoreRow!.cells.passRate).toEqual({ kind: "notApplicable" });
    expect(scoreRow!.cells.totalScore).toEqual({ kind: "notApplicable" });
    expect(plainRow!.subRows![0]!.cells.totalScore).toEqual({ kind: "notApplicable" });
    expect(scoreRow!.subRows![0]!.cells.totalScore).toEqual({ kind: "notApplicable" });
    assertRowShapes(content);
  });
});

describe("列表头长在列声明上", () => {
  // cases: docs/engineering/testing/unit/reports.md「表头长在列声明上」。
  it("层级表各列自带 header,两种语言各解析一份", () => {
    const content = experimentListContent([
      experimentItem({ evalRows: [evalRow("q", "passed", [attempt("q", "passed")])], missing: [] }),
    ]);
    const headerOf = (key: string, locale: string): string =>
      resolveLocalizedText(content.columns.find((column) => column.key === key)!.header!, locale);
    expect(headerOf("entity", "en")).toBe("Experiment");
    expect(headerOf("entity", "zh-CN")).toBe("实验");
    expect(headerOf("passRate", "zh-CN")).toBe("通过率");
    expect(headerOf("tokens", "en")).toBe("Avg. tokens");
    expect(headerOf("tokens", "zh-CN")).toBe("平均 Tokens");
    expect(headerOf("costUSD", "zh-CN")).toBe("成本");
    expect(headerOf("record", "zh-CN")).toBe("结果");
  });
});

describe("判定构成列每层都有值", () => {
  // cases: docs/engineering/testing/unit/reports.md「判定构成列每层都有值」。
  it("Eval 行的 record 格是 attempts 计票:先挂后过的重试两票都在,不被题目级折叠吞掉", () => {
    const rows = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("q", "passed", [
            attempt("q", "failed", { locator: locator("@1aaaaa01") }),
            attempt("q", "passed", { attempt: 1, locator: locator("@1bbbbb01") }),
          ]),
        ],
        missing: [],
      }),
    ]).rows;
    expect(rows[0]!.subRows![0]!.cells.record).toEqual({
      kind: "verdict",
      counts: { passed: 1, failed: 1, errored: 0, skipped: 0 },
    });
  });

  it("Attempt 行的 record 格是该次判定:failed 与 errored 两行不同,没有折成「非 passed」一档", () => {
    const nested = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("q", "failed", [
            attempt("q", "failed", { locator: locator("@1aaaaa01") }),
            attempt("q", "errored", { attempt: 1, locator: locator("@1bbbbb01") }),
          ]),
        ],
        missing: [],
      }),
    ]).rows[0]!.subRows![0]!.subRows!;
    expect(nested[0]!.cells.record).toEqual({ kind: "verdict", verdict: "failed" });
    expect(nested[1]!.cells.record).toEqual({ kind: "verdict", verdict: "errored" });
  });

  it("record 格的 key 在层级表列集里存在:两层的判定构成列都不渲染成 —", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [evalRow("q", "passed", [attempt("q", "passed")])],
        missing: [],
      }),
    ]);
    const recordColumn = content.columns.find((column) => column.key === "record");
    expect(recordColumn).toBeDefined();
    const evalCells = content.rows[0]!.subRows![0]!.cells;
    const attemptCells = content.rows[0]!.subRows![0]!.subRows![0]!.cells;
    expect(formatCellText(evalCells.record, "zh-CN")).toBe("1 通过");
    expect(formatCellText(attemptCells.record, "zh-CN")).toBe("✓ 通过");
  });

  it("text 面计票与单判定按 locale 取判定词,单判定带判定符", () => {
    expect(
      formatCellText({ kind: "verdict", counts: { passed: 10, failed: 1, errored: 5, skipped: 0 } }, "zh-CN"),
    ).toBe("10 通过 · 1 失败 · 5 错误");
    expect(
      formatCellText({ kind: "verdict", counts: { passed: 2, failed: 0, errored: 0, skipped: 0 } }, "en"),
    ).toBe("2 passed");
    expect(formatCellText({ kind: "verdict", verdict: "errored" }, "zh-CN")).toBe("! 错误");
    expect(formatCellText({ kind: "verdict", verdict: "passed" }, "en")).toBe("✓ passed");
  });
});
