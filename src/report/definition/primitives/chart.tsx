// Chart 原语:消费 Dataset,用 x/y 与 <Series> 映射坐标与 mark(docs/feature/reports/components/charts/README.md)。

import type { CSSProperties, ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import {
  SeriesPatternDefs,
  seriesClassFromColorVar,
  seriesClassesFromFill,
} from "../../assets/series-encoding.tsx";
import { defineComponent, type ReportNode, type TextContext, type WebContext } from "../tree.ts";
import type { ReportTarget } from "../report.ts";
import type { DimensionDeclarations, DimensionPresentation } from "../../presentation.ts";
import type { Dataset, DatasetField } from "../../model/types.ts";
import type { ReportLocale } from "../../model/locale.ts";
import { countText, localeText, resolveLocalizedText, type ReportLocale as RL } from "../../model/locale.ts";
import { formatAxisTick, formatMetricValue, shortestUniqueLabels } from "../../model/format.ts";
import { axisScale, paddedAxisDomain, placePointLabels, ticksInDomain, tickStepOf } from "../../model/chart/math.ts";
import { renderCharPlot, renderCoordinateTable } from "../../model/chart/plot.ts";
import { padDisplay, padStartDisplay, stringWidth, textBar } from "../../model/text-layout.ts";
import { dataShapeError, targetOfRefs, type ValueProps } from "../../components/shared.ts";
import { isDataset } from "../../model/dataset.ts";
import {
  mapChartSeries,
  resolveChartAxes,
  seriesDimensionValues,
  type ChartAxisBinding,
  type ChartSeriesOverride,
  type MappedSeries,
  type SeriesProps,
} from "./chart-map.ts";

export type { SeriesProps };

const WIDTH = 760;
const HEIGHT = 400;
const MARGIN = { top: 28, right: 32, bottom: 48, left: 64 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const IMPLICIT_SERIES_HANDLE = "__chartSeries";

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Chart 内部一个可下钻的点(x/y 映射后);pointTarget 只看 `refs` 与 `key`,不看坐标或 label。
 * `key` 是该点在 Dataset 里的行 key——`Scatter`/`Bars` 等声明了 `point="<field>"` 时,它就是
 * 该字段的原始值(如 experiment id),让上层的 pointTarget 不必反查证据即可拿到点的业务身份。
 */
export interface ChartTargetPoint {
  refs: readonly AttemptLocator[];
  key: string;
}

export interface ChartPresentation {
  children?: ReportNode;
  width?: number | `${number}%`;
  height?: number;
  aspect?: number;
  layout?: "horizontal" | "vertical";
  legend?: boolean;
  tooltip?: boolean;
  grid?: boolean;
  series?: Readonly<Record<string, ChartSeriesOverride>>;
  /**
   * 「这个点该指向谁」由放点的上层决定(library.md「目标与下钻」)。省略时落到全库唯一的
   * 默认规则 `targetOfRefs(point.refs)`——单证据给出 attempt 目标,零或多证据不成链
   * (这正是 refs[0] 快捷写法的已知 bug:多 attempt 点被压成第一个 attempt 的目标,而不是
   * 报不出目标)。
   */
  pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined;
  locale?: ReportLocale;
  className?: string;
}

/** `pointTarget` 缺省时的目标:`targetOfRefs`,把 refs[0] 式的错误收窄成结构化的唯一规则。 */
function resolvePointTarget(
  point: ChartTargetPoint,
  pointTarget: ((point: ChartTargetPoint) => ReportTarget | undefined) | undefined,
): ReportTarget | undefined {
  return pointTarget ? pointTarget(point) : targetOfRefs(point.refs);
}

function pointHref(
  point: { refs: readonly string[]; key: string },
  ctx: WebContext,
  pointTarget: ((point: ChartTargetPoint) => ReportTarget | undefined) | undefined,
): string | undefined {
  const target = resolvePointTarget(
    { refs: point.refs as readonly AttemptLocator[], key: point.key },
    pointTarget,
  );
  return target === undefined ? undefined : ctx.href(target);
}

export type ChartProps = ValueProps<Dataset, ChartPresentation & { x: ChartAxisBinding; y: ChartAxisBinding }>;

function assertDataset(data: unknown): Dataset {
  if (!isDataset(data)) {
    throw dataShapeError("Chart", "data", "Dataset", '"data" must be a Dataset { fields, rows }');
  }
  return data;
}

function seriesNodesOf(children: ReportNode | undefined): SeriesProps[] {
  if (children === null || children === undefined || typeof children === "boolean") return [];
  const out: SeriesProps[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node === "object" && node !== null && "type" in node && "props" in node) {
      const el = node as { type: unknown; props: SeriesProps };
      if (el.type === Series) out.push(el.props);
    }
  };
  visit(children);
  return out;
}

function validateChart(dataset: Dataset, specs: SeriesProps[], x: ChartAxisBinding, y: ChartAxisBinding): void {
  if (specs.length === 0) {
    throw new Error("Chart needs at least one <Series> child declaring mark and id.");
  }
  const ids = new Set<string>();
  for (const spec of specs) {
    if (!spec.id || typeof spec.id !== "string") {
      throw new Error('Each <Series> needs a non-empty string "id".');
    }
    if (ids.has(spec.id)) {
      throw new Error(`Chart contains duplicate <Series id=${JSON.stringify(spec.id)}>.`);
    }
    ids.add(spec.id);
  }
  resolveChartAxes(dataset, x, y);
}

function lineDash(style: MappedSeries["line"]): string | undefined {
  if (style === "dashed") return "6 4";
  if (style === "dotted") return "2 3";
  return undefined;
}

function seriesMarkChar(mark: MappedSeries["mark"], index: number): string {
  if (mark === "scatter" || mark === "line") return String.fromCharCode(65 + (index % 26));
  return "█";
}

function chartFieldLabel(field: string, meta: DatasetField, locale: RL): string {
  const dictionary: globalThis.Record<string, Parameters<typeof localeText>[1]> = {
    costUSD: "experimentList.cost",
    passRate: "scopeSummary.passRate",
    totalScore: "scopeSummary.totalScore",
    durationMs: "experimentList.avgDuration",
    tokens: "experimentList.tokens",
  };
  const base = dictionary[field] ? localeText(locale, dictionary[field]!) : field;
  return meta.unit ? `${base}(${meta.unit})` : base;
}

/** 解析点所属 series 句柄与下标;单系列隐式图不声明视觉身份。 */
function seriesPresentationOf(
  mapped: MappedSeries[],
  series: MappedSeries,
  point: MappedSeries["points"][number],
  ctx: WebContext,
): DimensionPresentation | undefined {
  let handle: string;
  let index: number;
  if (series.byField !== undefined && point.seriesValue !== undefined) {
    handle = series.byField;
    index = seriesDimensionValues(mapped, series.byField).indexOf(point.seriesValue);
  } else {
    const ids = mapped.filter((item) => !item.hidden && item.byField === undefined).map((item) => item.id);
    if (ids.length < 2) return undefined;
    handle = IMPLICIT_SERIES_HANDLE;
    index = ids.indexOf(series.id);
  }
  if (index < 0) return undefined;
  return ctx.dimension(handle).at(index);
}

/** SVG 路径:只挂 series-cN 设 --series;pattern 由 fill 属性 / style 承载。 */
function seriesColorClass(presentation: DimensionPresentation | undefined): string {
  if (!presentation) return "niceeval-series-none";
  if (presentation.kind === "color") return seriesClassFromColorVar(presentation.color);
  if (presentation.kind !== "series") return "niceeval-series-none";
  if (presentation.mark === "bar" || presentation.mark === "area") {
    // 只要色类,不要 HTML 专用的 fill-vN(SVG 用 url(#pattern))。
    const classes = seriesClassesFromFill(presentation.fill).split(" ");
    return classes.find((c) => c.startsWith("niceeval-series-c") || c === "niceeval-series-none") ?? "niceeval-series-none";
  }
  if (presentation.mark === "line") return seriesClassFromColorVar(presentation.stroke);
  return seriesClassFromColorVar(presentation.marker.fill);
}

/** HTML 横向柱:色类 + fill-vN 图案类(CSS repeating-linear-gradient 等效 SVG pattern)。 */
function seriesHtmlBarClass(presentation: DimensionPresentation | undefined): string {
  if (!presentation) return "niceeval-series-none";
  if (presentation.kind === "series" && (presentation.mark === "bar" || presentation.mark === "area")) {
    return seriesClassesFromFill(presentation.fill);
  }
  return seriesColorClass(presentation);
}

/**
 * 作者在 `<Series line>` 上显式声明的 dashed/dotted **优先于** 页级 variant 的 strokeDasharray。
 * 未声明时消费 LineSeriesPresentation / FillSeriesPresentation 的 strokeDasharray(空串 = 实线)。
 */
function resolveStrokeDasharray(
  series: MappedSeries,
  presentation: DimensionPresentation | undefined,
): string | undefined {
  if (series.line !== undefined) return lineDash(series.line);
  if (presentation?.kind === "series" && "strokeDasharray" in presentation) {
    return presentation.strokeDasharray || undefined;
  }
  return undefined;
}

/** SVG 柱/面:pattern fill 必须用 style 压过 `.niceeval-chart-bar { fill: var(--series) }`。 */
function seriesSvgFillStyle(presentation: DimensionPresentation | undefined): CSSProperties | undefined {
  if (presentation?.kind !== "series") return undefined;
  if (presentation.mark !== "bar" && presentation.mark !== "area") return undefined;
  if (!presentation.fill.startsWith("url(")) return undefined;
  return { fill: presentation.fill };
}

function renderMarkerShape(
  presentation: DimensionPresentation | undefined,
  px: number,
  py: number,
  colorClass: string,
  title: ReactNode,
): ReactNode {
  const marker =
    presentation?.kind === "series" && (presentation.mark === "scatter" || presentation.mark === "line")
      ? presentation.marker
      : undefined;
  if (!marker) {
    return (
      <circle className={cx("niceeval-chart-dot", colorClass)} cx={px} cy={py} r={4.5}>
        {title}
      </circle>
    );
  }
  // path 在 0..12 viewBox;缩放到 ~9px 并居中到 (px, py)。
  return (
    <path
      className={cx("niceeval-chart-dot", colorClass)}
      d={marker.path}
      transform={`translate(${px} ${py}) scale(0.75) translate(-6 -6)`}
      fill={marker.fill}
      stroke="var(--panel)"
      strokeWidth={1.6}
    >
      {title}
    </path>
  );
}

function legendSwatch(presentation: DimensionPresentation | undefined, mark: MappedSeries["mark"]): ReactNode {
  if (!presentation || presentation.kind !== "series") {
    return <span className={cx("niceeval-chart-legend-swatch", "niceeval-series-none")} />;
  }
  // 图例方块跟 mark 取义:柱/面用填充图案,线用 dash+marker,散点用 marker 形状。
  if (mark === "bar" || mark === "area") {
    const fillClass =
      presentation.mark === "bar" || presentation.mark === "area"
        ? seriesClassesFromFill(presentation.fill)
        : seriesColorClass(presentation);
    return <span className={cx("niceeval-chart-legend-swatch", fillClass)} />;
  }
  if (presentation.mark === "line" || mark === "line" || mark === "area") {
    const stroke = presentation.mark === "line" ? presentation.stroke : presentation.marker.fill;
    const dash = presentation.mark === "line" ? presentation.strokeDasharray : "";
    const marker = presentation.marker;
    return (
      <svg className="niceeval-chart-legend-swatch-svg" width="16" height="10" aria-hidden="true">
        <line
          x1="0"
          y1="5"
          x2="16"
          y2="5"
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={dash || undefined}
        />
        <path
          d={marker.path}
          transform="translate(8 5) scale(0.55) translate(-6 -6)"
          fill={marker.fill}
        />
      </svg>
    );
  }
  return (
    <svg className="niceeval-chart-legend-swatch-svg" width="10" height="10" aria-hidden="true">
      <path
        d={presentation.marker.path}
        transform="translate(5 5) scale(0.7) translate(-6 -6)"
        fill={presentation.marker.fill}
      />
    </svg>
  );
}

function metricDisplay(
  point: MappedSeries["points"][number],
  axis: "x" | "y",
  meta: DatasetField,
  locale: RL,
): string {
  if (meta.kind === "dimension") {
    return axis === "x" ? (point.xLabel ?? point.pointLabel) : (point.yLabel ?? point.pointLabel);
  }
  const value = point[axis];
  const cell = axis === "x" ? point.xCell : point.yCell;
  return formatMetricValue(value, meta.unit, cell?.format, locale);
}

function renderLegend(
  mapped: MappedSeries[],
  visible: MappedSeries[],
  locale: RL,
  ctx: WebContext,
): ReactNode {
  return (
    <ul className="niceeval-chart-legend">
      {visible.flatMap((series) => {
        const byValues = series.byField ? seriesDimensionValues(mapped, series.byField) : [series.id];
        return byValues.map((value) => {
          const implicitIds = visible
            .filter((item) => item.byField === undefined)
            .map((item) => item.id);
          const handle = series.byField ?? (implicitIds.length > 1 ? IMPLICIT_SERIES_HANDLE : undefined);
          const index = series.byField
            ? seriesDimensionValues(mapped, series.byField).indexOf(value)
            : implicitIds.indexOf(series.id);
          const presentation = handle ? ctx.dimension(handle).at(index) : undefined;
          const label = presentation?.label ?? (series.label ? resolveLocalizedText(series.label, locale) : series.id);
          return (
            <li key={`${series.id}:${value}`} className="niceeval-chart-legend-item">
              {legendSwatch(presentation, series.mark)}
              {label}
            </li>
          );
        });
      })}
    </ul>
  );
}

function renderHorizontalBarsWeb(
  mapped: MappedSeries[],
  visible: MappedSeries[],
  axes: ReturnType<typeof resolveChartAxes>,
  locale: RL,
  ctx: WebContext,
  options: { legend?: boolean; pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined; className?: string },
): ReactNode {
  const entries = visible.flatMap((series) => series.points.map((point) => ({ series, point })));
  const labels = shortestUniqueLabels(entries.map(({ point }) => point.xLabel ?? point.pointLabel));
  const values = entries.map(({ point }) => point.y);
  const boundMax = axes.yMeta.kind === "metric" ? axes.yMeta.bounds?.max : undefined;
  const max = boundMax !== undefined && boundMax > 0 ? boundMax : Math.max(0, ...values);

  return (
    <figure
      className={cx(
        "niceeval-report",
        "niceeval-chart",
        "niceeval-chart--bars-horizontal",
        options.className,
      )}
    >
      {/* 横向 HTML 柱不引用 pattern,但同页可能另有 SVG 图;defs 全局一份无害。 */}
      <SeriesPatternDefs />
      <div className="niceeval-chart-bars-heading">
        {chartFieldLabel(axes.yField, axes.yMeta, locale)}
      </div>
      <ol className="niceeval-chart-bars">
        {entries.map(({ series, point }) => {
          const rawLabel = point.xLabel ?? point.pointLabel;
          const label = labels.get(rawLabel) ?? rawLabel;
          const display = metricDisplay(point, "y", axes.yMeta, locale);
          const href = pointHref(point, ctx, options.pointTarget);
          const presentation = seriesPresentationOf(mapped, series, point, ctx);
          const colorClass = seriesHtmlBarClass(presentation);
          const ratio = max > 0 ? Math.max(0, Math.min(1, point.y / max)) : 0;
          const value = (
            <span className="niceeval-chart-bar-value">
              {display}
              {point.yCell && point.yCell.samples < point.yCell.total ? (
                <sup>
                  {point.yCell.samples}/{point.yCell.total}
                </sup>
              ) : null}
            </span>
          );
          return (
            <li key={`${series.id}:${point.key}`} className="niceeval-chart-bar-row">
              <span className="niceeval-chart-bar-label" title={rawLabel}>{label}</span>
              <span className="niceeval-chart-bar-track">
                <span
                  className={cx("niceeval-chart-bar-fill", colorClass)}
                  style={{ width: `${ratio * 100}%` }}
                  title={`${rawLabel}\n${axes.yField}: ${display}`}
                />
              </span>
              {href ? <a className="niceeval-locator" href={href}>{value}</a> : value}
            </li>
          );
        })}
      </ol>
      {options.legend ? renderLegend(mapped, visible, locale, ctx) : null}
    </figure>
  );
}

function stackedBarBase(
  visible: readonly MappedSeries[],
  target: MappedSeries,
  x: number,
): number {
  if (target.stack === undefined) return 0;
  let total = 0;
  for (const series of visible) {
    if (series === target) break;
    if (series.mark !== "bar" || series.stack !== target.stack) continue;
    const point = series.points.find((item) => item.x === x);
    if (point) total += point.y;
  }
  return total;
}

function chartYValues(visible: readonly MappedSeries[]): number[] {
  const values: number[] = [];
  const stacks = new Map<string, number>();
  for (const series of visible) {
    for (const point of series.points) {
      if (series.mark === "bar" && series.stack !== undefined) {
        const key = `${series.stack}\0${point.x}`;
        stacks.set(key, (stacks.get(key) ?? 0) + point.y);
      } else {
        values.push(point.y);
      }
    }
  }
  values.push(...stacks.values());
  return values;
}

function renderChartWeb(
  mapped: MappedSeries[],
  axes: ReturnType<typeof resolveChartAxes>,
  locale: RL,
  ctx: WebContext,
  options: {
    layout?: "horizontal" | "vertical";
    legend?: boolean;
    grid?: boolean;
    pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined;
    className?: string;
  },
): ReactNode {
  const visible = mapped.filter((s) => !s.hidden);
  const allPoints = visible.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return (
      <figure className={cx("niceeval-report", "niceeval-chart", "niceeval-chart--scatter", options.className)}>
        <p className="niceeval-chart-empty niceeval-missing">{localeText(locale, "cell.missing")}</p>
      </figure>
    );
  }
  if (options.layout === "horizontal" && visible.every((series) => series.mark === "bar")) {
    return renderHorizontalBarsWeb(mapped, visible, axes, locale, ctx, options);
  }

  const xBounds = axes.xMeta.kind === "metric" ? axes.xMeta.bounds : undefined;
  const yBounds = axes.yMeta.kind === "metric" ? axes.yMeta.bounds : undefined;
  const hasVerticalFill = visible.some((series) => series.mark === "bar" || series.mark === "area");
  const yValues = [...chartYValues(visible), ...(hasVerticalFill ? [0] : [])];
  const xScale = axisScale(
    allPoints.map((p) => p.x),
    xBounds,
    MARGIN.left,
    MARGIN.left + PLOT_W,
    axes.xMeta.better === "lower",
  );
  const yScale = axisScale(
    yValues,
    yBounds,
    MARGIN.top + PLOT_H,
    MARGIN.top,
    axes.yMeta.better === "lower",
  );
  const labelByKey = shortestUniqueLabels(allPoints.map((p) => p.pointLabel));
  const xLabel = chartFieldLabel(axes.xField, axes.xMeta, locale);
  const yLabel = chartFieldLabel(axes.yField, axes.yMeta, locale);

  const drawable = visible.flatMap((series) =>
    series.points.map((point) => {
      const presentation = seriesPresentationOf(mapped, series, point, ctx);
      return {
        ...point,
        sourceSeriesId: series.id,
        label: labelByKey.get(point.pointLabel) ?? point.pointLabel,
        px: xScale.scale(point.x),
        py: yScale.scale(point.y),
        presentation,
        seriesClass: seriesColorClass(presentation),
      };
    }),
  );

  const labels = placePointLabels(
    drawable.map((p) => ({ cx: p.px, cy: p.py, width: p.label.length * 6.4 + 10 })),
    { x0: 2, y0: 2, x1: WIDTH - 2, y1: HEIGHT - 2 },
  );

  return (
    <figure className={cx("niceeval-report", "niceeval-chart", "niceeval-chart--scatter", options.className)}>
      <SeriesPatternDefs />
      <svg className="niceeval-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${axes.xField} × ${axes.yField}`}>
        {options.grid !== false ? (
          <g className="niceeval-chart-grid">
            {yScale.ticks.map((tick) => (
              <line key={`gy${tick}`} x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={yScale.scale(tick)} y2={yScale.scale(tick)} />
            ))}
            {xScale.ticks.map((tick) => (
              <line key={`gx${tick}`} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} x1={xScale.scale(tick)} x2={xScale.scale(tick)} />
            ))}
          </g>
        ) : null}
        <g className="niceeval-chart-axis niceeval-chart-axis-y">
          {(axes.yMeta.kind === "dimension"
            ? [...new Set(drawable.map((point) => point.y))]
            : yScale.ticks
          ).map((tick) => (
            <text key={`ay${tick}`} className="niceeval-chart-tick" x={MARGIN.left - 8} y={yScale.scale(tick) + 3} textAnchor="end">
              {axes.yMeta.kind === "dimension"
                ? drawable.find((point) => point.y === tick)?.yLabel
                : formatAxisTick(tick, tickStepOf(yScale.ticks), axes.yMeta.unit)}
            </text>
          ))}
        </g>
        <g className="niceeval-chart-axis niceeval-chart-axis-x">
          {(axes.xMeta.kind === "dimension"
            ? [...new Set(drawable.map((point) => point.x))]
            : xScale.ticks
          ).map((tick) => (
            <text key={`ax${tick}`} className="niceeval-chart-tick" x={xScale.scale(tick)} y={MARGIN.top + PLOT_H + 16} textAnchor="middle">
              {axes.xMeta.kind === "dimension"
                ? drawable.find((point) => point.x === tick)?.xLabel
                : formatAxisTick(tick, tickStepOf(xScale.ticks), axes.xMeta.unit)}
            </text>
          ))}
        </g>
        {axes.xMeta.better !== undefined && axes.yMeta.better !== undefined ? (
          <text
            className="niceeval-chart-better-hint"
            x={MARGIN.left + PLOT_W - 6}
            y={MARGIN.top + 14}
            textAnchor="end"
          >
            {localeText(locale, "scatter.betterUpperRight")}
          </text>
        ) : null}
        <text className="niceeval-chart-xlabel" x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 8} textAnchor="middle">
          {xLabel}
        </text>
        <text
          className="niceeval-chart-ylabel"
          x={14}
          y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${MARGIN.top + PLOT_H / 2})`}
        >
          {yLabel}
        </text>
        {visible.flatMap((series) => {
          const values = series.byField ? seriesDimensionValues(mapped, series.byField) : [series.id];
          return values.map((value) => {
            const seriesPoints = drawable.filter(
              (p) =>
                p.sourceSeriesId === series.id &&
                (series.byField === undefined || p.seriesValue === value),
            );
            const ordered = series.connect ? [...seriesPoints].sort((a, b) => a.x - b.x) : seriesPoints;
            const seriesClassName = ordered[0]?.seriesClass ?? "niceeval-series-none";
            const seriesPresentation = ordered[0]?.presentation;
            const baseline = yScale.scale(0);
            const barGroups = [...new Set(
              visible
                .filter((item) => item.mark === "bar")
                .map((item) => item.stack ?? `series:${item.id}`),
            )];
            const barGroup = series.stack ?? `series:${series.id}`;
            const groupIndex = Math.max(0, barGroups.indexOf(barGroup));
            const totalBarWidth = Math.max(8, Math.min(48, PLOT_W / Math.max(1, allPoints.length)));
            const barWidth = totalBarWidth / Math.max(1, barGroups.length);
            const dash = resolveStrokeDasharray(series, seriesPresentation);
            const areaFillStyle = seriesSvgFillStyle(seriesPresentation);
            return (
              <g
                key={`${series.id}:${value}`}
                className={cx("niceeval-chart-series", seriesClassName)}
                data-series={`${series.id}:${value}`}
              >
              {series.mark === "area" && ordered.length > 1 ? (
                <polygon
                  className="niceeval-chart-area"
                  style={areaFillStyle}
                  points={[
                    `${ordered[0]!.px},${baseline}`,
                    ...ordered.map((point) => `${point.px},${point.py}`),
                    `${ordered[ordered.length - 1]!.px},${baseline}`,
                  ].join(" ")}
                />
              ) : null}
              {(series.mark === "line" || series.mark === "area" || series.connect) && ordered.length > 1 ? (
                <polyline
                  className="niceeval-chart-line"
                  points={ordered.map((p) => `${p.px},${p.py}`).join(" ")}
                  strokeDasharray={dash}
                />
              ) : null}
              {ordered.map((p) => {
                const placed = labels[drawable.indexOf(p)];
                const href = pointHref(p, ctx, options.pointTarget);
                let shape: ReactNode;
                if (series.mark === "bar") {
                  const baseValue = stackedBarBase(visible, series, p.x);
                  const baseY = yScale.scale(baseValue);
                  const topY = yScale.scale(baseValue + p.y);
                  shape = (
                    <rect
                      className={cx("niceeval-chart-bar", p.seriesClass)}
                      style={seriesSvgFillStyle(p.presentation)}
                      x={p.px - totalBarWidth / 2 + groupIndex * barWidth}
                      y={Math.min(topY, baseY)}
                      width={barWidth}
                      height={Math.max(1, Math.abs(baseY - topY))}
                    >
                      <title>{`${p.pointLabel}\n${series.id}: ${metricDisplay(p, "y", axes.yMeta, locale)}`}</title>
                    </rect>
                  );
                } else {
                  shape = renderMarkerShape(
                    p.presentation,
                    p.px,
                    p.py,
                    p.seriesClass,
                    <title>{`${p.pointLabel}\n${axes.xField}: ${metricDisplay(p, "x", axes.xMeta, locale)}\n${axes.yField}: ${metricDisplay(p, "y", axes.yMeta, locale)}`}</title>,
                  );
                }
                return (
                  <g key={p.key} className="niceeval-chart-point">
                    {href ? <a href={href}>{shape}</a> : shape}
                    {series.mark === "scatter" && placed ? (
                      <text className="niceeval-chart-point-label" x={placed.x} y={placed.y} textAnchor={placed.anchor}>
                        {p.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
            );
          });
        })}
      </svg>
      {options.legend ? renderLegend(mapped, visible, locale, ctx) : null}
    </figure>
  );
}

function renderBarsText(
  visible: MappedSeries[],
  axes: ReturnType<typeof resolveChartAxes>,
  locale: RL,
  ctx: TextContext,
): string {
  const entries: Array<{ rawLabel: string; value: number; display: string }> = [];
  const stacked = new Map<string, { rawLabel: string; value: number; parts: string[] }>();
  for (const series of visible) {
    for (const point of series.points) {
      const rawLabel = point.xLabel ?? point.pointLabel;
      const display = metricDisplay(point, "y", axes.yMeta, locale);
      if (series.stack !== undefined) {
        const key = `${series.stack}\0${point.x}`;
        let entry = stacked.get(key);
        if (!entry) {
          entry = { rawLabel, value: 0, parts: [] };
          stacked.set(key, entry);
        }
        entry.value += point.y;
        entry.parts.push(`${series.id}=${display}`);
      } else {
        entries.push({
          rawLabel,
          value: point.y,
          display:
            point.yCell && point.yCell.samples < point.yCell.total
              ? `${display} ${point.yCell.samples}/${point.yCell.total}`
              : display,
        });
      }
    }
  }
  entries.push(
    ...[...stacked.values()].map((entry) => ({
      rawLabel: entry.rawLabel,
      value: entry.value,
      display: entry.parts.join(" · "),
    })),
  );
  const rawLabels = entries.map((entry) => entry.rawLabel);
  const labels = shortestUniqueLabels(rawLabels);
  const displays = entries.map((entry) => entry.display);
  const labelWidth = Math.max(0, ...rawLabels.map((label) => stringWidth(labels.get(label) ?? label)));
  const valueWidth = Math.max(0, ...displays.map(stringWidth));
  const barWidth = Math.max(8, Math.min(24, ctx.width - labelWidth - valueWidth - 4));
  const boundMax = axes.yMeta.kind === "metric" ? axes.yMeta.bounds?.max : undefined;
  const max = boundMax !== undefined && boundMax > 0
    ? boundMax
    : Math.max(0, ...entries.map((entry) => entry.value));
  const heading = chartFieldLabel(axes.yField, axes.yMeta, locale);
  return [
    `${padDisplay("", labelWidth)}  ${padDisplay(heading, barWidth)}  ${padStartDisplay("", valueWidth)}`,
    ...entries.map((entry, index) => {
      const rawLabel = rawLabels[index]!;
      const label = labels.get(rawLabel) ?? rawLabel;
      const ratio = max > 0 ? Math.max(0, Math.min(1, entry.value / max)) : 0;
      return `${padDisplay(label, labelWidth)}  ${textBar(ratio, barWidth)}  ${padStartDisplay(displays[index]!, valueWidth)}`;
    }),
  ].join("\n");
}

function chartText(
  dataset: Dataset,
  props: ChartProps & { x: ChartAxisBinding; y: ChartAxisBinding },
  ctx: TextContext,
): string {
  const locale = props.locale ?? ctx.locale;
  const specs = seriesNodesOf(props.children);
  validateChart(dataset, specs, props.x, props.y);
  const axes = resolveChartAxes(dataset, props.x, props.y);
  const { series, missing } = mapChartSeries(dataset, axes, specs, props.series);
  const visible = series.filter((s) => !s.hidden);
  const points = visible.flatMap((s) => s.points);
  if (points.length === 0) {
    return localeText(locale, "cell.missing");
  }
  if (visible.every((item) => item.mark === "bar")) {
    const bars = renderBarsText(visible, axes, locale, ctx);
    const missingNote = missing > 0 ? `\n${countText(locale, "pointsMissing", missing)}` : "";
    return `${bars}${missingNote}`;
  }

  const xBounds = axes.xMeta.kind === "metric" ? axes.xMeta.bounds : undefined;
  const yBounds = axes.yMeta.kind === "metric" ? axes.yMeta.bounds : undefined;
  const xDomain = paddedAxisDomain(points.map((p) => p.x), xBounds);
  const yDomain = paddedAxisDomain(points.map((p) => p.y), yBounds);

  // 标记字母按图例顺序逐点分配:series 按显示键字典序,series 内按 x 原始值升序
  // (docs/feature/reports/show/default-report.md)。按 series 下标分配会让一个 series 的
  // 全部点共用一个字母,图上读不出哪个点是哪一行。
  const groups = legendGroups(visible);
  const marks = new Map<string, string>();
  let letter = 0;
  for (const group of groups) {
    for (const point of group.points) {
      marks.set(point.key, group.mark === "bar" ? "█" : String.fromCharCode(65 + (letter % 26)));
      if (group.mark !== "bar") letter++;
    }
  }

  const lines = visible
    .filter((s) => s.connect && (s.mark === "line" || s.mark === "scatter" || s.mark === "area"))
    .map((s) => [...s.points].sort((a, b) => a.x - b.x).map((p) => ({ x: p.x, y: p.y })));

  const plot = renderCharPlot({
    width: Math.min(ctx.width, 72),
    height: 9,
    points: points.map((p) => ({ mark: marks.get(p.key) ?? "•", x: p.x, y: p.y })),
    xDomain,
    yDomain,
    lines,
    xLabel: axes.xField,
    yLabel: axes.yField,
    // 刻度精度跟随整齐步长,与 web 面同一支:传值域跨度会让 $0.35045992 这种原始值直接
    // 印到轴上(步长的小数位数才是精度)。
    formatX: (v) =>
      axes.xMeta.kind === "dimension"
        ? (points.find((point) => point.x === Math.round(v))?.xLabel ?? "")
        : formatAxisTick(v, tickStepOf(ticksInDomain(xDomain[0], xDomain[1], 5)), axes.xMeta.unit),
    formatY: (v) =>
      axes.yMeta.kind === "dimension"
        ? (points.find((point) => point.y === Math.round(v))?.yLabel ?? "")
        : formatAxisTick(v, tickStepOf(ticksInDomain(yDomain[0], yDomain[1], 5)), axes.yMeta.unit),
    invertX: axes.xMeta.better === "lower",
    invertY: axes.yMeta.better === "lower",
  });

  const values = renderScatterValuesText(groups, marks, axes, locale);
  const missingNote = missing > 0 ? `\n${countText(locale, "pointsMissing", missing)}` : "";
  return `${plot}\n\n${values}${missingNote}`;
}

/** 图例分组:一个显示键一组。series 绑了维度时按维度值分组,否则整个 series 一组。 */
interface LegendGroup {
  readonly key: string;
  readonly mark: MappedSeries["mark"];
  readonly connect: boolean;
  readonly points: readonly MappedSeries["points"][number][];
}

/** 显示键字典序,组内按 x 原始值升序——图例顺序即标记字母顺序,两处不各自排序。 */
function legendGroups(visible: readonly MappedSeries[]): LegendGroup[] {
  const byKey = new Map<string, { key: string; mark: MappedSeries["mark"]; connect: boolean; points: MappedSeries["points"][number][] }>();
  for (const series of visible) {
    for (const point of series.points) {
      const key = point.seriesValue ?? series.id;
      let group = byKey.get(key);
      if (group === undefined) {
        group = { key, mark: series.mark, connect: series.connect === true, points: [] };
        byKey.set(key, group);
      }
      group.points.push(point);
    }
  }
  const groups = [...byKey.values()];
  groups.sort((a, b) => a.key.localeCompare(b.key));
  for (const group of groups) group.points.sort((a, b) => a.x - b.x);
  return groups;
}

/**
 * 散点 / 折线的 text 面读值块:两轴都声明了 better 时先给一行方向提示,随后一张读值表
 * (标记字母、系列、点名与两轴终值),最后给连线系列的位移摘要。字母、系列顺序与图上一致。
 * 位移摘要的符号是原始差值,方向好坏由读数的 better 语义判断,摘要不替读者下结论。
 */
function renderScatterValuesText(
  groups: readonly LegendGroup[],
  marks: ReadonlyMap<string, string>,
  axes: ReturnType<typeof resolveChartAxes>,
  locale: RL,
): string {
  const blocks: string[] = [];
  if (axes.xMeta.better !== undefined && axes.yMeta.better !== undefined) {
    blocks.push(localeText(locale, "scatter.betterUpperRight"));
  }
  const multiSeries = groups.length > 1;
  const rows = groups.flatMap((group) =>
    group.points.map((point) => ({
      mark: marks.get(point.key) ?? "•",
      ...(multiSeries ? { series: group.key } : {}),
      key: point.pointLabel,
      x: metricDisplay(point, "x", axes.xMeta, locale),
      y: metricDisplay(point, "y", axes.yMeta, locale),
    })),
  );
  blocks.push(
    renderCoordinateTable(rows, {
      mark: "",
      ...(multiSeries ? { series: localeText(locale, "chart.series") } : {}),
      key: "key",
      x: axes.xField,
      y: axes.yField,
    }),
  );
  const shifts = groups
    .filter((group) => group.connect)
    .map((group) => {
      const summary = shiftSummary(group, axes, locale);
      if (summary === undefined) return undefined;
      const path = group.points.map((point) => marks.get(point.key) ?? "•").join(" → ");
      return `${group.key}   ${path}   ${summary}`;
    })
    .filter((line): line is string => line !== undefined);
  if (shifts.length > 0) blocks.push(shifts.join("\n"));
  return blocks.join("\n\n");
}

/** 一条线首尾两点的原始差值:`通过率 +25pt · 成本 +$0.20`。百分比读数按百分点报,不按倍数。 */
function shiftSummary(
  group: LegendGroup,
  axes: ReturnType<typeof resolveChartAxes>,
  locale: RL,
): string | undefined {
  if (group.points.length < 2) return undefined;
  const first = group.points[0]!;
  const last = group.points[group.points.length - 1]!;
  const parts: string[] = [];
  for (const axis of ["y", "x"] as const) {
    const meta = axis === "y" ? axes.yMeta : axes.xMeta;
    if (meta.kind !== "metric") continue;
    const label = chartFieldLabel(axis === "y" ? axes.yField : axes.xField, meta, locale);
    parts.push(`${label} ${signedDelta(last[axis] - first[axis], meta.unit, locale)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** 带符号的差值:百分比记百分点(`+25pt`),其余按读数自己的单位格式化。 */
function signedDelta(delta: number, unit: string | undefined, locale: RL): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const abs = Math.abs(delta);
  if (unit === "%") {
    const points = abs * 100;
    return `${sign}${Number.isInteger(points) ? points : points.toFixed(1)}pt`;
  }
  return `${sign}${formatMetricValue(abs, unit, undefined, locale)}`;
}

