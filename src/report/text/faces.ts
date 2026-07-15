// 官方组件的 text 面:同一份算好的数据,渲染成终端字符(niceeval show 的形态)。
// 输出形态照 docs-site/zh/guides/report-components.mdx 的示例块;与 web 面共守
// 诚实契约:排序随 better、samples < total 角标、缺数据 — 不补 0、截断报剩余。
// 零 react、零 IO、纯同步 —— 这是 text 宿主不需要 react-dom 的那一半。
// chrome 文案(注脚、verdict 词、截断提示)经 ctx.locale 查 locale 字典,
// 默认 en 与历史输出逐字一致;数据(display、键、warnings message)不本地化。

import type {
  AttemptListItem,
  DeltaData,
  EvalListItem,
  ExperimentListItem,
  GroupSummaryData,
  LineData,
  MatrixData,
  MetricColumn,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
} from "../types.ts";
import type { TextContext } from "../tree.ts";
import type { TableColumn, TableRow } from "../primitives.tsx";
import {
  attemptItemReason,
  experimentDisplayName,
  formatDurationMs,
  formatMetricValue,
  formatPlainNumber,
  formatUSD,
  verdictMark,
} from "../format.ts";
import { countText, localeText, resolveMetricLabel, type ReportLocale } from "../locale.ts";
import { indentBlock, padDisplay, stringWidth, textBar, wrapDisplay } from "./layout.ts";
import { renderTableText } from "./table.ts";
import { renderCharPlot, renderCoordinateTable, type PlotPoint } from "./plot.ts";

const MISSING_MARK = "—";

/** 缺数据文案随 locale(en = "no data",与 MISSING_TEXT 一致)。 */
function missingText(locale: ReportLocale): string {
  return localeText(locale, "cell.missing");
}

/** 格子的文本形态:缺数据 —,覆盖不全带 samples/total 角标。 */
export function cellText(cell: { value: number | null; display: string; samples: number; total: number }): string {
  if (cell.value === null) return MISSING_MARK;
  return cell.samples < cell.total ? `${cell.display} ${cell.samples}/${cell.total}` : cell.display;
}

// ───────────────────────── RunOverview ─────────────────────────

export function overviewText(data: OverviewData, ctx: TextContext): string {
  const { totals, snapshots } = data;
  const locale = ctx.locale;
  const runs = new Set(snapshots.map((s) => s.startedAt)).size;
  const latest = snapshots.map((s) => s.startedAt).sort().at(-1);
  const head = [
    countText(locale, "overview.experiments", snapshots.length),
    localeText(locale, "overview.evalsCount", { n: totals.evals }),
    localeText(locale, "overview.attemptsCount", { n: totals.attempts }),
    // 通过率只渲染 computeCell 算好的同一个 MetricCell(cellText 复用缺数据/coverage 角标语义),
    // 不从 passed/failed/errored 现场重算——与 web 面 RunOverview 同一份数据同一种读法。
    `${localeText(locale, "overview.passRate")} ${cellText(totals.passRate)}`,
    countText(locale, "composedFrom", runs),
    ...(latest ? [localeText(locale, "latestRun", { run: latest })] : []),
  ].join(" · ");
  const tallies = [
    `${localeText(locale, "verdict.passed")} ${totals.passed}`,
    `${localeText(locale, "verdict.failed")} ${totals.failed}`,
    `${localeText(locale, "verdict.errored")} ${totals.errored}`,
    `${localeText(locale, "verdict.skipped")} ${totals.skipped}`,
    totals.costUSD === null ? missingText(locale) : formatUSD(totals.costUSD),
    formatDurationMs(totals.durationMs),
  ].join(" · ");
  const lines = [head, tallies];
  for (const warning of data.warnings) lines.push(`! ${warning.message}`);
  return lines.join("\n");
}

// ───────────────────────── GroupSummary ─────────────────────────

