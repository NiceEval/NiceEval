// 官方组件的 text 面:同一份算好的数据,渲染成终端字符(niceeval show 的形态)。
// 与 web 面共守诚实契约:排序随 better、samples < total 角标、缺数据 — 不补 0、截断报剩余。
// 零 react、零 IO、纯同步 —— 这是 text 宿主不需要 react-dom 的那一半。
// chrome 文案(注脚、verdict 词、截断提示)经 ctx.locale 查 locale 字典;
// 数据 display 是 LocalizedText,按 LocalizedText 回退规则取值。

import type {
  AttemptListItem,
  DeltaData,
  EvalListItem,
  ExperimentComparisonData,
  ExperimentListItem,
  HeroData,
  LineData,
  MatrixData,
  MetricCell,
  MetricColumn,
  ScatterData,
  ScopeSummaryData,
  ScopeWarning,
  ScoreboardData,
  TableData,
  TraceWaterfallRow,
  VerdictTally,
} from "../types.ts";
import type { LocalizedText } from "../locale.ts";
import { groupScopeWarnings } from "../scope-warnings.ts";
import type { TextContext } from "../tree.ts";
import type { TableColumn, TableRow } from "../primitives.tsx";
import {
  experimentDisplayName,
  fitFailureSummary,
  formatDurationMs,
  formatMetricValue,
  formatPlainNumber,
  formatReportDateTime,
  formatReportDateTimeRange,
  formatUSD,
  verdictMark,
} from "../format.ts";
import {
  countText,
  localeText,
  resolveLocalizedText,
  resolveMetricLabel,
  type ReportLocale,
} from "../locale.ts";
import { indentBlock, padDisplay, stringWidth, textBar, wrapDisplay } from "./layout.ts";
import { renderTableText } from "./table.ts";
import { renderCharPlot, renderCoordinateTable, type PlotPoint } from "./plot.ts";

const MISSING_MARK = "—";

/** 缺数据文案随 locale(en = "no data")。 */
function missingText(locale: ReportLocale): string {
  return localeText(locale, "cell.missing");
}

/** 格子的文本形态:缺数据 —,覆盖不全带 samples/total 角标;display 按 locale 解析。 */
export function cellText(cell: MetricCell, locale: ReportLocale): string {
  if (cell.value === null) return MISSING_MARK;
  const display = resolveLocalizedText(cell.display, locale);
  return cell.samples < cell.total ? `${display} ${cell.samples}/${cell.total}` : display;
}

