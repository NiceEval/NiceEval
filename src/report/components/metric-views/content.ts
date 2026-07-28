// 指标视图 TableContent 投影:compute *Data → Table 原语可直接消费的形状。

import type { Cell, TableContent } from "../../definition/cell.ts";
import type { DeltaData, MatrixData, ScoreboardData, StabilityMatrixData } from "../../model/types.ts";
import { resolveLocalizedText } from "../../model/locale.ts";

export interface MatrixTableContent extends TableContent {
  readonly rowDimension: string;
  readonly columnDimension: string;
  readonly measureKey: string;
}

export function metricMatrixContent(data: MatrixData): MatrixTableContent {
  const columnKeys = [...new Set(data.cells.map((c) => c.column))].sort();
  const rowKeys = [...new Set(data.cells.map((c) => c.row))].sort();
  const byPosition = new Map(data.cells.map((c) => [`${c.row}\0${c.column}`, c.cell] as const));
  const better = data.metric.better;
  return {
    rowDimension: data.rowDimension,
    columnDimension: data.columnDimension,
    measureKey: data.metric.key,
    columns: [
      { key: data.rowDimension },
      ...columnKeys.map((key) => ({ key, ...(better !== undefined ? { better } : {}) })),
    ],
    rows: rowKeys.map((rowKey) => {
      const cells: globalThis.Record<string, Cell> = {
        [data.rowDimension]: { kind: "text", text: rowKey },
      };
      for (const columnKey of columnKeys) {
        const cell = byPosition.get(`${rowKey}\0${columnKey}`);
        cells[columnKey] = cell ? { kind: "measure", measure: cell } : { kind: "notApplicable" };
      }
      return { key: rowKey, cells };
    }),
  };
}

export function scoreboardContent(data: ScoreboardData): TableContent {
  const subjectKeys: string[] = [];
  for (const row of data.rows) {
    for (const subject of row.subjects) {
      if (!subjectKeys.includes(subject.key)) subjectKeys.push(subject.key);
    }
  }
  return {
    columns: [
      { key: "entity" },
      { key: "total", better: "higher" },
      ...subjectKeys.map((key) => ({ key, better: "higher" as const })),
    ],
    rows: data.rows.map((row) => {
      const cells: globalThis.Record<string, Cell> = {
        entity: { kind: "text", text: row.key },
        total: {
          kind: "score",
          earned: row.total.value,
          possible: data.fullMarks,
        },
      };
      for (const subjectKey of subjectKeys) {
        const subject = row.subjects.find((s) => s.key === subjectKey);
        cells[subjectKey] = subject
          ? { kind: "text", text: resolveLocalizedText(subject.display, "en") }
          : { kind: "notApplicable" };
      }
      return { key: row.key, cells };
    }),
  };
}

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
    columns: [{ key: "eval" }, ...conditionColumns, ...deltaColumns],
    rows: data.rows.map((row) => {
      const cells: globalThis.Record<string, Cell> = {
        eval: { kind: "text", text: row.key, ...(row.flipped ? { detail: "⇄" } : {}) },
      };
      for (const condition of data.conditions) {
        const cell = row.cells[condition];
        cells[`${condition}:verdict`] = cell
          ? cell.scoring === "points"
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

export function stabilityMatrixContent(data: StabilityMatrixData): TableContent {
  const columns = [
    { key: "eval" },
    ...data.columns.map((column) => ({ key: column })),
    { key: "total" },
  ];
  const rows = data.rows.map((row) => {
    const cells: globalThis.Record<string, Cell> = {
      eval: { kind: "text", text: row.evalId, ...(row.neverPassed ? { detail: "never passed" } : {}) },
    };
    let passed = 0;
    let failed = 0;
    let errored = 0;
    for (const column of data.columns) {
      const cell = data.cells.find((c) => c.row === row.evalId && c.column === column)?.cell;
      if (cell) {
        cells[column] = {
          kind: "verdict",
          counts: { passed: cell.passed, failed: cell.failed, errored: cell.errored, skipped: 0 },
        };
        passed += cell.passed;
        failed += cell.failed;
        errored += cell.errored;
      } else {
        cells[column] = { kind: "notApplicable" };
      }
    }
    cells.total = {
      kind: "verdict",
      counts: { passed, failed, errored, skipped: 0 },
    };
    return { key: row.evalId, cells };
  });
  return { columns, rows };
}
