// Chart 原语:消费 Dataset,用 x/y 与 <Series> 映射坐标与 mark(docs/feature/reports/components/charts/README.md)。

import type { ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import { defineComponent, type ReportNode, type TextContext, type WebContext } from "../tree.ts";
import type { DimensionDeclarations } from "../../presentation.ts";
import type { SourceInput } from "../../source.ts";
import type { Dataset } from "../../model/types.ts";
import type { ReportLocale } from "../../model/locale.ts";
import { countText, localeText, type ReportLocale as RL } from "../../model/locale.ts";
import { formatTickValue, shortestUniqueLabels } from "../../model/format.ts";
import { axisScale, paddedAxisDomain, placePointLabels, tickStepOf } from "../../components/metric-views/chart-math.ts";
import { renderCharPlot, renderCoordinateTable } from "../../components/metric-views/plot.ts";
import { dataShapeError, type DataProps } from "../../components/shared.ts";
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

export type ChartProps<Input extends SourceInput = SourceInput> = DataProps<
  Dataset,
  globalThis.Record<never, never>,
  ChartPresentation & { x: ChartAxisBinding; y: ChartAxisBinding },
  Input
>;

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

function renderScatterWeb(
  mapped: MappedSeries[],
  axes: ReturnType<typeof resolveChartAxes>,
  locale: RL,
  ctx: WebContext,
  options: { legend?: boolean; grid?: boolean; attemptHref?: (locator: AttemptLocator) => string; className?: string },
): ReactNode {
  const visible = mapped.filter((s) => !s.hidden && s.mark === "scatter");
  const allPoints = visible.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return (
      <figure className={cx("nre", "nre-chart", "nre-chart--scatter", options.className)}>
        <p className="nre-chart-empty nre-missing">{localeText(locale, "cell.missing")}</p>
      </figure>
    );
  }

  const xBounds = axes.xMeta.kind === "measure" ? axes.xMeta.bounds : undefined;
  const yBounds = axes.yMeta.kind === "measure" ? axes.yMeta.bounds : undefined;
  const xScale = axisScale(
    allPoints.map((p) => p.x),
    xBounds,
    MARGIN.left,
    MARGIN.left + PLOT_W,
    axes.xMeta.better === "lower",
  );
  const yScale = axisScale(
    allPoints.map((p) => p.y),
    yBounds,
    MARGIN.top + PLOT_H,
    MARGIN.top,
    axes.yMeta.better === "lower",
  );
  const labelByKey = shortestUniqueLabels(allPoints.map((p) => p.pointLabel));

  const drawable = allPoints.map((p) => {
    const series = visible.find((s) => s.points.some((sp) => sp.key === p.key));
    const seriesValue = p.seriesValue;
    const slot =
      series?.byField !== undefined && seriesValue !== undefined
        ? ctx.dimension(series.byField).at(seriesDimensionValues(mapped, series.byField).indexOf(seriesValue)).seriesSlot
        : undefined;
    return {
      ...p,
      label: labelByKey.get(p.pointLabel) ?? p.pointLabel,
      px: xScale.scale(p.x),
      py: yScale.scale(p.y),
      seriesClass: slot !== undefined ? `nre-series-c${slot}` : "nre-series-none",
    };
  });

  const labels = placePointLabels(
    drawable.map((p) => ({ cx: p.px, cy: p.py, width: p.label.length * 6.4 + 10 })),
    { x0: 2, y0: 2, x1: WIDTH - 2, y1: HEIGHT - 2 },
  );

  return (
    <figure className={cx("nre", "nre-chart", "nre-chart--scatter", options.className)}>
      <svg className="nre-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${axes.xField} × ${axes.yField}`}>
        {options.grid !== false ? (
          <g className="nre-chart-grid">
            {yScale.ticks.map((tick) => (
              <line key={`gy${tick}`} x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={yScale.scale(tick)} y2={yScale.scale(tick)} />
            ))}
            {xScale.ticks.map((tick) => (
              <line key={`gx${tick}`} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} x1={xScale.scale(tick)} x2={xScale.scale(tick)} />
            ))}
          </g>
        ) : null}
        <g className="nre-chart-axis nre-chart-axis-y">
          {yScale.ticks.map((tick) => (
            <text key={`ay${tick}`} className="nre-chart-tick" x={MARGIN.left - 8} y={yScale.scale(tick) + 3} textAnchor="end">
              {formatTickValue(tick, tickStepOf(yScale.ticks), axes.yMeta.unit)}
            </text>
          ))}
        </g>
        <g className="nre-chart-axis nre-chart-axis-x">
          {xScale.ticks.map((tick) => (
            <text key={`ax${tick}`} className="nre-chart-tick" x={xScale.scale(tick)} y={MARGIN.top + PLOT_H + 16} textAnchor="middle">
              {formatTickValue(tick, tickStepOf(xScale.ticks), axes.xMeta.unit)}
            </text>
          ))}
        </g>
        <text className="nre-chart-xlabel" x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 8} textAnchor="middle">
          {axes.xField}
        </text>
        <text
          className="nre-chart-ylabel"
          x={14}
          y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${MARGIN.top + PLOT_H / 2})`}
        >
          {axes.yField}
        </text>
        {visible.map((series) => {
          const seriesPoints = drawable.filter((p) => series.points.some((sp) => sp.key === p.key));
          const ordered = series.connect ? [...seriesPoints].sort((a, b) => a.x - b.x) : seriesPoints;
          return (
            <g key={series.id} className="nre-chart-series" data-series={series.id}>
              {series.connect && ordered.length > 1 ? (
                <polyline
                  className="nre-chart-line"
                  points={ordered.map((p) => `${p.px},${p.py}`).join(" ")}
                  strokeDasharray={lineDash(series.line)}
                />
              ) : null}
              {ordered.map((p) => {
                const placed = labels[drawable.indexOf(p)];
                const href = options.attemptHref && p.refs[0] ? options.attemptHref(p.refs[0] as AttemptLocator) : undefined;
                const dot = (
                  <circle className={cx("nre-chart-dot", p.seriesClass)} cx={p.px} cy={p.py} r={4.5}>
                    <title>{`${p.pointLabel}\n${axes.xField}: ${p.x}\n${axes.yField}: ${p.y}`}</title>
                  </circle>
                );
                return (
                  <g key={p.key} className="nre-chart-point">
                    {href ? <a href={href}>{dot}</a> : dot}
                    {placed ? (
                      <text className="nre-chart-point-label" x={placed.x} y={placed.y} textAnchor={placed.anchor}>
                        {p.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {options.legend ? (
        <ul className="nre-chart-legend">
          {visible.flatMap((series) => {
            const byValues = series.byField ? seriesDimensionValues(mapped, series.byField) : [series.id];
            return byValues.map((value) => {
              const idx = series.byField ? seriesDimensionValues(mapped, series.byField).indexOf(value) : 0;
              const label = series.byField ? ctx.dimension(series.byField).at(idx).label : series.id;
              return (
                <li key={`${series.id}:${value}`} className="nre-chart-legend-item">
                  {label}
                </li>
              );
            });
          })}
        </ul>
      ) : null}
    </figure>
  );
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

  const xBounds = axes.xMeta.kind === "measure" ? axes.xMeta.bounds : undefined;
  const yBounds = axes.yMeta.kind === "measure" ? axes.yMeta.bounds : undefined;
  const xDomain = paddedAxisDomain(points.map((p) => p.x), xBounds);
  const yDomain = paddedAxisDomain(points.map((p) => p.y), yBounds);

  const marks = new Map<string, string>();
  visible.forEach((s, si) => {
    for (const p of s.points) marks.set(p.key, seriesMarkChar(s.mark, si));
  });

  const lines = visible
    .filter((s) => s.connect && (s.mark === "line" || s.mark === "scatter"))
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
    formatX: (v, step) => formatTickValue(v, step ?? tickStepOf(paddedAxisDomain([v])), axes.xMeta.unit),
    formatY: (v, step) => formatTickValue(v, step ?? tickStepOf(paddedAxisDomain([v])), axes.yMeta.unit),
    invertX: axes.xMeta.better === "lower",
    invertY: axes.yMeta.better === "lower",
  });

  const table = renderCoordinateTable(
    points.map((p) => ({ key: p.pointLabel, x: String(p.x), y: String(p.y) })),
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
    return decls;
  },
  web(props, ctx) {
    const data = assertDataset(props.data);
    const specs = seriesNodesOf(props.children);
    validateChart(data, specs, props.x, props.y);
    const axes = resolveChartAxes(data, props.x, props.y);
    const { series, missing } = mapChartSeries(data, axes, specs, props.series);
    const locale = props.locale ?? ctx.locale;
    const node = renderScatterWeb(series, axes, locale, ctx, {
      legend: props.legend,
      grid: props.grid,
      attemptHref: props.attemptHref ?? ctx.attemptHref,
      className: props.className,
    });
    const missingNote =
      missing > 0 ? (
        <p className="nre-chart-missing" title={String(missing)}>
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