/**
 * 一至两行:头行是通过率(GroupSummaryData.passRate.display,不重算比例)+ experiment/eval 数 +
 * failed(+ errored,非零才列,与旧 GroupSelector 卡片一致)+ 总成本;第二行(有则加)是最后运行时间。
 * 不依赖固定网格宽度,窄终端自然换行。
 */
export function groupSummaryText(data: GroupSummaryData, ctx: TextContext): string {
  const locale = ctx.locale;
  const head = [
    `${localeText(locale, "overview.passRate")} ${cellText(data.passRate)}`,
    countText(locale, "overview.experiments", data.experiments),
    localeText(locale, "overview.evalsCount", { n: data.evals }),
    `${localeText(locale, "verdict.failed")} ${data.verdicts.failed}`,
    ...(data.verdicts.errored > 0 ? [`${localeText(locale, "verdict.errored")} ${data.verdicts.errored}`] : []),
    data.totalCostUSD === null ? missingText(locale) : formatUSD(data.totalCostUSD),
  ].join(" · ");
  const lines = [head];
  if (data.lastRunAt) lines.push(localeText(locale, "latestRun", { run: data.lastRunAt }));
  return lines.join("\n");
}

// ───────────────────────── MetricTable ─────────────────────────

/** verdict 计票的紧凑文案("3 passed / 1 failed"):非零判定逐个列,全部为零如实 —。 */
export function verdictTallyText(
  verdicts: NonNullable<NonNullable<TableData["rows"][number]["meta"]>["verdicts"]>,
  locale: ReportLocale,
): string {
  const parts: string[] = [];
  for (const kind of ["passed", "failed", "errored", "skipped"] as const) {
    if (verdicts[kind] > 0) parts.push(`${verdicts[kind]} ${localeText(locale, `verdict.${kind}`)}`);
  }
  return parts.length > 0 ? parts.join(" / ") : MISSING_MARK;
}

export function tableText(data: TableData, ctx: TextContext): string {
  const locale = ctx.locale;
  // meta 在场时补 Model / Agent / Verdicts 列(rows: "experiment" 的榜单 parity);
  // 列序对齐 view 原生榜单:experiment、model、agent、指标列…、verdicts
  const hasMeta = data.rows.some((row) => row.meta !== undefined);
  const hasModel = data.rows.some((row) => row.meta?.model !== undefined);
  const hasVerdicts = data.rows.some((row) => row.meta?.verdicts !== undefined);
  const columns: TableColumn[] = [
    { key: "dimension", header: data.dimension },
    ...(hasMeta && hasModel ? [{ key: "model", header: localeText(locale, "table.model") }] : []),
    ...(hasMeta ? [{ key: "agent", header: localeText(locale, "table.agent") }] : []),
    // 指标列的键用序号,不用 metric name —— 维度名、"model" 这些键都在同一个命名空间里,
    // 指标恰好叫 "agent" 时不能把 meta 列顶掉。
    ...data.columns.map((c, i) => ({ key: `metric${i}`, header: resolveMetricLabel(c.label, locale, c.key) })),
    ...(hasVerdicts ? [{ key: "verdicts", header: localeText(locale, "table.verdicts") }] : []),
  ];
  const rows: TableRow[] = data.rows.map((row) => {
    const cells: Record<string, string | null> = { dimension: row.key };
    if (hasMeta && hasModel) cells.model = row.meta?.model ?? null;
    if (hasMeta) cells.agent = row.meta?.agent ?? null;
    data.columns.forEach((col, i) => {
      const cell = (row.cells as Record<string, TableData["rows"][number]["cells"][string]>)[col.key];
      cells[`metric${i}`] = cell ? cellText(cell) : null;
    });
    if (hasVerdicts) cells.verdicts = row.meta?.verdicts ? verdictTallyText(row.meta.verdicts, locale) : null;
    return { key: row.key, cells };
  });
  const table = renderTableText({ columns, rows, locale }, ctx);

  // rows: "experiment" 专属的行摘要(eval/attempt 数 + 最后运行时间):表格列已经挤满
  // dimension/model/agent/指标/verdicts,这几个数字挤进行键下面单独一行,与 web 面
  // 「行键下的小 sub-line」同一份信息、同一种「不进列」的取舍。
  const metaLines: string[] = [];
  for (const row of data.rows) {
    if (row.meta?.evals === undefined) continue;
    const parts = [localeText(locale, "overview.evalsCount", { n: row.meta.evals })];
    if (row.meta.attempts !== undefined && row.meta.attempts > row.meta.evals) {
      parts.push(localeText(locale, "overview.attemptsCount", { n: row.meta.attempts }));
    }
    if (row.meta.lastRunAt) parts.push(localeText(locale, "latestRun", { run: row.meta.lastRunAt }));
    metaLines.push(`  ${row.key}: ${parts.join(" · ")}`);
  }

  const blocks = [table, ...(metaLines.length > 0 ? [metaLines.join("\n")] : [])];
  return blocks.join("\n\n");
}

