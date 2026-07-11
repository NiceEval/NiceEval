// 官方组件的 text 面:同一份算好的数据,渲染成终端字符(niceeval show 的形态)。
// 输出形态照 docs-site/zh/guides/report-components.mdx 的示例块;与 web 面共守
// 诚实契约:排序随 better、samples < total 角标、缺数据 — 不补 0、截断报剩余。
// 零 react、零 IO、纯同步 —— 这是 text 宿主不需要 react-dom 的那一半。

import type {
  CaseListData,
  DeltaData,
  LineData,
  MatrixData,
  MetricColumn,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
} from "../types.ts";
import type { TextContext } from "../tree.ts";
import { MISSING_TEXT, formatDurationMs, formatMetricValue, formatPlainNumber, formatUSD } from "../format.ts";
import { indentBlock, padDisplay, renderAlignedRows, textBar, wrapDisplay } from "./layout.ts";
import { renderCharPlot, renderCoordinateTable, type PlotPoint } from "./plot.ts";

const MISSING_MARK = "—";

/** 格子的文本形态:缺数据 —,覆盖不全带 samples/total 角标。 */
export function cellText(cell: { value: number | null; display: string; samples: number; total: number }): string {
  if (cell.value === null) return MISSING_MARK;
  return cell.samples < cell.total ? `${cell.display} ${cell.samples}/${cell.total}` : cell.display;
}

// ───────────────────────── RunOverview ─────────────────────────

export function overviewText(data: OverviewData): string {
  const { totals, snapshots } = data;
  const runs = new Set(snapshots.map((s) => s.startedAt)).size;
  const latest = snapshots.map((s) => s.startedAt).sort().at(-1);
  const head = [
    `${snapshots.length} ${snapshots.length === 1 ? "experiment" : "experiments"}`,
    `${totals.evals} evals`,
    `${totals.attempts} attempts`,
    `composed from ${runs} ${runs === 1 ? "run" : "runs"}`,
    ...(latest ? [`latest ${latest}`] : []),
  ].join(" · ");
  const tallies = [
    `passed ${totals.passed}`,
    `failed ${totals.failed}`,
    `errored ${totals.errored}`,
    `skipped ${totals.skipped}`,
    totals.costUSD === null ? MISSING_TEXT : formatUSD(totals.costUSD),
    formatDurationMs(totals.durationMs),
  ].join(" · ");
  const lines = [head, tallies];
  for (const warning of data.warnings) lines.push(`! ${warning.message}`);
  return lines.join("\n");
}

// ───────────────────────── MetricTable ─────────────────────────

export function tableText(data: TableData): string {
  const header = [data.dimension, ...data.columns.map((c) => c.label)];
  const rows = data.rows.map((row) => [
    row.key,
    ...data.columns.map((col) => {
      const cell = (row.cells as Record<string, TableData["rows"][number]["cells"][string]>)[col.key];
      return cell ? cellText(cell) : MISSING_MARK;
    }),
  ]);
  return renderAlignedRows([header, ...rows]);
}

// ───────────────────────── MetricMatrix ─────────────────────────

export function matrixText(data: MatrixData): string {
  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  const byPosition = new Map<string, MatrixData["cells"][number]["cell"]>();
  for (const entry of data.cells) {
    if (!rowKeys.includes(entry.row)) rowKeys.push(entry.row);
    if (!columnKeys.includes(entry.column)) columnKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }
  const header = [data.rows, ...columnKeys];
  const rows = rowKeys.map((row) => [
    row,
    ...columnKeys.map((column) => {
      const cell = byPosition.get(JSON.stringify([row, column]));
      return cell ? cellText(cell) : MISSING_MARK; // 稀疏格子在文本里以 — 呈现,不编数
    }),
  ]);
  const table = renderAlignedRows([header, ...rows]);

  // 下钻命令:行维度是 eval 时,指向最值得看的一行(先挑有缺格的,再挑按 better 最差的)
  if (data.rows !== "eval" || rowKeys.length === 0) return table;
  const better = data.metric.better ?? "higher";
  let next: string | undefined;
  let worst: { key: string; value: number } | undefined;
  for (const row of rowKeys) {
    let sum = 0;
    let count = 0;
    for (const column of columnKeys) {
      const cell = byPosition.get(JSON.stringify([row, column]));
      if (!cell || cell.value === null) {
        next ??= row;
        continue;
      }
      sum += cell.value;
      count += 1;
    }
    if (count > 0) {
      const value = sum / count;
      const isWorse = worst === undefined || (better === "higher" ? value < worst.value : value > worst.value);
      if (isWorse) worst = { key: row, value };
    }
  }
  next ??= worst?.key;
  return next === undefined ? table : `${table}\n\nnext: niceeval show ${next}`;
}