export const Series = defineComponent<SeriesProps>({
  dimensions: () => ({}),
  web: () => null,
  text: () => "",
});
Series.displayName = "Series";

export const Chart = defineComponent<ChartProps>({
  dimensions(props) {
    const chartProps = props as ChartProps;
    const data = chartProps.data;
    if (!data || !isDataset(data)) return {};
    const specs = seriesNodesOf(chartProps.children);
    const axes = resolveChartAxes(data, chartProps.x, chartProps.y);
    const { series } = mapChartSeries(data, axes, specs, chartProps.series);
    const decls: globalThis.Record<string, DimensionDeclarations[string]> = {};
    for (const spec of specs) {
      if (spec.by === undefined) continue;
      const values = seriesDimensionValues(series, spec.by);
      if (values.length === 0) continue;
      decls[spec.by] = {
        dimension: spec.by,
        // area 是 FillSeriesPresentation(填充图案),不再折叠成 line。
        encoding: { kind: "series", mark: spec.mark },
        values,
      };
    }
    const implicit = series.filter((item) => item.byField === undefined && !item.hidden);
    if (implicit.length > 1) {
      decls[IMPLICIT_SERIES_HANDLE] = {
        dimension: "series",
        encoding: { kind: "series", mark: implicit[0]!.mark },
        values: implicit.map((item) => item.id),
      };
    }
    return decls;
  },
  web(props, ctx) {
    const data = assertDataset(props.data);
    const specs = seriesNodesOf(props.children);
    validateChart(data, specs, props.x, props.y);
    const axes = resolveChartAxes(data, props.x, props.y);
    const { series, missing } = mapChartSeries(data, axes, specs, props.series);
    const locale = props.locale ?? ctx.locale;
    const node = renderChartWeb(series, axes, locale, ctx, {
      layout: props.layout,
      legend: props.legend,
      grid: props.grid,
      pointTarget: props.pointTarget,
      className: props.className,
    });
    const missingNote =
      missing > 0 ? (
        <p className="niceeval-chart-missing" title={String(missing)}>
          {countText(locale, "pointsMissing", missing)}
        </p>
      ) : null;
    return (
      <>
        {node}
        {missingNote}
      </>
    );
  },
  text(props, ctx) {
    const data = assertDataset(props.data);
    return chartText(data, props, ctx);
  },
});
Chart.displayName = "Chart";