/** verdict 计票的紧凑文案("3 passed · 1 failed"):非零判定逐个列,全部为零如实 —。 */
export function verdictTallyText(tally: VerdictTally, locale: ReportLocale): string {
  const parts: string[] = [];
  for (const kind of ["passed", "failed", "errored", "skipped"] as const) {
    if (tally[kind] > 0) parts.push(`${tally[kind]} ${localeText(locale, `verdict.${kind}`)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : MISSING_MARK;
}

/** ISO 时间 → "YYYY-MM-DD HH:mm"(本地时区);不可解析原样返回。 */
function formatDateTimeMinute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ───────────────────────── ScopeSummary ─────────────────────────

/**
 * 一至两行:头行是端到端通过率(官方 MetricCell,不重算)+ experiment/eval/attempt 数 +
 * `votes` 选中的那级计票 + 总成本;第二行(有则加)是快照时间窗。
 */
export function scopeSummaryText(data: ScopeSummaryData, votes: "eval" | "attempt", ctx: TextContext): string {
  const locale = ctx.locale;
  const tally = votes === "attempt" ? data.attemptVerdicts : data.evalVerdicts;
  const head = [
    `${localeText(locale, "scopeSummary.passRate")} ${cellText(data.endToEndPassRate, locale)}`,
    countText(locale, "overview.experiments", data.experiments),
    localeText(locale, "overview.evalsCount", { n: data.evals }),
    localeText(locale, "overview.attemptsCount", { n: data.attempts }),
    verdictTallyText(tally, locale),
    `${localeText(locale, "scopeSummary.totalCost")} ${
      data.totalCostUSD.value === null ? MISSING_MARK : resolveLocalizedText(data.totalCostUSD.display, locale)
    }${
      data.totalCostUSD.samples < data.totalCostUSD.total
        ? ` (${localeText(locale, "scopeSummary.costCoverage", {
            samples: data.totalCostUSD.samples,
            total: data.totalCostUSD.total,
          })})`
        : ""
    }`,
  ].join(" · ");
  const lines = [head];
  if (data.range.latestStartedAt !== null) {
    const from = data.range.earliestStartedAt;
    const to = data.range.latestStartedAt;
    lines.push(
      from !== null && from !== to
        ? localeText(locale, "scopeSummary.runRange", formatReportDateTimeRange(from, to, locale))
        : localeText(locale, "scopeSummary.lastRun", { time: formatReportDateTime(to, locale) }),
    );
  }
  return lines.join("\n");
}

// ───────────────────────── ExperimentComparison ─────────────────────────

/**
 * text 面:对完整 Scope 依次输出 summary、散点与实验列表——不同深度目录的 experiments
 * 一律同屏,不再有组索引或 `niceeval exp <group>` 命令提示。
 */
export function experimentComparisonText(
  data: ExperimentComparisonData,
  _className: string | undefined,
  ctx: TextContext,
  connect?: boolean,
): string {
  const locale = ctx.locale;
  if (data.experiments.length === 0) return localeText(locale, "experimentComparison.empty");
  // connect 缺省跟随缺省 series 解析:series 为 "line" 时连线,agent 不连。
  const connectOn = connect ?? data.scatter.seriesDimension === "line";
  // scopeSummaryText 产出不折行的单行头;窄终端下按显示宽度折行,不截断内容。
  const summary = scopeSummaryText(data.summary, "eval", ctx)
    .split("\n")
    .flatMap((line) => wrapDisplay(line, ctx.width))
    .join("\n");
  return [
    summary,
    scatterText(data.scatter, ctx, { connect: connectOn }),
    experimentListText(data.experiments, ctx),
  ]
    .filter((block) => block.length > 0)
    .join("\n\n");
}

// ───────────────────────── MetricTable ─────────────────────────

export function tableText(data: TableData, ctx: TextContext): string {
  const locale = ctx.locale;
  const columns: TableColumn[] = [
    { key: "dimension", header: data.rowDimension },
    // 指标列的键用序号,不用 metric name —— 维度名和指标名在同一个命名空间里,可能撞键。
    ...data.columns.map((c, i) => ({ key: `metric${i}`, header: resolveMetricLabel(c.label, locale, c.key) })),
  ];
  const rows: TableRow[] = data.rows.map((row) => {
    const cells: Record<string, string | null> = { dimension: row.key };
    data.columns.forEach((col, i) => {
      const cell = row.cells[col.key];
      cells[`metric${i}`] = cell ? cellText(cell, locale) : null;
    });
    return { key: row.key, cells };
  });
  return renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx);
}

// ───────────────────────── MetricMatrix ─────────────────────────

export function matrixText(data: MatrixData, ctx: TextContext): string {
  // 表体全是维度键与 display,没有 chrome 文案;"next:" 是命令提示,不本地化。
  const locale = ctx.locale;
  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  const byPosition = new Map<string, MetricCell>();
  for (const entry of data.cells) {
    if (!rowKeys.includes(entry.row)) rowKeys.push(entry.row);
    if (!columnKeys.includes(entry.column)) columnKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }
  const columns: TableColumn[] = [
    { key: "dimension", header: data.rowDimension },
    ...columnKeys.map((column, i) => ({ key: `column${i}`, header: column })),
  ];
  const rows: TableRow[] = rowKeys.map((row) => {
    const cells: Record<string, string | null> = { dimension: row };
    columnKeys.forEach((column, i) => {
      const cell = byPosition.get(JSON.stringify([row, column]));
      cells[`column${i}`] = cell ? cellText(cell, locale) : null; // 稀疏格子在文本里以 — 呈现,不编数
    });
    return { key: row, cells };
  });
  const table = renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx);

  // 下钻命令:行维度是 eval 时,指向最值得看的一行(先挑有缺格的,再挑按 better 最差的)
  if (data.rowDimension !== "eval" || rowKeys.length === 0) return table;
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

export function barsText(data: MatrixData, ctx: TextContext): string {
  const locale = ctx.locale;
  const groupKeys: string[] = [];
  const seriesKeys: string[] = [];
  const byPosition = new Map<string, MetricCell>();
  for (const entry of data.cells) {
    if (!groupKeys.includes(entry.row)) groupKeys.push(entry.row);
    if (!seriesKeys.includes(entry.column)) seriesKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }
  const better = data.metric.better ?? "higher";
  // 条长刻度:% 的天然域是 [0,1],其余以全图最大值为满条
  const values = data.cells.map((c) => c.cell.value).filter((v): v is number => v !== null);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const ratioOf = (value: number) => (data.metric.unit === "%" ? value : maxValue === 0 ? 0 : value / maxValue);

  const seriesWidth = Math.max(...seriesKeys.map((k) => stringWidth(k)), 0);
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
      lines.push(`  ${label}   ${textBar(ratioOf(cell.value), BAR_WIDTH)}  ${cellText(cell, locale)}`);
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
    { key: "dimension", header: data.rowDimension },
    { key: "total", header: localeText(locale, "scoreboard.totalText") },
    ...subjectKeys.map((key, i) => ({ key: `subject${i}`, header: key })),
  ];
  const rows: TableRow[] = data.rows.map((row) => {
    const totalNotes = [
      ...(row.total.notRun > 0 ? [localeText(locale, "scoreboard.notRunText", { n: row.total.notRun })] : []),
      ...(row.total.unscorable > 0 ? [localeText(locale, "scoreboard.unscorableText", { n: row.total.unscorable })] : []),
    ];
    const cells: Record<string, string | null> = {
      dimension: row.key,
      total: `${resolveLocalizedText(row.total.display, locale)}/${data.fullMarks}${totalNotes.length > 0 ? ` ${totalNotes.join(" ")}` : ""}`,
    };
    subjectKeys.forEach((key, i) => {
      const subject = row.subjects.find((s) => s.key === key);
      if (!subject) {
        cells[`subject${i}`] = null;
        return;
      }
      const score = `${formatPlainNumber(subject.earned)}/${formatPlainNumber(subject.possible)}`;
      const notes = [
        ...(subject.notRun > 0 ? [localeText(locale, "scoreboard.notRunText", { n: subject.notRun })] : []),
        ...(subject.unscorable > 0 ? [localeText(locale, "scoreboard.unscorableText", { n: subject.unscorable })] : []),
      ];
      cells[`subject${i}`] = notes.length > 0 ? `${score} ${notes.join(" ")}` : score;
    });
    return { key: row.key, cells };
  });
  const table = renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx);
  const footnotes: string[] = [];
  if (data.weights.length > 0) {
    const weights = data.weights.map((w) => `${w.prefix} ×${w.weight}`).join(" · ");
    footnotes.push(`${localeText(locale, "scoreboard.weights")} ${weights} · ${localeText(locale, "scoreboard.othersWeight")}`);
  }
  if (data.ignoredEvals > 0) footnotes.push(countText(locale, "scoreboard.ignored", data.ignoredEvals));
  return footnotes.length > 0 ? `${table}\n${footnotes.join("\n")}` : table;
}

// ───────────────────────── MetricScatter ─────────────────────────

const POINT_MARKS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function axisLabel(col: MetricColumn, locale: ReportLocale): string {
  return resolveMetricLabel(col.label, locale, col.key);
}

/**
 * 方向提示:轴向已随 better 反正(lower 反向),「更好」恒指向右上,文案恒为
 * 「越靠右上越好」;仅当 x、y 都声明 better 时显示——任一轴未声明,组件不猜
 * 「更好」朝哪边,整图无提示(返回 undefined)。
 */
function betterCornerText(x: MetricColumn, y: MetricColumn, locale: ReportLocale): string | undefined {
  if (x.better === undefined || y.better === undefined) return undefined;
  return localeText(locale, "scatter.betterUpperRight");
}

/** 轴标题行:"<x label>(越低越好) × <y label>"——better 方向如实标注,不虚构轴向。 */
function scatterHeading(data: ScatterData, locale: ReportLocale): string {
  const withBetter = (col: MetricColumn) => {
    const label = axisLabel(col, locale);
    if (col.better === undefined) return label;
    return `${label}(${localeText(locale, col.better === "lower" ? "table.lowerBetter" : "table.higherBetter")})`;
  };
  return `${withBetter(data.x)} × ${withBetter(data.y)}`;
}

export interface ScatterTextOptions {
  /** series 内按 x 升序成线:坐标图内不画折线,图例以 ` → ` 串联并给逐段位移摘要。 */
  connect?: boolean;
}

/** 位移摘要里的带符号差值;`%` 的差是百分点,单位写 pt(docs/feature/reports/show/default-report.md)。 */
function signedDelta(value: number, unit?: string): string {
  const text = formatMetricValue(value, unit);
  const signed = value >= 0 ? `+${text}` : text;
  return unit === "%" ? signed.replace("%", "pt") : signed;
}

export function scatterText(data: ScatterData, ctx: TextContext, opts?: ScatterTextOptions): string {
  const locale = ctx.locale;
  const connect = opts?.connect === true && data.seriesDimension !== undefined;
  const drawable = data.rows.filter((r) => r.x.value !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(countText(locale, "pointsMissing", missing));

  const axes = { x: axisLabel(data.x, locale), y: axisLabel(data.y, locale) };
  // 0 个可画点:x/y 指标没有可用数据(与 web 面同一事实)。
  if (drawable.length === 0) {
    return [localeText(locale, "scatter.noData", axes), ...footnotes].join("\n");
  }
  // 标题行尾标注归类维度(· 按 <series> 归类)。
  const heading =
    data.seriesDimension !== undefined
      ? `${scatterHeading(data, locale)} · ${localeText(locale, "scatter.groupedBy", { dim: data.seriesDimension })}`
      : scatterHeading(data, locale);

  // 标记分配顺序即图例顺序:series 按显示键字典序、series 内按 x 原始值升序;
  // 无 series 时保持点键字典序(rows 本身已按维度 key 排序)。
  const ordered =
    data.seriesDimension === undefined
      ? drawable
      : [...drawable].sort((a, b) => {
          const sa = a.series ?? "";
          const sb = b.series ?? "";
          if (sa !== sb) return sa < sb ? -1 : 1;
          return (a.x.value as number) - (b.x.value as number);
        });

  // 点太密排不下时降级为坐标表,不硬挤
  if (ordered.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      ordered.map((r) => ({
        key: r.key,
        x: resolveLocalizedText(r.x.display, locale),
        y: resolveLocalizedText(r.y.display, locale),
      })),
      { key: data.pointDimension, x: axes.x, y: axes.y },
    );
    return [heading, "", table, ...footnotes].join("\n");
  }

  const points: PlotPoint[] = ordered.map((r, i) => ({
    mark: POINT_MARKS[i],
    x: r.x.value as number,
    y: r.y.value as number,
  }));
  // series 分组(ordered 已按 series、x 排好序);connect 的折线只进 web 面,
  // text 面用图例的 → 串联 + 位移摘要表达同一条线,坐标图内不画折线。
  const rowsBySeries = new Map<string, typeof ordered>();
  for (const r of ordered) {
    if (r.series === undefined) continue;
    const list = rowsBySeries.get(r.series) ?? [];
    list.push(r);
    rowsBySeries.set(r.series, list);
  }

  const plot = renderCharPlot({
    width: ctx.width,
    points,
    lines: [],
    xLabel: axes.x,
    yLabel: axes.y,
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
    // 轴方向跟随 better(与 web 面同规则):lower 反向,higher 与未声明正向。
    invertX: data.x.better === "lower",
    invertY: data.y.better === "lower",
  });

  const markByKey = new Map(ordered.map((r, i) => [r.key, POINT_MARKS[i]]));
  let legend: string;
  if (data.seriesDimension === undefined) {
    legend = ordered.map((r) => `${markByKey.get(r.key)} ${r.key}`).join("   ");
  } else {
    // 图例一行一个 series:行首 series 显示键,后接线上各点;connect 用 → 串联并给逐段位移摘要。
    const seriesWidth = Math.max(...[...rowsBySeries.keys()].map(stringWidth));
    const lines: string[] = [];
    for (const [series, list] of rowsBySeries) {
      const parts = list.map((r) => `${markByKey.get(r.key)} ${r.key}`);
      lines.push(`${padDisplay(series, seriesWidth)}  ${parts.join(connect ? " → " : "   ")}`);
      if (connect) {
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1];
          const b = list[i];
          const dy = signedDelta((b.y.value as number) - (a.y.value as number), data.y.unit);
          const dx = signedDelta((b.x.value as number) - (a.x.value as number), data.x.unit);
          lines.push(`${" ".repeat(seriesWidth + 2)}└ ${axes.y} ${dy} · ${axes.x} ${dx}`);
        }
      }
    }
    legend = lines.join("\n");
  }
  const hint = betterCornerText(data.x, data.y, locale);
  return [heading, plot, "", ...(hint !== undefined ? [hint] : []), legend, ...footnotes].join("\n");
}

// ───────────────────────── MetricLine ─────────────────────────

export function lineText(data: LineData, ctx: TextContext): string {
  const locale = ctx.locale;
  const drawable = data.rows.filter((r) => r.x !== null && r.y.value !== null);
  const missing = data.rows.length - drawable.length;
  const footnotes: string[] = [];
  if (missing > 0) footnotes.push(countText(locale, "pointsMissing", missing));

  if (drawable.length === 0) return [missingText(locale), ...footnotes].join("\n");

  const xLabel = resolveMetricLabel(data.x.label, locale, data.x.key);

  // 系列 → 字母;无系列 = 单系列
  const seriesKeys: string[] = [];
  for (const r of drawable) {
    const key = r.series ?? "";
    if (!seriesKeys.includes(key)) seriesKeys.push(key);
  }

  if (seriesKeys.length > POINT_MARKS.length || ctx.width < 44) {
    const table = renderCoordinateTable(
      drawable.map((r) => ({
        key: r.series !== undefined ? `${r.series} (${r.key})` : r.key,
        x: resolveLocalizedText(r.xDisplay, locale),
        y: resolveLocalizedText(r.y.display, locale),
      })),
      { key: data.seriesDimension ?? xLabel, x: xLabel, y: axisLabel(data.y, locale) },
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
    xLabel,
    yLabel: axisLabel(data.y, locale),
    formatX: (v) => formatMetricValue(v, data.x.unit),
    formatY: (v) => formatMetricValue(v, data.y.unit),
  });
  const legend = seriesKeys
    .map((key, i) => `${POINT_MARKS[i]} ${key === "" ? axisLabel(data.y, locale) : key}`)
    .join("   ");
  return [plot, "", legend, ...footnotes].join("\n");
}

// ───────────────────────── DeltaTable ─────────────────────────

export function deltaText(data: DeltaData, ctx: TextContext): string {
  const locale = ctx.locale;
  // 0 对不是错误:明确空态并报告配对域实验数(派生形态携带;字面形态缺省按 0)。
  if (data.rows.length === 0) {
    return localeText(locale, "delta.empty", { experiments: data.experiments ?? 0 });
  }
  const columns: TableColumn[] = [
    { key: "pair", header: localeText(locale, "delta.pairHeader") },
    ...data.columns.map((c, i) => ({ key: `metric${i}`, header: resolveMetricLabel(c.label, locale, c.key) })),
  ];
  const rows: TableRow[] = data.rows.map((row) => {
    const cells: Record<string, string | null> = { pair: resolveLocalizedText(row.label, locale) };
    data.columns.forEach((col, i) => {
      const cell = row.cells[col.key];
      if (!cell) {
        cells[`metric${i}`] = null;
        return;
      }
      const a = cell.a.value === null ? MISSING_MARK : resolveLocalizedText(cell.a.display, locale);
      const b = cell.b.value === null ? MISSING_MARK : resolveLocalizedText(cell.b.display, locale);
      cells[`metric${i}`] = `${a} → ${b}   ${resolveLocalizedText(cell.display, locale)}`;
    });
    return { key: row.key, cells };
  });
  return renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx);
}

// ───────────────────────── 实体列表(ExperimentList / EvalList / AttemptList)─────────────────────────
//
// 三面共用的紧凑标记:`locator✓`(判定符紧跟 locator,中间不留空格)。
// ExperimentList / EvalList 逐 attempt 只列这一个标记 + 各自的摘要,不重复整段
// niceeval show 命令;要看某个 attempt 的完整证据,agent 自己拼 `niceeval show <locator>`。

function locatorBadge(item: { locator: string; verdict: AttemptListItem["verdict"] }): string {
  return `${item.locator}${verdictMark(item.verdict)}`;
}

/**
 * failureSummary + moreFailures 的展示形态:摘要在计算侧已按 Scoring display 契约折好,
 * 这里只加 "+N more failures" 计数与宽度收口,不重算摘要。
 */
function attemptReasonText(item: AttemptListItem, locale: ReportLocale, maxChars: number): string | undefined {
  if (item.failureSummary === null) return undefined;
  const withMore =
    item.moreFailures > 0
      ? `${item.failureSummary} · ${countText(locale, "entityList.moreFailures", item.moreFailures)}`
      : item.failureSummary;
  return fitFailureSummary(withMore, Math.max(24, maxChars));
}

// ── ExperimentList ──

function experimentSummaryTable(
  items: readonly ExperimentListItem[],
  ctx: TextContext,
  relativeTo?: string,
): string {
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
    { key: "cost", header: localeText(locale, "experimentList.cost"), align: "right" },
  ];
  const rows: TableRow[] = items.map((item) => ({
    key: item.experimentId,
    cells: {
      experiment: experimentDisplayName(item.experimentId, relativeTo),
      model: item.model ?? localeText(locale, "experimentList.defaultModel"),
      agent: item.agent,
      duration: cellText(item.durationMs, locale),
      passRate: cellText(item.endToEndPassRate, locale),
      result: verdictTallyText(item.evalVerdicts, locale),
      tokens: cellText(item.tokens, locale),
      cost: cellText(item.costUSD, locale),
    },
  }));
  const metadata = items.flatMap((item) =>
    wrapDisplay(
      `${experimentDisplayName(item.experimentId, relativeTo)}: ${localeText(locale, "overview.evalsCount", { n: item.evals })} · ${localeText(locale, "overview.attemptsCount", { n: item.attempts })} · ${item.lastRunAt}`,
      Math.max(8, ctx.width - 2),
    ).map((line) => `  ${line}`),
  );
  return [renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx), metadata.join("\n")].join("\n");
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
  // 粗预算;精确的按宽度收口由列的 maxLines 兜底。
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
    // Eval 父行只承载折叠判定与题级聚合;失败摘要只在 Attempt 子行出现。
    const parent: TableRow = {
      key: row.evalId,
      cells: {
        status: `${verdictMark(row.verdict)} ${localeText(locale, `verdict.${row.verdict}`)}`,
        entity: row.evalId,
        result: "",
        duration: localeText(locale, "entityList.average", { value: cellText(row.durationMs, locale) }),
        cost: localeText(locale, "entityList.average", { value: cellText(row.costUSD, locale) }),
      },
    };
    const attempts: TableRow[] = row.attempts.map((attempt, index) => ({
      key: attempt.locator,
      cells: {
        status: `  ${verdictMark(attempt.verdict)}`,
        entity: `${index === row.attempts.length - 1 ? "└─" : "├─"} ${attempt.locator}`,
        result: attemptReasonText(attempt, locale, resultBudget) ?? MISSING_MARK,
        duration: attempt.verdict === "skipped" && attempt.durationMs === 0 ? null : formatDurationMs(attempt.durationMs),
        cost: attempt.costUSD === null ? null : formatUSD(attempt.costUSD),
      },
    }));
    return [parent, ...attempts];
  });
  const flags = item.flags && Object.keys(item.flags).length > 0
    ? `${localeText(locale, "experimentList.flags")} ${Object.entries(item.flags)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" · ")}`
    : undefined;
  return [
    experimentDisplayName(item.experimentId, relativeTo),
    flags,
    renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx),
  ]
    .filter(Boolean)
    .join("\n");
}

export function experimentListText(items: readonly ExperimentListItem[], ctx: TextContext, relativeTo?: string): string {
  if (items.length === 0) return localeText(ctx.locale, "attemptList.empty");
  return [
    experimentSummaryTable(items, ctx, relativeTo),
    ...items.map((item) => experimentDetailTable(item, ctx, relativeTo)),
  ].join("\n\n");
}

// ── EvalList ──

function evalListAttemptLine(item: AttemptListItem, ctx: TextContext): string {
  // 行式列表同守「Result 最多两行」:预算 = 两行终端宽,超出按尾截收口。
  const reason = attemptReasonText(item, ctx.locale, ctx.width * 2 - stringWidth(locatorBadge(item)) - 6);
  return `  ${locatorBadge(item)}${reason ? ` · ${reason}` : ""}`;
}

export function evalListText(items: readonly EvalListItem[], ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => {
    const identity = `${item.evalId} · ${item.experimentId} · ${localeText(locale, `verdict.${item.verdict}`)}`;
    const summary = [
      localeText(locale, "attemptList.score", { score: cellText(item.examScore, locale) }),
      localeText(locale, "overview.attemptsCount", { n: item.attempts.length }),
      localeText(locale, "entityList.average", {
        value: item.durationMs.value === null ? missingText(locale) : formatDurationMs(item.durationMs.value),
      }),
      localeText(locale, "entityList.average", {
        value: item.costUSD.value === null ? missingText(locale) : formatUSD(item.costUSD.value),
      }),
    ].join(" · ");
    const attemptLines = item.attempts.map((attempt) => evalListAttemptLine(attempt, ctx));
    return [identity, `  ${summary}`, ...attemptLines].join("\n");
  });
  return blocks.join("\n\n");
}

// ── AttemptList ──

/** Attempt 比较卡片:只显示一条主失败摘要(至多两行终端宽);完整 assertions 走 locator 下钻。 */
function attemptListItemText(item: AttemptListItem, ctx: TextContext): string {
  const head = [
    `${verdictMark(item.verdict)} ${item.locator}`,
    item.evalId,
    item.experimentId,
    formatDurationMs(item.durationMs),
    ...(item.costUSD !== null ? [formatUSD(item.costUSD)] : []),
  ].join(" · ");
  const lines = [head];
  const reason = attemptReasonText(item, ctx.locale, ctx.width * 2 - 4);
  if (reason) lines.push(`  ${reason}`);
  return lines.join("\n");
}

export function attemptListText(items: readonly AttemptListItem[], total: number | undefined, ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => attemptListItemText(item, ctx));
  const remaining = (total ?? items.length) - items.length;
  if (remaining > 0) blocks.push(localeText(locale, "attemptList.truncatedText", { n: remaining }));
  return blocks.join("\n\n");
}

// ───────────────────────── 站点组件(HeroCard / ScopeWarnings / TraceWaterfall)─────────────────────────

/**
 * HeroCard 的 text 面:标题行 + meta 行(最后运行时间;空范围为内置「暂无运行」文案;
 * 多快照时标注合成来源),不含品牌行(品牌行是纯 web 件,text 面零输出)。
 */
export function heroCardText(title: LocalizedText, data: HeroData, ctx: TextContext): string {
  const locale = ctx.locale;
  const meta =
    data.latestStartedAt === null
      ? localeText(locale, "hero.noRuns")
      : [
          localeText(locale, "hero.lastRun", { time: formatDateTimeMinute(data.latestStartedAt) }),
          ...(data.snapshots > 1 ? [localeText(locale, "hero.composedSnapshots", { n: data.snapshots })] : []),
        ].join(" · ");
  return `${resolveLocalizedText(title, locale)}\n${meta}`;
}

/**
 * ScopeWarnings 的 text 面:按动作聚合(../scope-warnings.ts,与 web 面共用),同构但不折叠——
 * 多组时首行 "! <分类计数汇总>";每组一行组头 "! <标题> — <徽标> → <组头命令>",其下缩进
 * 逐条原样打印 message(已以下一步收尾,不截断掉尾段)。空警告集零输出。
 */
export function scopeWarningsText(warnings: readonly ScopeWarning[], ctx: TextContext): string {
  if (warnings.length === 0) return "";
  const { summary, groups } = groupScopeWarnings(warnings, ctx.locale);
  const lines: string[] = [];
  // 汇总行只在多组时打印;单组时组头即汇总,不另起一行(web 面则恒以汇总行作外层 <summary>)。
  if (groups.length > 1) lines.push(`! ${summary}`);
  for (const group of groups) {
    const badges = group.badges.length > 0 ? ` — ${group.badges.map((b) => b.text).join(" · ")}` : "";
    const command = group.headCommand !== null ? ` → ${group.headCommand}` : "";
    lines.push(`! ${group.title}${badges}${command}`);
    for (const w of group.warnings) lines.push(`!   ${w.message}`);
  }
  return lines.join("\n");
}

/**
 * TraceWaterfall 的 text 面:每 attempt 一行——locator、总耗时(缺 trace 如实显示缺失)、
 * 顶层 span 计数与失败标记,行尾是可复制的 `--timing` 下钻命令(经宿主注入的 attemptCommand
 * 通道拼出,携带宿主上下文)。当前报告没有 attempt-input page 时 `ctx.attemptCommand`
 * 不存在,行退化为纯文本,不生成假命令(architecture.md「Attempt 详情是一张参数化 page」)。
 */
export function traceWaterfallText(rows: readonly TraceWaterfallRow[], ctx: TextContext): string {
  const locale = ctx.locale;
  if (rows.length === 0) return localeText(locale, "traceWaterfall.empty");
  return rows
    .map((row) => {
      const failedSpans = row.spans.filter((span) => span.failed).length;
      const parts = [
        row.locator,
        row.evalId,
        row.durationMs === null ? localeText(locale, "traceWaterfall.noTrace") : formatDurationMs(row.durationMs),
        countText(locale, "traceWaterfall.spans", row.spans.length),
        ...(failedSpans > 0 ? [`✗ ${countText(locale, "traceWaterfall.failedSpans", failedSpans)}`] : []),
      ];
      const line = parts.join(" · ");
      return ctx.attemptCommand ? `${line}   ${ctx.attemptCommand(row.locator)} --timing` : line;
    })
    .join("\n");
}
