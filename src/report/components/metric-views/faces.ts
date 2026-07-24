// 指标图形族(MetricTable / MetricMatrix / MetricBars / Scoreboard / MetricScatter /
// MetricLine / DeltaTable)的 text 面:同一份算好的数据,渲染成终端字符
// (niceeval show 的形态)。与 web 面共守诚实契约:排序随 better、samples < total 角标、
// 缺数据 — 不补 0、截断报剩余。零 react、零 IO、纯同步。

import type {
  DeltaData,
  LineData,
  MatrixData,
  MetricCell,
  MetricColumn,
  ScatterData,
  ScoreboardData,
  StabilityMatrixCell,
  StabilityMatrixData,
  TableData,
} from "../../model/types.ts";
import type { TextContext } from "../../definition/tree.ts";
import type { TableColumn, TableRow } from "../../definition/primitives.tsx";
import { formatMetricValue, formatPlainNumber, formatPoints, formatTickValue, verdictMark } from "../../model/format.ts";
import { countText, localeText, resolveLocalizedText, resolveMetricLabel, type ReportLocale } from "../../model/locale.ts";
import { padDisplay, stringWidth, textBar } from "../../model/text-layout.ts";
import { renderTableText } from "../../definition/table-text.ts";
import { paddedAxisDomain } from "./chart-math.ts";
import { renderCharPlot, renderCoordinateTable, type PlotPoint } from "./plot.ts";
import { cellText, missingText, MISSING_MARK } from "../shared-faces.ts";

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

  // 值域与 web 面共用同一条规则(chart-math.ts 的 paddedAxisDomain):呼吸边距 + bounds 钳制,
  // text 面在 renderCharPlot 内部按字符行列粒度取整,不重算这份值域。
  const plot = renderCharPlot({
    width: ctx.width,
    points,
    xDomain: paddedAxisDomain(ordered.map((r) => r.x.value as number), data.x.bounds),
    yDomain: paddedAxisDomain(ordered.map((r) => r.y.value as number), data.y.bounds),
    lines: [],
    xLabel: axes.x,
    yLabel: axes.y,
    formatX: (v, step) => (step !== undefined && Number.isFinite(step) ? formatTickValue(v, step, data.x.unit) : formatMetricValue(v, data.x.unit)),
    formatY: (v, step) => (step !== undefined && Number.isFinite(step) ? formatTickValue(v, step, data.y.unit) : formatMetricValue(v, data.y.unit)),
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

  // x 轴是 NumericAxis,没有 bounds 声明,只扩边距不钳制;y 轴按指标 bounds 钳制。
  const plot = renderCharPlot({
    width: ctx.width,
    points,
    xDomain: paddedAxisDomain(drawable.map((r) => r.x as number)),
    yDomain: paddedAxisDomain(drawable.map((r) => r.y.value as number), data.y.bounds),
    lines: lines.filter((l) => l.length > 1),
    xLabel,
    yLabel: axisLabel(data.y, locale),
    formatX: (v, step) => (step !== undefined && Number.isFinite(step) ? formatTickValue(v, step, data.x.unit) : formatMetricValue(v, data.x.unit)),
    formatY: (v, step) => (step !== undefined && Number.isFinite(step) ? formatTickValue(v, step, data.y.unit) : formatMetricValue(v, data.y.unit)),
  });
  const legend = seriesKeys
    .map((key, i) => `${POINT_MARKS[i]} ${key === "" ? axisLabel(data.y, locale) : key}`)
    .join("   ");
  return [plot, "", legend, ...footnotes].join("\n");
}

// ───────────────────────── DeltaTable ─────────────────────────

/** 带符号的差值文案:正数补 `+`,负数由 formatMetricValue 自带 `-`。 */
function signedMetricText(value: number, unit?: string): string {
  const text = formatMetricValue(Math.abs(value), unit);
  return value >= 0 ? `+${text}` : `-${text}`;
}

type DeltaEntry = NonNullable<DeltaData["rows"][number]["delta"]>[string];

/** 一格的摘要:通过制显示 verdict,计分制在同一位置显示挣分;随后 tokens、成本;历史执行叠加 ↩。 */
function deltaConditionCellText(cell: DeltaData["rows"][number]["cells"][string] | undefined, locale: ReportLocale): string {
  if (!cell) return MISSING_MARK;
  const parts: string[] = [
    cell.scoring === "points"
      ? cell.totalScore !== undefined
        ? formatPoints(cell.totalScore)
        : MISSING_MARK
      : `${verdictMark(cell.verdict)} ${localeText(locale, `verdict.${cell.verdict}`)}`,
    cell.totalTokens !== undefined ? formatMetricValue(cell.totalTokens) : MISSING_MARK,
    cell.totalCostUSD !== undefined ? formatMetricValue(cell.totalCostUSD, "$") : MISSING_MARK,
  ];
  if (cell.historical) parts.push("↩");
  return parts.join("   ");
}

/** 对基准的 Δ:任一侧缺数据的分量各自显示缺,不把缺失当 0。 */
function deltaEntryText(entry: DeltaEntry | undefined, hasScore: boolean): string {
  const parts: string[] = [];
  if (hasScore) parts.push(entry?.score !== undefined ? signedMetricText(entry.score) : MISSING_MARK);
  parts.push(entry?.tokens !== undefined ? signedMetricText(entry.tokens) : MISSING_MARK);
  parts.push(entry?.costUSD !== undefined ? signedMetricText(entry.costUSD, "$") : MISSING_MARK);
  return parts.join("   ");
}

function deltaTotalsCellText(totals: DeltaData["totals"][string] | undefined, locale: ReportLocale): string {
  if (!totals) return MISSING_MARK;
  const parts: string[] = [];
  if (totals.passed !== undefined && totals.denominator !== undefined) {
    parts.push(`${totals.passed}/${totals.denominator} ${localeText(locale, "verdict.passed")}`);
  }
  if (totals.totalScore !== undefined) parts.push(formatPoints(totals.totalScore));
  if (totals.totalTokens !== undefined) parts.push(formatMetricValue(totals.totalTokens));
  if (totals.totalCostUSD !== undefined) parts.push(formatMetricValue(totals.totalCostUSD, "$"));
  return parts.length > 0 ? parts.join("   ") : MISSING_MARK;
}

export function deltaText(data: DeltaData, ctx: TextContext): string {
  const locale = ctx.locale;
  // 0 对不是错误:明确空态并报告配对域实验数(派生形态携带;字面形态缺省按 0)。
  if (data.rows.length === 0) {
    return localeText(locale, "delta.empty", { experiments: data.experiments ?? 0 });
  }
  const baseline = data.conditions[0];
  const nonBaseline = data.conditions.slice(1);
  const hasScore = data.rows.some((row) => Object.values(row.cells).some((cell) => cell.scoring === "points"));

  const columns: TableColumn[] = [
    { key: "eval", header: localeText(locale, "table.eval") },
    ...data.conditions.map((condition, i) => ({ key: `cond${i}`, header: condition })),
    ...nonBaseline.map((condition, i) => ({ key: `delta${i}`, header: `Δ ${condition}` })),
  ];

  const rows: TableRow[] = data.rows.map((row) => {
    const cells: Record<string, string | null> = { eval: row.flipped ? `${row.key}  ⇄` : row.key };
    data.conditions.forEach((condition, i) => {
      cells[`cond${i}`] = deltaConditionCellText(row.cells[condition], locale);
    });
    nonBaseline.forEach((condition, i) => {
      cells[`delta${i}`] = deltaEntryText(row.delta?.[condition], hasScore);
    });
    return { key: row.key, cells };
  });

  const totalsCells: Record<string, string | null> = { eval: localeText(locale, "delta.totalsRow") };
  data.conditions.forEach((condition, i) => {
    totalsCells[`cond${i}`] = deltaTotalsCellText(data.totals[condition], locale);
  });
  nonBaseline.forEach((condition, i) => {
    totalsCells[`delta${i}`] = null;
  });
  rows.push({ key: "__totals__", cells: totalsCells });

  const table = renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx);

  // 共同题 paired delta:每个非基准条件一行,只在与基准的共同 eval 交集上归因——
  // 与「汇总」(各条件自身覆盖面)是两个互不替代的口径,分开呈现。
  const footnotes = nonBaseline
    .map((condition) => {
      const pd = data.pairedDelta[condition];
      if (!pd || pd.commonEvalIds.length === 0) return null;
      const parts: string[] = [];
      if (pd.pass) parts.push(`${localeText(locale, "delta.passRate")} ${signedMetricText(pd.pass.passRatePoints)}pt`);
      if (pd.points) parts.push(`${localeText(locale, "delta.totalScore")} ${signedMetricText(pd.points.totalScore)}`);
      if (pd.tokens !== undefined) parts.push(`tokens ${signedMetricText(pd.tokens)}`);
      if (pd.costUSD !== undefined) parts.push(`${localeText(locale, "delta.cost")} ${signedMetricText(pd.costUSD, "$")}`);
      return `${localeText(locale, "delta.commonVsBaseline", { n: pd.commonEvalIds.length })} · ${baseline} → ${condition}: ${parts.join(" · ")}`;
    })
    .filter((line): line is string => line !== null);

  return footnotes.length > 0 ? `${table}\n${footnotes.join("\n")}` : table;
}

