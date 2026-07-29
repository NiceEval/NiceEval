// Chart 原语:消费 Dataset,用 x/y 与 <Series> 映射坐标与 mark(docs/feature/reports/components/charts/README.md)。

import type { ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import { defineComponent, type ReportNode, type TextContext, type WebContext } from "../tree.ts";
import type { DimensionDeclarations } from "../../presentation.ts";
import type { Dataset, DatasetField } from "../../model/types.ts";
import type { ReportLocale } from "../../model/locale.ts";
import { countText, localeText, resolveLocalizedText, type ReportLocale as RL } from "../../model/locale.ts";
import { formatAxisTick, formatMetricValue, shortestUniqueLabels } from "../../model/format.ts";
import { axisScale, paddedAxisDomain, placePointLabels, tickStepOf } from "../../model/chart/math.ts";
import { renderCharPlot, renderCoordinateTable } from "../../model/chart/plot.ts";
import { padDisplay, padStartDisplay, stringWidth, textBar } from "../../model/text-layout.ts";
import { dataShapeError, type ValueProps } from "../../components/shared.ts";
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
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
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

function seriesClass(
  mapped: MappedSeries[],
  series: MappedSeries,
  point: MappedSeries["points"][number],
  ctx: WebContext,
): string {
  let handle: string;
  let index: number;
  if (series.byField !== undefined && point.seriesValue !== undefined) {
    handle = series.byField;
    index = seriesDimensionValues(mapped, series.byField).indexOf(point.seriesValue);
  } else {
    const ids = mapped.filter((item) => !item.hidden && item.byField === undefined).map((item) => item.id);
    if (ids.length < 2) return "niceeval-series-none";
    handle = IMPLICIT_SERIES_HANDLE;
    index = ids.indexOf(series.id);
  }
  const colorIndex = ctx.dimension(handle).at(index).colorIndex;
  return colorIndex === undefined ? "niceeval-series-none" : `niceeval-series-c${colorIndex - 1}`;
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
          const colorClass =
            presentation?.colorIndex === undefined
              ? "niceeval-series-none"
              : `niceeval-series-c${presentation.colorIndex - 1}`;
          return (
            <li
              key={`${series.id}:${value}`}
              className={cx("niceeval-chart-legend-item", colorClass)}
            >
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
  options: { legend?: boolean; attemptHref?: (locator: AttemptLocator) => string; className?: string },
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
      <div className="niceeval-chart-bars-heading">
        {chartFieldLabel(axes.yField, axes.yMeta, locale)}
      </div>
      <ol className="niceeval-chart-bars">
        {entries.map(({ series, point }) => {
          const rawLabel = point.xLabel ?? point.pointLabel;
          const label = labels.get(rawLabel) ?? rawLabel;
          const display = metricDisplay(point, "y", axes.yMeta, locale);
          const href = options.attemptHref && point.refs[0]
            ? options.attemptHref(point.refs[0] as AttemptLocator)
            : undefined;
          const colorClass = seriesClass(mapped, series, point, ctx);
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
    attemptHref?: (locator: AttemptLocator) => string;
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
    series.points.map((point) => ({
      ...point,
      sourceSeriesId: series.id,
      label: labelByKey.get(point.pointLabel) ?? point.pointLabel,
      px: xScale.scale(point.x),
      py: yScale.scale(point.y),
      seriesClass: seriesClass(mapped, series, point, ctx),
    })),
  );

  const labels = placePointLabels(
    drawable.map((p) => ({ cx: p.px, cy: p.py, width: p.label.length * 6.4 + 10 })),
    { x0: 2, y0: 2, x1: WIDTH - 2, y1: HEIGHT - 2 },
  );

  return (
    <figure className={cx("niceeval-report", "niceeval-chart", "niceeval-chart--scatter", options.className)}>
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
            const seriesClass = ordered[0]?.seriesClass ?? "niceeval-series-none";
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
            return (
              <g
                key={`${series.id}:${value}`}
                className={cx("niceeval-chart-series", seriesClass)}
                data-series={`${series.id}:${value}`}
              >
              {series.mark === "area" && ordered.length > 1 ? (
                <polygon
                  className="niceeval-chart-area"
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
                  strokeDasharray={lineDash(series.line)}
                />
              ) : null}
              {ordered.map((p) => {
                const placed = labels[drawable.indexOf(p)];
                const href = options.attemptHref && p.refs[0] ? options.attemptHref(p.refs[0] as AttemptLocator) : undefined;
                let shape: ReactNode;
                if (series.mark === "bar") {
                  const baseValue = stackedBarBase(visible, series, p.x);
                  const baseY = yScale.scale(baseValue);
                  const topY = yScale.scale(baseValue + p.y);
                  shape = (
                    <rect
                      className={cx("niceeval-chart-bar", p.seriesClass)}
                      x={p.px - totalBarWidth / 2 + groupIndex * barWidth}
                      y={Math.min(topY, baseY)}
                      width={barWidth}
                      height={Math.max(1, Math.abs(baseY - topY))}
                    >
                      <title>{`${p.pointLabel}\n${series.id}: ${metricDisplay(p, "y", axes.yMeta, locale)}`}</title>
                    </rect>
                  );
                } else {
                  shape = (
                  <circle className={cx("niceeval-chart-dot", p.seriesClass)} cx={p.px} cy={p.py} r={4.5}>
                    <title>{`${p.pointLabel}\n${axes.xField}: ${metricDisplay(p, "x", axes.xMeta, locale)}\n${axes.yField}: ${metricDisplay(p, "y", axes.yMeta, locale)}`}</title>
                  </circle>
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

  const marks = new Map<string, string>();
  visible.forEach((s, si) => {
    for (const p of s.points) marks.set(p.key, seriesMarkChar(s.mark, si));
  });

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
    formatX: (v, step) =>
      axes.xMeta.kind === "dimension"
        ? (points.find((point) => point.x === Math.round(v))?.xLabel ?? "")
        : formatAxisTick(v, step ?? tickStepOf(paddedAxisDomain([v])), axes.xMeta.unit),
    formatY: (v, step) =>
      axes.yMeta.kind === "dimension"
        ? (points.find((point) => point.y === Math.round(v))?.yLabel ?? "")
        : formatAxisTick(v, step ?? tickStepOf(paddedAxisDomain([v])), axes.yMeta.unit),
    invertX: axes.xMeta.better === "lower",
    invertY: axes.yMeta.better === "lower",
  });

  const table = renderCoordinateTable(
    points.map((point) => ({
      key: point.pointLabel,
      x: metricDisplay(point, "x", axes.xMeta, locale),
      y: metricDisplay(point, "y", axes.yMeta, locale),
    })),
    { key: "key", x: axes.xField, y: axes.yField },
  );

  const missingNote = missing > 0 ? `\n${countText(locale, "pointsMissing", missing)}` : "";
  return `${plot}\n\n${table}${missingNote}`;
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
        encoding: { kind: "series", mark: spec.mark === "area" ? "line" : spec.mark },
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
      attemptHref: props.attemptHref ?? ctx.attemptHref,
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
