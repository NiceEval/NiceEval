// 指标视图 TableContent 投影:compute *Data → Table 原语可直接消费的形状。

import type { Cell, TableContent, TableContentRow } from "../definition/cell.ts";
import type { DeltaData, StabilityMatrixCell, StabilityMatrixData } from "../model/types.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import { localizedMessage } from "../model/locale.ts";

export function deltaTableContent(data: DeltaData): TableContent {
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
        cells[`${condition}:verdict`] = cell
          ? cell.evaluationKind === "points"
            ? {
                kind: "text",
                text: cell.totalScore !== undefined ? String(cell.totalScore) : "—",
              }
            : { kind: "verdict", verdict: cell.verdict }
          : { kind: "notApplicable" };
        cells[`${condition}:tokens`] =
          cell?.totalTokens !== undefined
            ? { kind: "text", text: String(cell.totalTokens) }
            : { kind: "notApplicable" };
        cells[`${condition}:cost`] =
          cell?.totalCostUSD !== undefined
            ? { kind: "text", text: String(cell.totalCostUSD) }
            : { kind: "notApplicable" };
      }
      for (const condition of data.conditions.slice(1)) {
        const delta = row.delta?.[condition];
        cells[`${condition}:Δscore`] =
          delta?.score !== undefined ? { kind: "text", text: String(delta.score) } : { kind: "notApplicable" };
        cells[`${condition}:Δtokens`] =
          delta?.tokens !== undefined ? { kind: "text", text: String(delta.tokens) } : { kind: "notApplicable" };
        cells[`${condition}:Δcost`] =
          delta?.costUSD !== undefined ? { kind: "text", text: String(delta.costUSD) } : { kind: "notApplicable" };
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