// ───────────────────────── MetricBars(矩阵数据的另一种摆法)─────────────────────────

const BAR_WIDTH = 20;

export function barsText(data: MatrixData): string {
  const groupKeys: string[] = [];
  const seriesKeys: string[] = [];
  const byPosition = new Map<string, MatrixData["cells"][number]["cell"]>();
  for (const entry of data.cells) {
    if (!groupKeys.includes(entry.row)) groupKeys.push(entry.row);
    if (!seriesKeys.includes(entry.column)) seriesKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }
  const better = data.metric.better ?? "higher";
  // 条长刻度:% 的天然域是 [0,1],其余以全图最大值为满条
  const values = data.cells.map((c) => c.cell.value).filter((v): v is number => v !== null);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const ratioOf = (value: number) =>
    data.metric.unit === "%" ? value : maxValue === 0 ? 0 : value / maxValue;

  const seriesWidth = Math.max(...seriesKeys.map((k) => k.length), 0);
  const lines: string[] = [];
  for (const group of groupKeys) {
    lines.push(group);
    const entries = seriesKeys.map((series) => ({
      series,
      cell: byPosition.get(JSON.stringify([group, series])),
    }));
    // 组内按值排序,方向随 better(缺数据沉底)
    entries.sort((a, b) => {
      const va = a.cell?.value ?? null;
      const vb = b.cell?.value ?? null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return better === "lower" ? va - vb : vb - va;
    });
    for (const { series, cell } of entries) {
      const label = padDisplay(series, seriesWidth);
      if (!cell || cell.value === null) {
        lines.push(`  ${label}   ${MISSING_MARK}`);
        continue;
      }
      lines.push(`  ${label}   ${textBar(ratioOf(cell.value), BAR_WIDTH)}  ${cellText(cell)}`);
    }
  }
  return lines.join("\n");
}

// ───────────────────────── Scoreboard ─────────────────────────

export function scoreboardText(data: ScoreboardData): string {
  const subjectKeys: string[] = [];
  for (const row of data.rows) {
    for (const subject of row.subjects) {
      if (!subjectKeys.includes(subject.key)) subjectKeys.push(subject.key);
    }
  }
  const header = [data.dimension, "total", ...subjectKeys];
  const rows = data.rows.map((row) => [
    row.key,
    `${row.total.display}/${data.fullMarks}`,
    ...subjectKeys.map((key) => {
      const subject = row.subjects.find((s) => s.key === key);
      if (!subject) return MISSING_MARK;
      const score = `${formatPlainNumber(subject.earned)}/${formatPlainNumber(subject.possible)}`;
      return subject.missing > 0 ? `${score} (${subject.missing} missing)` : score;
    }),
  ]);
  const table = renderAlignedRows([header, ...rows]);
  if (data.weights.length === 0) return table;
  // 实际生效的权重表 —— 成绩单可审计
  const weights = data.weights.map((w) => `${w.prefix} ×${w.weight}`).join(" · ");
  return `${table}\nweights: ${weights} · others ×1`;
}

// ───────────────────────── MetricScatter ─────────────────────────

const POINT_MARKS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function axisLabel(col: MetricColumn): string {
  return col.label;
}

export function scatterText(data: ScatterData, ctx: TextContext): string {
  const drawable = data.rows.filter((r) => r.x.value !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(`${missing} ${missing === 1 ? "point" : "points"} missing data`);

  if (drawable.length === 0) {
    return [MISSING_TEXT, ...footnotes].join("\n");
  }

  // 点太密排不下时降级为坐标表,不硬挤
  if (drawable.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      drawable.map((r) => ({ key: r.key, x: r.x.display, y: r.y.display })),
      { key: data.points, x: axisLabel(data.x), y: axisLabel(data.y) },
    );
    return [table, ...footnotes].join("\n");
  }

  const points: PlotPoint[] = drawable.map((r, i) => ({
    mark: POINT_MARKS[i],
    x: r.x.value as number,
    y: r.y.value as number,
  }));
  // 同系列的点按 x 排序连线
  const bySeries = new Map<string, { x: number; y: number }[]>();
  for (const r of drawable) {
    if (r.series === undefined) continue;
    const list = bySeries.get(r.series) ?? [];
    list.push({ x: r.x.value as number, y: r.y.value as number });
    bySeries.set(r.series, list);
  }
  for (const list of bySeries.values()) list.sort((a, b) => a.x - b.x);

  const invertX = data.x.better === "lower";
  const plot = renderCharPlot({
    width: ctx.width,
    points,
    lines: [...bySeries.values()].filter((l) => l.length > 1),
    xLabel: `${axisLabel(data.x)}${invertX ? " (axis reversed: right = better)" : ""}`,
    yLabel: axisLabel(data.y),
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
    invertX,
    invertY: data.y.better === "lower",
  });
  const legend = drawable.map((r, i) => `${POINT_MARKS[i]} ${r.key}`).join("   ");
  return [plot, "", `better → upper right`, legend, ...footnotes].join("\n");
}