// ───────────────────────── StabilityMatrix ─────────────────────────

function stabilityCellText(cell: StabilityMatrixCell): string {
  return `✓${cell.passed} ✗${cell.failed} !${cell.errored}`;
}

export function stabilityMatrixText(data: StabilityMatrixData, ctx: TextContext): string {
  if (data.rows.length === 0) return "";
  const locale = ctx.locale;
  const byPosition = new Map<string, StabilityMatrixCell>();
  for (const entry of data.cells) byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);

  const columns: TableColumn[] = [
    { key: "eval", header: localeText(locale, "table.eval") },
    ...data.columns.map((column, i) => ({ key: `col${i}`, header: column })),
  ];
  const rows: TableRow[] = data.rows.map((row) => {
    const cells: Record<string, string | null> = {
      eval: row.neverPassed ? `${row.evalId}   ${localeText(locale, "stability.neverPassed")}` : row.evalId,
    };
    data.columns.forEach((column, i) => {
      const cell = byPosition.get(JSON.stringify([row.evalId, column]));
      // 稀疏格子:没有任何历史执行的组合在文本里以 — 呈现,不编三个 0 冒充跑过。
      cells[`col${i}`] = cell ? stabilityCellText(cell) : null;
    });
    return { key: row.evalId, cells };
  });

  const totalsCells: Record<string, string | null> = { eval: localeText(locale, "delta.totalsRow") };
  data.columns.forEach((column, i) => {
    const total = data.totals[column];
    totalsCells[`col${i}`] = total ? stabilityCellText(total) : null;
  });
  rows.push({ key: "__totals__", cells: totalsCells });

  return renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx);
}
