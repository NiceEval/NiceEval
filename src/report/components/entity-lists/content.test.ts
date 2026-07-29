// cases: docs/engineering/testing/unit/reports.md
// 「数据源」行:`experimentRows` 的 Eval 分组层——按 evalId 目录前缀分区、两条收起条件、
// 无 `/` 题与组行同级、组行读数聚合而占位行不进分母、子行去前缀但 key 仍是完整 evalId;
// attempt 行 duration/cost 走 measure 格式化(table.md 渲染契约)。
// 断言面是 Content,不经浏览器。

import { describe, expect, it } from "vitest";
import type { AttemptListItem, ExperimentListEvalRow, ExperimentListItem, MetricValue } from "../../model/types.ts";
import { attemptListContent, experimentListContent } from "./content.ts";
import type { Cell } from "../../definition/cell.ts";
import type { AttemptLocator } from "../../../record/locator.ts";
import { formatCellText } from "../../definition/cell.ts";

const emptyCell: MetricValue = { value: null, basis: "eval", samples: 0, total: 0, refs: [] };
const locator = (s: string): AttemptLocator => s as AttemptLocator;

function cell(value: number, total = 1): MetricValue {
  return { value, samples: 1, total, basis: "eval", refs: [] };
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
    verdict,
    failureSummary: null,
    moreFailures: 0,
    examScore: emptyCell,
    totalScore: emptyCell,
    durationMs: 385_652,
    costUSD: 0.077336,
    startedAt: "2026-07-01T00:00:00Z",
    historical: false,
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
  return {
    evalId,
    verdict,
    totalScore: emptyCell,
    durationMs: cell(attempts[0]?.durationMs ?? 0),
    costUSD: cell(attempts[0]?.costUSD ?? 0),
    tokens: emptyCell,
    attempts,
    ...overrides,
  };
}

function experimentItem(partial: Partial<ExperimentListItem> & Pick<ExperimentListItem, "evalRows" | "missingEvalIds">): ExperimentListItem {
  return {
    experimentId: "exp/x",
    agent: "codex",
    scoring: "pass",
    evalVerdicts: { passed: 0, failed: 0, errored: 0, unreadable: 0 },
    endToEndPassRate: emptyCell,
    totalScore: emptyCell,
    costUSD: emptyCell,
    durationMs: emptyCell,
    tokens: emptyCell,
    evals: partial.evalRows.length,
    attempts: partial.evalRows.reduce((sum, row) => sum + row.attempts.length, 0),
    historicalAttempts: 0,
    lastRunAt: "2026-07-01T00:00:00Z",
    ...partial,
  };
}

function entityText(cell: Cell | undefined): string {
  if (cell?.kind === "text") return cell.text;
  return "";
}

function entityDetail(cell: Cell | undefined): string | undefined {
  if (cell?.kind === "text") return cell.detail;
  return undefined;
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
        missingEvalIds: [],
      }),
    ]);
    const sub = content.rows[0]!.subRows!;
    expect(sub.map((row) => row.variant)).toEqual(["group", "group"]);
    expect(sub.map((row) => row.key)).toEqual(["group:downshift", "group:weather"]);
    // 两组通过率都是 50%,按 groupKey 字典序收口
    expect(entityText(sub[0]!.cells.entity)).toBe("downshift");
    expect(entityDetail(sub[0]!.cells.entity)).toBe("2 evals");
    expect(sub[0]!.cells.passRate).toMatchObject({ kind: "metric", metric: { value: 0.5 } });
    expect(sub[0]!.cells.model).toEqual({ kind: "notApplicable" });
    expect(sub[0]!.cells.agent).toEqual({ kind: "notApplicable" });

    const kids = sub[0]!.subRows!;
    expect(kids.map((row) => row.key)).toEqual(["downshift/pr-1484", "downshift/pr-1500"]);
    expect(kids.map((row) => entityText(row.cells.entity))).toEqual(["pr-1484", "pr-1500"]);
    // Eval 行没有主读数(单题 0/100 是判定的重复表达)
    expect(kids[0]!.cells.passRate).toBeUndefined();
  });

  it("只有一个组时整层收起,Eval 行标签退回完整 evalId", () => {
    const content = experimentListContent([
      experimentItem({
        evalRows: [
          evalRow("algebra/retry", "passed", [attempt("algebra/retry", "passed")]),
          evalRow("algebra/simple", "failed", [attempt("algebra/simple", "failed")]),
        ],
        missingEvalIds: [],
      }),
    ]);
    const sub = content.rows[0]!.subRows!;
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
        missingEvalIds: [],
      }),
    ]);
    const sub = content.rows[0]!.subRows!;
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
        missingEvalIds: [],
      }),
    ]);
    const sub = content.rows[0]!.subRows!;
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
        missingEvalIds: ["weather/gap", "ghost/a", "ghost/b"],
      }),
    ]);
    const sub = content.rows[0]!.subRows!;
    // weather 有 2 道实题 + 1 占位 → 保留组;ghost 两道全缺失也保留组
    expect(sub.map((row) => row.key)).toEqual(["group:weather", "group:ghost"]);

    const weather = sub[0]!;
    expect(entityDetail(weather.cells.entity)).toBe("2/3 evals");
    // 占位不进通过率分母:仍是 1 passed / 1 failed = 50%,不是 /3
    expect(weather.cells.passRate).toMatchObject({ kind: "metric", metric: { value: 0.5, total: 2 } });
    expect(weather.subRows!.some((row) => row.variant === "placeholder" && row.key.endsWith("weather/gap:missing"))).toBe(
      true,
    );
    expect(entityText(weather.subRows!.find((row) => row.variant === "placeholder")!.cells.entity)).toBe("gap");

    const ghost = sub[1]!;
    expect(entityDetail(ghost.cells.entity)).toBe("0/2 evals");
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

  it("组行 tokens / totalScore 走统一格式化入口,不落裸数字", () => {
    const content = experimentListContent([
      experimentItem({
        scoring: "points",
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
        missingEvalIds: [],
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
        missingEvalIds: [],
      }),
    ]);
    const sub = content.rows[0]!.subRows!;
    // 顶层只有 pkg → 剥壳;下层 sub/other 各两题 → 插组
    expect(sub.map((row) => row.key)).toEqual(["group:pkg/other", "group:pkg/sub"]);
    expect(sub.map((row) => entityText(row.cells.entity))).toEqual(["other", "sub"]);
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
        missingEvalIds: [],
      }),
    ]);
    const sub = content.rows[0]!.subRows!;
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
        missingEvalIds: [],
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