// ───────────────────────── MetricLine ─────────────────────────

export function lineText(data: LineData, ctx: TextContext): string {
  const drawable = data.rows.filter((r) => r.x !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(`${missing} ${missing === 1 ? "point" : "points"} missing data`);

  if (drawable.length === 0) return [MISSING_TEXT, ...footnotes].join("\n");

  // 系列 → 字母;无系列 = 单系列
  const seriesKeys: string[] = [];
  for (const r of drawable) {
    const key = r.series ?? "";
    if (!seriesKeys.includes(key)) seriesKeys.push(key);
  }

  if (seriesKeys.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      drawable.map((r) => ({ key: r.series ? `${r.key} (${r.series})` : r.key, x: r.xDisplay, y: r.y.display })),
      { key: "experiment", x: data.x.label, y: axisLabel(data.y) },
    );
    return [table, ...footnotes].join("\n");
  }

  const markOf = (r: LineData["rows"][number]) => POINT_MARKS[seriesKeys.indexOf(r.series ?? "")];
  const points: PlotPoint[] = drawable.map((r) => ({
    mark: markOf(r),
    x: r.x as number,
    y: r.y.value as number,
  }));
  const lines = seriesKeys.map((key) =>
    drawable
      .filter((r) => (r.series ?? "") === key)
      .map((r) => ({ x: r.x as number, y: r.y.value as number }))
      .sort((a, b) => a.x - b.x),
  );

  const plot = renderCharPlot({
    width: ctx.width,
    points,
    lines: lines.filter((l) => l.length > 1),
    xLabel: data.x.label,
    yLabel: axisLabel(data.y),
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
    invertY: data.y.better === "lower",
  });
  const legend = seriesKeys
    .map((key, i) => `${POINT_MARKS[i]} ${key === "" ? data.y.label : key}`)
    .join("   ");
  return [plot, "", legend, ...footnotes].join("\n");
}

// ───────────────────────── DeltaTable ─────────────────────────

export function deltaText(data: DeltaData): string {
  const header = ["pair", ...data.columns.map((c) => c.label)];
  const rows = data.rows.map((row) => [
    row.key,
    ...data.columns.map((col) => {
      const cell = (row.cells as Record<string, DeltaData["rows"][number]["cells"][string]>)[col.key];
      if (!cell) return MISSING_MARK;
      const a = cell.a.value === null ? MISSING_MARK : cell.a.display;
      const b = cell.b.value === null ? MISSING_MARK : cell.b.display;
      return `${a} → ${b}   ${cell.display}`;
    }),
  ]);
  return renderAlignedRows([header, ...rows]);
}

// ───────────────────────── CaseList ─────────────────────────

export function caseListText(data: CaseListData, ctx: TextContext): string {
  if (data.rows.length === 0) return "No failed or errored attempts";
  const lines: string[] = [];
  for (const row of data.rows) {
    const head = [
      `✗ ${row.eval}`,
      row.experimentId,
      row.verdict,
      formatDurationMs(row.durationMs),
      ...(row.costUSD !== undefined ? [formatUSD(row.costUSD)] : []),
    ].join(" · ");
    lines.push(head);
    if (row.error) {
      lines.push(indentBlock(wrapDisplay(row.error, ctx.width - 4).join("\n"), "    "));
    }
    for (const assertion of row.failedAssertions) {
      const summary = assertion.detail
        ? `${assertion.name} — ${assertion.detail}`
        : `${assertion.name} — score ${assertion.score}`;
      lines.push(indentBlock(wrapDisplay(summary, ctx.width - 4).join("\n"), "    "));
      if (assertion.evidence) {
        lines.push(indentBlock(wrapDisplay(assertion.evidence, ctx.width - 6).join("\n"), "      "));
      }
    }
    lines.push(`    → niceeval show ${row.eval}`);
  }
  if (data.truncated > 0) {
    lines.push("");
    lines.push(`(${data.truncated} more not shown)`);
  }
  return lines.join("\n");
}
