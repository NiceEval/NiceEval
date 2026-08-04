// 指标视图 TableContent 投影:compute *Data → Table 原语可直接消费的形状。

import type { Cell, TableContent, TableContentRow } from "../definition/cell.ts";
import type { DeltaData, StabilityMatrixCell, StabilityMatrixData, StaleConclusionReference } from "../model/types.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import { DEFAULT_REPORT_LOCALE, localizedMessage, type ReportLocale } from "../model/locale.ts";
import { formatMetricValue, formatPlainNumber, formatPoints, formatTimeDistance, verdictMark } from "../model/format.ts";

/**
 * 带符号的美元/tokens 差值:复用 `formatMetricValue` 折终值(内建 unit 格式不分 locale,
 * presentation.md「unit 决定格式」),只在外面补一个恒定的正负号——负值 `formatMetricValue`
 * 已经自带 "-",这里只需要给非负值补 "+"。
 */
function signedMetricText(value: number, unit: "tokens" | "$"): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatMetricValue(value, unit)}`;
}

/** 带符号的挣分差值("+4 pts" / "-4 pts");`formatPointsSuffix` 恒加 "+" 号,不适用于可能为负的差值。 */
function signedPointsText(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${formatPlainNumber(abs)} ${abs === 1 ? "pt" : "pts"}`;
}

/**
 * 一格的判定读法(docs/feature/reports/show/compare.md):有数据时通过制只留判定符(`bare`,
 * 历史执行再接相对时距)、计分制显示挣分;该条件缺席这道题时,记录里有过期结论参考才给
 * `— <判定符> <时距>`(`—` 不被参考替换,它标记「这一格没有可聚合的结果」,参考只是附注),
 * 没有参考就是纯 `notApplicable`。参考不进任何计数——它压根不出现在 `cells` 里,只在这一格
 * 的显示上多一句附注。
 */
function conditionVerdictCell(
  cell: DeltaData["rows"][number]["cells"][string] | undefined,
  reference: StaleConclusionReference | undefined,
  locale: ReportLocale,
): Cell {
  if (!cell) {
    if (!reference) return { kind: "notApplicable" };
    const mark = verdictMark(reference.verdict === "skipped" ? "skipped" : reference.verdict);
    return { kind: "text", text: `— ${mark} ${formatTimeDistance(reference.staleSinceMs, locale)}` };
  }
  if (cell.evaluationKind === "points") {
    return { kind: "text", text: cell.totalScore !== undefined ? formatPoints(cell.totalScore) : "—" };
  }
  return {
    kind: "verdict",
    verdict: cell.verdict,
    bare: true,
    ...(cell.historical && cell.staleSinceMs !== undefined ? { staleSinceMs: cell.staleSinceMs } : {}),
  };
}

export function deltaTableContent(data: DeltaData, locale: ReportLocale = DEFAULT_REPORT_LOCALE): TableContent {
  const conditionColumns = data.conditions.flatMap((condition) => [
    { key: `${condition}:verdict` },
    { key: `${condition}:tokens` },
    { key: `${condition}:cost` },
  ]);
  const deltaColumns = data.conditions.slice(1).flatMap((condition) => [
    { key: `${condition}:Δscore` },
    { key: `${condition}:Δtokens` },
    { key: `${condition}:Δcost` },
  ]);
  return {
    // eval 是语义列,带表头;条件名与 Δ 列的列名即数据,不声明 header。
    columns: [{ key: "eval", header: localizedMessage("table.eval") }, ...conditionColumns, ...deltaColumns],
    rows: data.rows.map((row) => {
      const cells: globalThis.Record<string, Cell> = {
        eval: { kind: "text", text: row.key, ...(row.flipped ? { detail: "⇄" } : {}) },
      };
      for (const condition of data.conditions) {
        const cell = row.cells[condition];
        cells[`${condition}:verdict`] = conditionVerdictCell(cell, row.references?.[condition], locale);
        cells[`${condition}:tokens`] =
          cell?.totalTokens !== undefined
            ? { kind: "metric", metric: { value: cell.totalTokens, unit: "tokens", basis: "eval", samples: 1, total: 1, refs: cell.attempts } }
            : { kind: "notApplicable" };
        cells[`${condition}:cost`] =
          cell?.totalCostUSD !== undefined
            ? { kind: "metric", metric: { value: cell.totalCostUSD, unit: "$", basis: "eval", samples: 1, total: 1, refs: cell.attempts } }
            : { kind: "notApplicable" };
      }
      for (const condition of data.conditions.slice(1)) {
        const delta = row.delta?.[condition];
        cells[`${condition}:Δscore`] =
          delta?.score !== undefined ? { kind: "text", text: signedPointsText(delta.score) } : { kind: "notApplicable" };
        cells[`${condition}:Δtokens`] =
          delta?.tokens !== undefined ? { kind: "text", text: signedMetricText(delta.tokens, "tokens") } : { kind: "notApplicable" };
        cells[`${condition}:Δcost`] =
          delta?.costUSD !== undefined ? { kind: "text", text: signedMetricText(delta.costUSD, "$") } : { kind: "notApplicable" };
      }
      return { key: row.key, cells };
    }),
  };
}

export interface StabilityContentRow extends TableContentRow {
  readonly evalId: string;
  /** 全部条件历史执行中通过次数为 0 且执行数 > 0。 */
  readonly neverPassed: boolean;
}

/** 稳定性矩阵的 Content:通用 TableContent 之上保留行身份、neverPassed 与各列合计。 */
export interface StabilityContent extends TableContent {
  readonly rowDimension: string;
  readonly columnDimension: string;
  readonly rows: readonly StabilityContentRow[];
  readonly totals: Readonly<globalThis.Record<string, StabilityMatrixCell>>;
}

export function stabilityMatrixContent(data: StabilityMatrixData): StabilityContent {
  const columns = [
    { key: "eval", header: localizedMessage("table.eval") },
    // 条件名列的列名即数据,不声明 header。
    ...data.columns.map((column) => ({ key: column })),
    { key: "total" },
  ];
  const rows = data.rows.map((row): StabilityContentRow => {
    const cells: globalThis.Record<string, Cell> = {
      eval: { kind: "text", text: row.evalId, ...(row.neverPassed ? { detail: "never passed" } : {}) },
    };
    let passed = 0;
    let failed = 0;
    let errored = 0;
    const rowRefs: AttemptLocator[] = [];
    for (const column of data.columns) {
      const entry = data.cells.find((c) => c.row === row.evalId && c.column === column);
      if (entry) {
        cells[column] = {
          kind: "verdict",
          counts: { passed: entry.cell.passed, failed: entry.cell.failed, errored: entry.cell.errored, skipped: 0 },
          refs: entry.refs,
        };
        passed += entry.cell.passed;
        failed += entry.cell.failed;
        errored += entry.cell.errored;
        rowRefs.push(...entry.refs);
      } else {
        cells[column] = { kind: "notApplicable" };
      }
    }
    cells.total = {
      kind: "verdict",
      counts: { passed, failed, errored, skipped: 0 },
      refs: [...rowRefs].sort(),
    };
    return { key: row.evalId, cells, evalId: row.evalId, neverPassed: row.neverPassed };
  });
  return {
    columns,
    rows,
    rowDimension: data.rowDimension,
    columnDimension: data.columnDimension,
    totals: data.totals,
  };
}