// ───────────────────────── MetricMatrix ─────────────────────────

export function matrixText(data: MatrixData, ctx: TextContext): string {
  // 表体全是维度键与 display,没有 chrome 文案;"next:" 是命令提示,不本地化。
  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  const byPosition = new Map<string, MatrixData["cells"][number]["cell"]>();
  for (const entry of data.cells) {
    if (!rowKeys.includes(entry.row)) rowKeys.push(entry.row);
    if (!columnKeys.includes(entry.column)) columnKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }
  const columns: TableColumn[] = [
    { key: "dimension", header: data.rows },
    ...columnKeys.map((column, i) => ({ key: `column${i}`, header: column })),
  ];
  const rows: TableRow[] = rowKeys.map((row) => {
    const cells: Record<string, string | null> = { dimension: row };
    columnKeys.forEach((column, i) => {
      const cell = byPosition.get(JSON.stringify([row, column]));
      cells[`column${i}`] = cell ? cellText(cell) : null; // 稀疏格子在文本里以 — 呈现,不编数
    });
    return { key: row, cells };
  });
  const table = renderTableText({ columns, rows, locale: ctx.locale }, ctx);

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

export function scoreboardText(data: ScoreboardData, ctx: TextContext): string {
  const locale = ctx.locale;
  const subjectKeys: string[] = [];
  for (const row of data.rows) {
    for (const subject of row.subjects) {
      if (!subjectKeys.includes(subject.key)) subjectKeys.push(subject.key);
    }
  }
  const columns: TableColumn[] = [
    { key: "dimension", header: data.dimension },
    { key: "total", header: localeText(locale, "scoreboard.totalText") },
    ...subjectKeys.map((key, i) => ({ key: `subject${i}`, header: key })),
  ];
  const rows: TableRow[] = data.rows.map((row) => {
    const cells: Record<string, string | null> = {
      dimension: row.key,
      total: `${row.total.display}/${data.fullMarks}`,
    };
    subjectKeys.forEach((key, i) => {
      const subject = row.subjects.find((s) => s.key === key);
      if (!subject) {
        cells[`subject${i}`] = null;
        return;
      }
      const score = `${formatPlainNumber(subject.earned)}/${formatPlainNumber(subject.possible)}`;
      cells[`subject${i}`] =
        subject.missing > 0
          ? `${score} ${localeText(locale, "scoreboard.missingText", { n: subject.missing })}`
          : score;
    });
    return { key: row.key, cells };
  });
  const table = renderTableText({ columns, rows, locale }, ctx);
  if (data.weights.length === 0) return table;
  // 实际生效的权重表 —— 成绩单可审计
  const weights = data.weights.map((w) => `${w.prefix} ×${w.weight}`).join(" · ");
  return `${table}\n${localeText(locale, "scoreboard.weights")} ${weights} · ${localeText(locale, "scoreboard.othersWeight")}`;
}

// ───────────────────────── MetricScatter ─────────────────────────

const POINT_MARKS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function axisLabel(col: MetricColumn, locale: ReportLocale): string {
  return resolveMetricLabel(col.label, locale, col.key);
}

export function scatterText(data: ScatterData, ctx: TextContext): string {
  const locale = ctx.locale;
  const drawable = data.rows.filter((r) => r.x.value !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(countText(locale, "pointsMissing", missing));

  const axes = { x: axisLabel(data.x, locale), y: axisLabel(data.y, locale) };
  // 0 个可画点:x/y 指标没有可用数据(与 web 面同一事实)。
  if (drawable.length === 0) {
    return [localeText(locale, "scatter.noData", axes), ...footnotes].join("\n");
  }
  // 点太密排不下时降级为坐标表,不硬挤
  if (drawable.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      drawable.map((r) => ({ key: r.key, x: r.x.display, y: r.y.display })),
      { key: data.points, x: axisLabel(data.x, locale), y: axisLabel(data.y, locale) },
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
    xLabel: `${axisLabel(data.x, locale)}${invertX ? ` ${localeText(locale, "scatter.axisReversed")}` : ""}`,
    yLabel: axisLabel(data.y, locale),
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
    invertX,
    invertY: data.y.better === "lower",
  });
  const legend = drawable.map((r, i) => `${POINT_MARKS[i]} ${r.key}`).join("   ");
  return [plot, "", localeText(locale, "scatter.betterUpperRight"), legend, ...footnotes].join("\n");
}

// ───────────────────────── MetricLine ─────────────────────────

export function lineText(data: LineData, ctx: TextContext): string {
  const locale = ctx.locale;
  const drawable = data.rows.filter((r) => r.x !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(countText(locale, "pointsMissing", missing));

  if (drawable.length === 0) return [missingText(locale), ...footnotes].join("\n");

  // 系列 → 字母;无系列 = 单系列
  const seriesKeys: string[] = [];
  for (const r of drawable) {
    const key = r.series ?? "";
    if (!seriesKeys.includes(key)) seriesKeys.push(key);
  }

  if (seriesKeys.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      drawable.map((r) => ({ key: r.series ? `${r.key} (${r.series})` : r.key, x: r.xDisplay, y: r.y.display })),
      { key: "experiment", x: data.x.label, y: axisLabel(data.y, locale) },
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
    yLabel: axisLabel(data.y, locale),
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
    invertY: data.y.better === "lower",
  });
  const legend = seriesKeys
    .map((key, i) => `${POINT_MARKS[i]} ${key === "" ? axisLabel(data.y, locale) : key}`)
    .join("   ");
  return [plot, "", legend, ...footnotes].join("\n");
}

// ───────────────────────── DeltaTable ─────────────────────────

export function deltaText(data: DeltaData, ctx: TextContext): string {
  const columns: TableColumn[] = [
    { key: "pair", header: "pair" },
    ...data.columns.map((c, i) => ({ key: `metric${i}`, header: resolveMetricLabel(c.label, ctx.locale, c.key) })),
  ];
  const rows: TableRow[] = data.rows.map((row) => {
    const cells: Record<string, string | null> = { pair: row.key };
    data.columns.forEach((col, i) => {
      const cell = (row.cells as Record<string, DeltaData["rows"][number]["cells"][string]>)[col.key];
      if (!cell) {
        cells[`metric${i}`] = null;
        return;
      }
      const a = cell.a.value === null ? MISSING_MARK : cell.a.display;
      const b = cell.b.value === null ? MISSING_MARK : cell.b.display;
      cells[`metric${i}`] = `${a} → ${b}   ${cell.display}`;
    });
    return { key: row.key, cells };
  });
  return renderTableText({ columns, rows, locale: ctx.locale }, ctx);
}

// ───────────────────────── 实体列表(ExperimentList / EvalList / AttemptList)─────────────────────────
//
// 三面共用的紧凑标记:`locator✓`(判定符紧跟 locator,中间不留空格)。
// ExperimentList / EvalList 逐 attempt 只列这一个标记 + 各自的原因/耗时摘要,不重复整段
// niceeval show 命令;要看某个 attempt 的完整证据,agent 自己拼 `niceeval show <locator>`——
// 比较列表都不内联完整断言或命令模板。

function locatorBadge(item: { locator: string; verdict: AttemptListItem["verdict"] }): string {
  return `${item.locator}${verdictMark(item.verdict)}`;
}

// ── ExperimentList ──

function experimentSummaryTable(items: ExperimentListItem[], ctx: TextContext, relativeTo?: string): string {
  const locale = ctx.locale;
  const compact = ctx.width < 100;
  const columns: TableColumn[] = [
    { key: "experiment", header: compact && locale === "en" ? "Exp." : localeText(locale, "experimentList.experiment") },
    { key: "model", header: localeText(locale, "table.model") },
    { key: "agent", header: localeText(locale, "table.agent") },
    { key: "duration", header: compact && locale === "en" ? "Avg" : localeText(locale, "experimentList.avgDuration"), align: "right" },
    { key: "passRate", header: compact && locale === "en" ? "Pass" : localeText(locale, "experimentList.passRate"), align: "right" },
    { key: "result", header: localeText(locale, "experimentList.result") },
    { key: "tokens", header: localeText(locale, "experimentList.tokens"), align: "right" },
    { key: "cost", header: compact && locale === "en" ? "Cost" : localeText(locale, "experimentList.estimatedCost"), align: "right" },
  ];
  const rows: TableRow[] = items.map((item) => ({
    key: item.experimentId,
    cells: {
      experiment: experimentDisplayName(item.experimentId, relativeTo),
      model: item.model ?? localeText(locale, "experimentList.defaultModel"),
      agent: item.agent,
      duration: cellText(item.duration),
      passRate: cellText(item.passRate),
      result: verdictTallyText(item.verdicts, locale),
      tokens: cellText(item.tokens),
      cost: cellText(item.cost),
    },
  }));
  const metadata = items.flatMap((item) =>
    wrapDisplay(
      `${experimentDisplayName(item.experimentId, relativeTo)}: ${localeText(locale, "overview.evalsCount", { n: item.evals })} · ${localeText(locale, "overview.attemptsCount", { n: item.attempts })} · ${item.lastRunAt}`,
      Math.max(8, ctx.width - 2),
    ).map((line) => `  ${line}`),
  );
  return [renderTableText({ columns, rows, locale }, ctx), metadata.join("\n")].join("\n");
}

function experimentDetailTable(item: ExperimentListItem, ctx: TextContext, relativeTo?: string): string {
  const locale = ctx.locale;
  const columns: TableColumn[] = [
    { key: "status", header: localeText(locale, "experimentList.status") },
    { key: "entity", header: localeText(locale, "experimentList.evalAttempt") },
    // Result 是可扫读的失败预览,不是证据面:两行放不下的以 … 收口,完整值走 locator 下钻。
    { key: "result", header: localeText(locale, "experimentList.result"), maxLines: 2 },
    { key: "duration", header: localeText(locale, "experimentList.duration"), align: "right" },
    { key: "cost", header: localeText(locale, "experimentList.cost"), align: "right" },
  ];
  // Result 的字符预算 ≈ 两行 × 它能分到的列宽(总宽减其它列的自然宽与列距)。这里只做
  // 优先级让位(标题先截、received 最后截)的粗预算;精确的按宽度收口由列的 maxLines 兜底。
  const statusWidth = Math.max(
    stringWidth(localeText(locale, "experimentList.status")),
    ...item.evalRows.map((row) => stringWidth(`${verdictMark(row.verdict)} ${localeText(locale, `verdict.${row.verdict}`)}`)),
  );
  const entityWidth = Math.max(
    stringWidth(localeText(locale, "experimentList.evalAttempt")),
    ...item.evalRows.flatMap((row) => [stringWidth(row.evalId), ...row.attempts.map((a) => stringWidth(a.locator) + 3)]),
  );
  const fixedWidth = statusWidth + entityWidth + 8 /* duration */ + 6 /* cost */ + 3 * 4; /* 4 段列距 */
  const resultBudget = Math.max(24, (ctx.width - fixedWidth) * 2);
  const rows: TableRow[] = item.evalRows.flatMap((row) => {
    const parent: TableRow = {
      key: row.evalId,
      cells: {
        status: `${verdictMark(row.verdict)} ${localeText(locale, `verdict.${row.verdict}`)}`,
        entity: row.evalId,
        result: "",
        duration: "",
        cost: "",
      },
    };
    const attempts: TableRow[] = row.attempts.map((attempt, index) => ({
      key: attempt.locator,
      cells: {
        status: `  ${verdictMark(attempt.verdict)}`,
        entity: `${index === row.attempts.length - 1 ? "└─" : "├─"} ${attempt.locator}`,
        result: attemptItemReason(attempt, resultBudget) ?? MISSING_MARK,
        duration: attempt.verdict === "skipped" && attempt.durationMs === 0 ? null : formatDurationMs(attempt.durationMs),
        cost: attempt.costUSD === undefined ? null : formatUSD(attempt.costUSD),
      },
    }));
    return [parent, ...attempts];
  });
  const flags = item.flags && Object.keys(item.flags).length > 0
    ? `${localeText(locale, "experimentList.flags")} ${Object.entries(item.flags).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}`
    : undefined;
  return [experimentDisplayName(item.experimentId, relativeTo), flags, renderTableText({ columns, rows, locale }, ctx)]
    .filter(Boolean)
    .join("\n");
}

export function experimentListText(items: ExperimentListItem[], ctx: TextContext, relativeTo?: string): string {
  if (items.length === 0) return localeText(ctx.locale, "attemptList.empty");
  return [
    experimentSummaryTable(items, ctx, relativeTo),
    ...items.map((item) => experimentDetailTable(item, ctx, relativeTo)),
  ].join("\n\n");
}

// ── EvalList ──

function evalListAttemptLine(item: AttemptListItem, ctx: TextContext): string {
  // 行式列表同守「Result 最多两行」:预算 = 两行终端宽,超出由 fit 投影按优先级让位。
  const reason = attemptItemReason(item, Math.max(24, ctx.width * 2 - stringWidth(locatorBadge(item)) - 6));
  return `  ${locatorBadge(item)}${reason ? ` · ${reason}` : ""}`;
}

export function evalListText(items: EvalListItem[], ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => {
    const identity = `${item.evalId} · ${item.experimentId} · ${localeText(locale, `verdict.${item.verdict}`)}`;
    const summary = [
      localeText(locale, "attemptList.score", { score: cellText(item.score) }),
      localeText(locale, "overview.attemptsCount", { n: item.attempts.length }),
      `${formatDurationMs(item.duration.value ?? 0)} avg`,
      item.cost.value === null ? `${missingText(locale)} avg` : `${formatUSD(item.cost.value)} avg`,
    ].join(" · ");
    const attemptLines = item.attempts.map((attempt) => evalListAttemptLine(attempt, ctx));
    return [identity, `  ${summary}`, ...attemptLines].join("\n");
  });
  return blocks.join("\n\n");
}

// ── AttemptList ──

/** Attempt 比较卡片：只显示一条主失败摘要（至多两行终端宽）；完整 assertions 走 locator 下钻。 */
function attemptListItemText(item: AttemptListItem, ctx: TextContext): string {
  const head = [
    `${verdictMark(item.verdict)} ${item.locator}`,
    item.evalId,
    item.experimentId,
    formatDurationMs(item.durationMs),
    ...(item.costUSD !== undefined ? [formatUSD(item.costUSD)] : []),
  ].join(" · ");
  const lines = [head];
  const reason = attemptItemReason(item, Math.max(24, ctx.width * 2 - 4));
  if (reason) lines.push(`  ${reason}`);
  return lines.join("\n");
}

export function attemptListText(items: AttemptListItem[], total: number | undefined, ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => attemptListItemText(item, ctx));
  const remaining = (total ?? items.length) - items.length;
  if (remaining > 0) blocks.push(localeText(locale, "attemptList.truncatedText", { n: remaining }));
  return blocks.join("\n\n");
}
