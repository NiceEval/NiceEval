import {
  metricValue,
  reportClosedValueText,
} from "./presentation.ts";
import { compactMetricNumber } from "../classic/format.ts";
import type { ReportLocale } from "../classic/locale.ts";

/**
 * A deliberately small static SVG projection of an already-closed chart node.
 * It is only a renderer: values are never re-aggregated, fetched, or changed.
 */
export interface StaticChartSvgInput {
  readonly type: "bars" | "line" | "scatter";
  readonly title: string;
  readonly points: readonly unknown[];
  readonly x: string;
  readonly y: string;
  readonly color?: string;
  readonly series?: string;
  /** Display-only point identity field used by tooltip/label text. */
  readonly point?: string;
  /** Display-only closed Chart intent; it never changes the points or metrics. */
  readonly layout?: "horizontal" | "vertical";
  /** Metric directions orient numeric axes so better values remain upper-right. */
  readonly xBetter?: "higher" | "lower" | "neutral";
  readonly yBetter?: "higher" | "lower" | "neutral";
  /** Classic uses Analysis-owned semantic number formatting in its visual face. */
  readonly formatMetrics?: boolean;
  readonly locale?: ReportLocale;
}

interface ChartPoint {
  readonly index: number;
  readonly xKey: string;
  readonly xLabel: string;
  readonly xNumeric: number | undefined;
  readonly xValue: unknown;
  readonly y: number;
  readonly yValue: unknown;
  readonly pointLabel: string;
  readonly categoryKey: string;
  readonly categoryLabel: string;
}

interface ChartCategory {
  readonly key: string;
  readonly label: string;
  readonly index: number;
}

interface PlotBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface NumericScale {
  readonly min: number;
  readonly max: number;
  readonly map: (value: number) => number;
}

interface ChartLegend {
  readonly markup: string;
  readonly rows: number;
}

const SVG_WIDTH = 720;
const SVG_HEIGHT = 360;
const PLOT_LEFT = 68;
const PLOT_RIGHT = 22;
const PLOT_BOTTOM = 54;
const SERIES_COLORS = 6;

/**
 * Builds one deterministic, self-contained SVG from closed points. The caller
 * keeps the source data table in the HTML directly after this image.
 */
export function renderStaticChartSvg(input: StaticChartSvgInput): string | undefined {
  const points = chartPoints(input);
  if (points.length === 0) return undefined;

  const categories = chartCategories(points, input.series ?? input.color);
  const legend = chartLegend(categories);
  const plot = plotBox(legend.rows);
  const body = input.type === "bars"
    ? input.layout === "horizontal"
      ? renderHorizontalBars(points, categories, plot, input)
      : renderBars(points, categories, plot, input)
    : input.type === "line"
      ? renderLine(points, categories, plot, input)
      : renderScatter(points, categories, plot, input);
  const label = `${input.title} ${chartKind(input.type)} chart`;
  const description = `${points.length} closed point${points.length === 1 ? "" : "s"} with ${input.x} on the x axis and ${input.y} on the y axis. The complete data table follows the chart.`;
  return `<svg class="niceeval-report__chart-svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="${escapeXmlAttribute(label)}" preserveAspectRatio="xMidYMid meet"><title>${escapeXmlText(label)}</title><desc>${escapeXmlText(description)}</desc>${legend.markup}${renderBetterHint(input, plot)}${body}</svg>`;
}

/**
 * Classic's horizontal Bars face is intentionally HTML rather than a tiny
 * generic SVG. It projects the closed points as supplied: it never sorts,
 * aggregates, or substitutes a missing metric. The complete source table is
 * still rendered by the Host immediately after this compact overview.
 */
export function renderClassicHorizontalBarsHtml(input: StaticChartSvgInput): string | undefined {
  if (input.type !== "bars" || input.layout !== "horizontal") return undefined;
  const categoryField = input.series ?? input.color;
  const rows: Array<{
    readonly label: string;
    readonly value: number | undefined;
    readonly valueText: string;
    readonly status: string | undefined;
    readonly categoryKey: string;
    readonly categoryLabel: string;
    readonly categoryIndex: number;
  }> = [];
  const categoryIndexes = new Map<string, number>();
  let boundsMaximum: number | undefined;

  for (const point of input.points) {
    const record = dataRecord(point);
    if (record === undefined) continue;
    const yValue = record[input.y];
    const metric = metricValue(yValue);
    const value = chartNumber(yValue);
    // Non-metric, non-numeric cells have no visual bar. Their closed source
    // remains visible in the text-equivalent data table.
    if (value === undefined && metric === undefined) continue;
    const categoryValue = categoryField === undefined ? undefined : record[categoryField];
    const categoryKey = categoryField === undefined ? "" : valueKey(categoryValue);
    let categoryIndex = categoryIndexes.get(categoryKey);
    if (categoryIndex === undefined) {
      categoryIndex = categoryIndexes.size;
      categoryIndexes.set(categoryKey, categoryIndex);
    }
    if (metric?.bounds?.max !== undefined && Number.isFinite(metric.bounds.max)) {
      boundsMaximum = Math.max(boundsMaximum ?? Number.NEGATIVE_INFINITY, metric.bounds.max);
    }
    rows.push(Object.freeze({
      label: chartValueText(record[input.x], input),
      value,
      valueText: chartValueText(yValue, input),
      status: metric === undefined ? undefined : classicMetricStatusText(metric, input.locale),
      categoryKey,
      categoryLabel: categoryField === undefined ? "" : chartValueText(categoryValue, input),
      categoryIndex,
    }));
  }

  if (rows.length === 0) return undefined;
  const largestMagnitude = Math.max(
    boundsMaximum ?? 0,
    ...rows.map((row) => row.value === undefined ? 0 : Math.abs(row.value)),
  );
  const maximum = largestMagnitude > 0 ? largestMagnitude : 1;
  const legend = categoryField === undefined
    ? ""
    : `<ul class="niceeval-classic-chart-legend" aria-label="${escapeXmlAttribute(input.series === undefined ? "Color legend" : "Series legend")}">${[...categoryIndexes.entries()].map(([key, index]) => {
      const row = rows.find((candidate) => candidate.categoryKey === key);
      if (row === undefined) return "";
      const className = classicSeriesClass(index);
      return `<li><span class="niceeval-classic-chart-legend-swatch ${className}" aria-hidden="true"></span><span>${escapeXmlText(row.categoryLabel)}</span></li>`;
    }).join("")}</ul>`;
  const bars = rows.map((row) => {
    const width = row.value === undefined ? 0 : Math.min(100, Math.abs(row.value) / maximum * 100);
    const className = classicSeriesClass(row.categoryIndex);
    const state = row.status === undefined ? "" : `<small class="niceeval-classic-chart-bar-status">${escapeXmlText(row.status)}</small>`;
    const negative = row.value !== undefined && row.value < 0 ? " data-negative=\"true\"" : "";
    const title = [row.label, row.valueText, row.categoryLabel, row.status].filter((part): part is string => part !== undefined && part.length > 0).join(" · ");
    return `<li class="niceeval-classic-chart-bar-row"${negative}><span class="niceeval-classic-chart-bar-label" title="${escapeXmlAttribute(row.label)}">${escapeXmlText(row.label)}</span><span class="niceeval-classic-chart-bar-track"><span class="niceeval-classic-chart-bar-fill ${className}" style="inline-size:${coordinate(width)}%" title="${escapeXmlAttribute(title)}"></span></span><span class="niceeval-classic-chart-bar-end"><data value="${escapeXmlAttribute(row.value === undefined ? "" : String(row.value))}">${escapeXmlText(row.valueText)}</data>${state}</span></li>`;
  }).join("");
  return `<div class="niceeval-classic-chart-bars" aria-label="${escapeXmlAttribute(`${input.title} ranked bars`)}"><ol>${bars}</ol>${legend}</div>`;
}

function chartPoints(input: StaticChartSvgInput): readonly ChartPoint[] {
  const categoryField = input.series ?? input.color;
  const points: ChartPoint[] = [];
  for (const [index, point] of input.points.entries()) {
    const row = dataRecord(point);
    if (row === undefined) continue;
    const yValue = row[input.y];
    const y = chartNumber(yValue);
    if (y === undefined) continue;
    const xValue = row[input.x];
    const xLabel = chartValueText(xValue, input);
    const identityValue = input.point === undefined ? xValue : row[input.point];
    const categoryValue = categoryField === undefined ? undefined : row[categoryField];
    points.push(Object.freeze({
      index,
      xKey: valueKey(xValue),
      xLabel,
      xNumeric: chartNumber(xValue),
      xValue,
      y,
      yValue,
      pointLabel: input.point === undefined ? xLabel : chartValueText(identityValue, input),
      categoryKey: categoryField === undefined ? "" : valueKey(categoryValue),
      categoryLabel: categoryField === undefined ? "" : chartValueText(categoryValue, input),
    }));
  }
  return Object.freeze(points);
}

function chartCategories(points: readonly ChartPoint[], categoryField: string | undefined): readonly ChartCategory[] {
  if (categoryField === undefined) return Object.freeze([]);
  const categories = new Map<string, ChartCategory>();
  for (const point of points) {
    if (categories.has(point.categoryKey)) continue;
    categories.set(point.categoryKey, Object.freeze({
      key: point.categoryKey,
      label: point.categoryLabel,
      index: categories.size,
    }));
  }
  return Object.freeze([...categories.values()]);
}

function plotBox(legendRows: number): PlotBox {
  const top = legendRows === 0 ? 24 : Math.min(82, 24 + legendRows * 18);
  const right = SVG_WIDTH - PLOT_RIGHT;
  const bottom = SVG_HEIGHT - PLOT_BOTTOM;
  return Object.freeze({
    left: PLOT_LEFT,
    right,
    top,
    bottom,
    width: right - PLOT_LEFT,
    height: bottom - top,
  });
}

function chartLegend(categories: readonly ChartCategory[]): ChartLegend {
  if (categories.length === 0) return Object.freeze({ markup: "", rows: 0 });
  const visible = categories.length > 8
    ? [...categories.slice(0, 7), Object.freeze({ key: "more", label: `+${categories.length - 7} more`, index: 0 })]
    : categories;
  let x = PLOT_LEFT;
  let y = 16;
  let row = 0;
  const items: string[] = [];
  for (const category of visible) {
    const label = truncate(category.label, 20);
    const width = 19 + Math.max(24, label.length * 6.2);
    if (x + width > SVG_WIDTH - PLOT_RIGHT && x > PLOT_LEFT) {
      x = PLOT_LEFT;
      y += 18;
      row += 1;
    }
    const className = category.key === "more" ? "" : ` niceeval-report__chart-series-${category.index % SERIES_COLORS}`;
    const marker = category.key === "more"
      ? `<rect class="niceeval-report__chart-legend-marker" x="${coordinate(x)}" y="${coordinate(y - 8)}" width="8" height="8" rx="2"></rect>`
      : `<rect class="niceeval-report__chart-legend-marker${className}" x="${coordinate(x)}" y="${coordinate(y - 8)}" width="8" height="8" rx="2"></rect>`;
    items.push(`<g class="niceeval-report__chart-legend-item">${marker}<text x="${coordinate(x + 12)}" y="${coordinate(y)}">${escapeXmlText(label)}</text></g>`);
    x += width;
  }
  return Object.freeze({
    markup: `<g class="niceeval-report__chart-legend">${items.join("")}</g>`,
    rows: row + 1,
  });
}

function renderBars(
  points: readonly ChartPoint[],
  categories: readonly ChartCategory[],
  plot: PlotBox,
  input: StaticChartSvgInput,
): string {
  const groups = groupedBy(points, (point) => point.xKey);
  const yScale = numericScaleForBetter(points.map((point) => point.y), plot.bottom, plot.top, true, input.yBetter);
  const categoryLookup = new Map(categories.map((category) => [category.key, category]));
  const bars: string[] = [];
  for (const [groupIndex, group] of [...groups.values()].entries()) {
    const groupWidth = plot.width / groups.size;
    const usableWidth = Math.max(1, groupWidth * 0.76);
    const barWidth = Math.max(1, usableWidth / group.length);
    const start = plot.left + groupIndex * groupWidth + (groupWidth - usableWidth) / 2;
    for (const [barIndex, point] of group.entries()) {
      const baseline = yScale.map(0);
      const y = yScale.map(point.y);
      const top = Math.min(y, baseline);
      const height = Math.max(0.75, Math.abs(baseline - y));
      const category = categoryLookup.get(point.categoryKey);
      const className = chartSeriesClass(category);
      const detail = point.categoryLabel === "" ? "" : ` · ${point.categoryLabel}`;
      bars.push(`<rect class="niceeval-report__chart-bar${className}" x="${coordinate(start + barIndex * barWidth + 0.5)}" y="${coordinate(top)}" width="${coordinate(Math.max(0.5, barWidth - 1))}" height="${coordinate(height)}" rx="2"><title>${escapeXmlText(`${point.pointLabel}: ${chartPointValueText(point, "y", input)}${detail}`)}</title></rect>`);
    }
  }
  const xLabels = [...groups.values()].map((group) => group[0]!.xLabel);
  return `${renderYAxis(yScale, plot, input.y, input)}${renderCategoricalXAxis(xLabels, plot, input.x, true)}<g class="niceeval-report__chart-marks">${bars.join("")}</g>`;
}

function renderHorizontalBars(
  points: readonly ChartPoint[],
  categories: readonly ChartCategory[],
  plot: PlotBox,
  input: StaticChartSvgInput,
): string {
  const groups = groupedBy(points, (point) => point.xKey);
  const xScale = numericScaleForBetter(points.map((point) => point.y), plot.left, plot.right, true, input.yBetter);
  const categoryLookup = new Map(categories.map((category) => [category.key, category]));
  const bars: string[] = [];
  for (const [groupIndex, group] of [...groups.values()].entries()) {
    const groupHeight = plot.height / groups.size;
    const usableHeight = Math.max(1, groupHeight * 0.76);
    const barHeight = Math.max(1, usableHeight / group.length);
    const start = plot.top + groupIndex * groupHeight + (groupHeight - usableHeight) / 2;
    for (const [barIndex, point] of group.entries()) {
      const baseline = xScale.map(0);
      const x = xScale.map(point.y);
      const left = Math.min(x, baseline);
      const width = Math.max(0.75, Math.abs(baseline - x));
      const category = categoryLookup.get(point.categoryKey);
      const className = chartSeriesClass(category);
      const detail = point.categoryLabel === "" ? "" : ` · ${point.categoryLabel}`;
      bars.push(`<rect class="niceeval-report__chart-bar${className}" x="${coordinate(left)}" y="${coordinate(start + barIndex * barHeight + 0.5)}" width="${coordinate(width)}" height="${coordinate(Math.max(0.5, barHeight - 1))}" rx="2"><title>${escapeXmlText(`${point.pointLabel}: ${chartPointValueText(point, "y", input)}${detail}`)}</title></rect>`);
    }
  }
  const labels = [...groups.values()].map((group) => group[0]!.xLabel);
  return `${renderCategoricalYAxis(labels, plot, input.x)}${renderNumericXAxis(xScale, plot, input.y, input)}<g class="niceeval-report__chart-marks">${bars.join("")}</g>`;
}

function renderLine(
  points: readonly ChartPoint[],
  categories: readonly ChartCategory[],
  plot: PlotBox,
  input: StaticChartSvgInput,
): string {
  const categoryLookup = new Map(categories.map((category) => [category.key, category]));
  const x = xProjection(points, plot, input.xBetter);
  const y = numericScaleForBetter(points.map((point) => point.y), plot.bottom, plot.top, false, input.yBetter);
  const groups = groupedBy(points, (point) => point.categoryKey);
  const marks: string[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => x.sort(left, right));
    const category = categoryLookup.get(group[0]!.categoryKey);
    const className = chartSeriesClass(category);
    if (ordered.length > 1) {
      const path = ordered.map((point, index) => `${index === 0 ? "M" : "L"}${coordinate(x.map(point))} ${coordinate(y.map(point.y))}`).join(" ");
      marks.push(`<path class="niceeval-report__chart-line${className}" d="${path}"></path>`);
    }
    for (const point of ordered) {
      const detail = point.categoryLabel === "" ? "" : ` · ${point.categoryLabel}`;
      marks.push(`<circle class="niceeval-report__chart-point${className}" cx="${coordinate(x.map(point))}" cy="${coordinate(y.map(point.y))}" r="3.6"><title>${escapeXmlText(`${point.pointLabel}: ${chartPointValueText(point, "y", input)}${detail}`)}</title></circle>`);
    }
  }
  return `${renderYAxis(y, plot, input.y, input)}${renderXAxis(x, plot, input.x, input)}<g class="niceeval-report__chart-marks">${marks.join("")}</g>`;
}

function renderScatter(
  points: readonly ChartPoint[],
  categories: readonly ChartCategory[],
  plot: PlotBox,
  input: StaticChartSvgInput,
): string {
  const categoryLookup = new Map(categories.map((category) => [category.key, category]));
  const x = xProjection(points, plot, input.xBetter);
  const y = numericScaleForBetter(points.map((point) => point.y), plot.bottom, plot.top, false, input.yBetter);
  const marks = points.map((point) => {
    const category = categoryLookup.get(point.categoryKey);
    const className = chartSeriesClass(category);
    const detail = point.categoryLabel === "" ? "" : ` · ${point.categoryLabel}`;
    return `<circle class="niceeval-report__chart-point${className}" cx="${coordinate(x.map(point))}" cy="${coordinate(y.map(point.y))}" r="4"><title>${escapeXmlText(`${point.pointLabel}: ${chartPointValueText(point, "y", input)}${detail}`)}</title></circle>`;
  }).join("");
  return `${renderYAxis(y, plot, input.y, input)}${renderXAxis(x, plot, input.x, input)}<g class="niceeval-report__chart-marks">${marks}</g>`;
}

function xProjection(
  points: readonly ChartPoint[],
  plot: PlotBox,
  better: StaticChartSvgInput["xBetter"],
): {
  readonly map: (point: ChartPoint) => number;
  readonly sort: (left: ChartPoint, right: ChartPoint) => number;
  readonly axis: "numeric" | "categorical";
  readonly scale?: NumericScale;
  readonly labels?: readonly string[];
} {
  if (points.every((point) => point.xNumeric !== undefined)) {
    const scale = numericScaleForBetter(points.map((point) => point.xNumeric!), plot.left, plot.right, false, better);
    return Object.freeze({
      map: (point) => scale.map(point.xNumeric!),
      sort: (left, right) => left.xNumeric! - right.xNumeric! || left.index - right.index,
      axis: "numeric" as const,
      scale,
    });
  }
  const groups = groupedBy(points, (point) => point.xKey);
  const slots = new Map<string, number>();
  const labels: string[] = [];
  for (const [key, group] of groups) {
    slots.set(key, slots.size);
    labels.push(group[0]!.xLabel);
  }
  const width = groups.size <= 1 ? 0 : plot.width / (groups.size - 1);
  return Object.freeze({
    map: (point) => plot.left + (slots.get(point.xKey) ?? 0) * width,
    sort: (left, right) => (slots.get(left.xKey) ?? 0) - (slots.get(right.xKey) ?? 0) || left.index - right.index,
    axis: "categorical" as const,
    labels: Object.freeze(labels),
  });
}

function numericScaleForBetter(
  values: readonly number[],
  start: number,
  end: number,
  includeZero: boolean,
  better: StaticChartSvgInput["xBetter"] | StaticChartSvgInput["yBetter"],
): NumericScale {
  return better === "lower"
    ? numericScale(values, end, start, includeZero)
    : numericScale(values, start, end, includeZero);
}

function renderBetterHint(input: StaticChartSvgInput, plot: PlotBox): string {
  const x = input.xBetter !== undefined && input.xBetter !== "neutral";
  const y = input.yBetter !== undefined && input.yBetter !== "neutral";
  const label = input.type === "bars" && y
    ? input.layout === "horizontal" ? "better →" : "better ↑"
    : x && y ? "better → upper right"
    : x ? "better →"
    : y ? "better ↑"
    : undefined;
  return label === undefined
    ? ""
    : `<text class="niceeval-report__chart-better-hint" x="${coordinate(plot.right)}" y="${coordinate(plot.top + 14)}" text-anchor="end">${label}</text>`;
}

function renderXAxis(
  projection: ReturnType<typeof xProjection>,
  plot: PlotBox,
  label: string,
  input: StaticChartSvgInput,
): string {
  if (projection.axis === "numeric") return renderNumericXAxis(projection.scale!, plot, label, input);
  return renderCategoricalXAxis(projection.labels ?? Object.freeze([]), plot, label);
}

function renderYAxis(
  scale: NumericScale,
  plot: PlotBox,
  label: string,
  input: StaticChartSvgInput,
): string {
  const ticks = linearTicks(scale);
  const grid = ticks.map((tick) => {
    const y = scale.map(tick);
    return `<g><line class="niceeval-report__chart-grid-line" x1="${coordinate(plot.left)}" y1="${coordinate(y)}" x2="${coordinate(plot.right)}" y2="${coordinate(y)}"></line><text class="niceeval-report__chart-tick" x="${coordinate(plot.left - 9)}" y="${coordinate(y + 4)}" text-anchor="end">${escapeXmlText(formatChartAxisValue(tick, input, "y"))}</text></g>`;
  }).join("");
  const titleY = plot.top + plot.height / 2;
  return `<g class="niceeval-report__chart-axes">${grid}<line class="niceeval-report__chart-axis" x1="${coordinate(plot.left)}" y1="${coordinate(plot.top)}" x2="${coordinate(plot.left)}" y2="${coordinate(plot.bottom)}"></line><text class="niceeval-report__chart-axis-title" x="16" y="${coordinate(titleY)}" text-anchor="middle" transform="rotate(-90 16 ${coordinate(titleY)})">${escapeXmlText(label)}</text></g>`;
}

function renderCategoricalYAxis(labels: readonly string[], plot: PlotBox, label: string): string {
  if (labels.length === 0) return "";
  const visible = tickIndexes(labels.length, 9);
  const height = plot.height / labels.length;
  const ticks = visible.map((index) => {
    const y = plot.top + (index + 0.5) * height;
    const text = truncate(labels[index] ?? "", 14);
    return `<g><line class="niceeval-report__chart-grid-line" x1="${coordinate(plot.left)}" y1="${coordinate(y)}" x2="${coordinate(plot.right)}" y2="${coordinate(y)}"></line><text class="niceeval-report__chart-tick" x="${coordinate(plot.left - 9)}" y="${coordinate(y + 4)}" text-anchor="end"><title>${escapeXmlText(labels[index] ?? "")}</title>${escapeXmlText(text)}</text></g>`;
  }).join("");
  const titleY = plot.top + plot.height / 2;
  return `<g class="niceeval-report__chart-axes">${ticks}<line class="niceeval-report__chart-axis" x1="${coordinate(plot.left)}" y1="${coordinate(plot.top)}" x2="${coordinate(plot.left)}" y2="${coordinate(plot.bottom)}"></line><text class="niceeval-report__chart-axis-title" x="16" y="${coordinate(titleY)}" text-anchor="middle" transform="rotate(-90 16 ${coordinate(titleY)})">${escapeXmlText(label)}</text></g>`;
}

function renderNumericXAxis(
  scale: NumericScale,
  plot: PlotBox,
  label: string,
  input: StaticChartSvgInput,
): string {
  const ticks = linearTicks(scale);
  const labels = ticks.map((tick) => {
    const x = scale.map(tick);
    return `<g><line class="niceeval-report__chart-axis" x1="${coordinate(x)}" y1="${coordinate(plot.bottom)}" x2="${coordinate(x)}" y2="${coordinate(plot.bottom + 4)}"></line><text class="niceeval-report__chart-tick" x="${coordinate(x)}" y="${coordinate(plot.bottom + 18)}" text-anchor="middle">${escapeXmlText(formatChartAxisValue(tick, input, "x"))}</text></g>`;
  }).join("");
  return `<g class="niceeval-report__chart-axes"><line class="niceeval-report__chart-axis" x1="${coordinate(plot.left)}" y1="${coordinate(plot.bottom)}" x2="${coordinate(plot.right)}" y2="${coordinate(plot.bottom)}"></line>${labels}<text class="niceeval-report__chart-axis-title" x="${coordinate(plot.left + plot.width / 2)}" y="${coordinate(SVG_HEIGHT - 12)}" text-anchor="middle">${escapeXmlText(label)}</text></g>`;
}

function renderCategoricalXAxis(
  labels: readonly string[],
  plot: PlotBox,
  label: string,
  centered = false,
): string {
  if (labels.length === 0) return "";
  const visible = tickIndexes(labels.length, 7);
  const width = centered
    ? plot.width / labels.length
    : labels.length <= 1 ? 0 : plot.width / (labels.length - 1);
  const ticks = visible.map((index) => {
    const x = centered
      ? plot.left + (index + 0.5) * width
      : labels.length === 1 ? plot.left + plot.width / 2 : plot.left + index * width;
    const text = truncate(labels[index] ?? "", 14);
    return `<g><line class="niceeval-report__chart-axis" x1="${coordinate(x)}" y1="${coordinate(plot.bottom)}" x2="${coordinate(x)}" y2="${coordinate(plot.bottom + 4)}"></line><text class="niceeval-report__chart-tick" x="${coordinate(x)}" y="${coordinate(plot.bottom + 18)}" text-anchor="middle"><title>${escapeXmlText(labels[index] ?? "")}</title>${escapeXmlText(text)}</text></g>`;
  }).join("");
  return `<g class="niceeval-report__chart-axes"><line class="niceeval-report__chart-axis" x1="${coordinate(plot.left)}" y1="${coordinate(plot.bottom)}" x2="${coordinate(plot.right)}" y2="${coordinate(plot.bottom)}"></line>${ticks}<text class="niceeval-report__chart-axis-title" x="${coordinate(plot.left + plot.width / 2)}" y="${coordinate(SVG_HEIGHT - 12)}" text-anchor="middle">${escapeXmlText(label)}</text></g>`;
}

function numericScale(values: readonly number[], start: number, end: number, includeZero = false): NumericScale {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * 0.12;
    min -= padding;
    max += padding;
  } else if (includeZero && min === 0) {
    max += (max - min) * 0.08;
  } else if (includeZero && max === 0) {
    min -= (max - min) * 0.08;
  } else {
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }
  const range = max - min;
  return Object.freeze({
    min,
    max,
    map: (value: number) => start + ((value - min) / range) * (end - start),
  });
}

function linearTicks(scale: NumericScale, count = 5): readonly number[] {
  return Object.freeze(Array.from({ length: count }, (_, index) =>
    scale.min + (scale.max - scale.min) * (index / (count - 1)),
  ));
}

function groupedBy<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): ReadonlyMap<string, readonly Value[]> {
  const groups = new Map<string, Value[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey);
    if (group === undefined) groups.set(groupKey, [value]);
    else group.push(value);
  }
  return groups;
}

function chartSeriesClass(category: ChartCategory | undefined): string {
  return ` niceeval-report__chart-series-${(category?.index ?? 0) % SERIES_COLORS}`;
}

function tickIndexes(length: number, maximum: number): readonly number[] {
  if (length <= maximum) return Object.freeze(Array.from({ length }, (_, index) => index));
  const indexes = new Set<number>();
  for (let index = 0; index < maximum; index += 1) {
    indexes.add(Math.round(index * (length - 1) / (maximum - 1)));
  }
  return Object.freeze([...indexes]);
}

function chartNumber(value: unknown): number | undefined {
  const metric = metricValue(value);
  const number = metric === undefined ? value : metric.value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function chartValueText(value: unknown, input: StaticChartSvgInput): string {
  const metric = metricValue(value);
  if (metric !== undefined) {
    if (input.formatMetrics === true) return compactMetricNumber(metric, input.locale);
    const valueText = metric.value === null ? "—" : formatNumber(metric.value);
    const unit = metric.unit === undefined || metric.unit === "" ? "" : ` ${metric.unit}`;
    return `${valueText}${unit}`;
  }
  return truncate(reportClosedValueText(value), 72);
}

function chartPointValueText(
  point: ChartPoint,
  axis: "x" | "y",
  input: StaticChartSvgInput,
): string {
  return chartValueText(axis === "x" ? point.xValue : point.yValue, input);
}

function formatChartAxisValue(
  value: number,
  input: StaticChartSvgInput,
  axis: "x" | "y",
): string {
  if (input.formatMetrics !== true) return formatNumber(value);
  const metric = metricForField(input.points, axis === "x" ? input.x : input.y);
  return metric === undefined
    ? formatNumber(value)
    : compactMetricNumber({ ...metric, value }, input.locale);
}

function metricForField(points: readonly unknown[], field: string) {
  for (const point of points) {
    const record = dataRecord(point);
    const metric = record === undefined ? undefined : metricValue(record[field]);
    if (metric !== undefined) return metric;
  }
  return undefined;
}

function classicMetricStatusText(
  metric: NonNullable<ReturnType<typeof metricValue>>,
  locale: ReportLocale | undefined,
): string | undefined {
  if (metric.state === "available" && metric.issues.length === 0) return undefined;
  const coverage = `${metric.samples} / ${metric.total} ${metric.basis}`;
  const problems = metric.issues.length === 0
    ? ""
    : locale === "zh-CN"
      ? ` · ${metric.issues.length} 个问题`
      : ` · ${metric.issues.length} issue${metric.issues.length === 1 ? "" : "s"}`;
  const evidence = metric.refs.length === 0
    ? ""
    : locale === "zh-CN"
      ? ` · ${metric.refs.length} 条证据`
      : ` · ${metric.refs.length} evidence ref${metric.refs.length === 1 ? "" : "s"}`;
  return `${coverage} · ${metric.state}${problems}${evidence}`;
}

function classicSeriesClass(index: number): string {
  const normalized = ((index % 24) + 24) % 24;
  return `niceeval-classic-chart-series-c${normalized % SERIES_COLORS} niceeval-classic-chart-series-v${Math.floor(normalized / SERIES_COLORS) + 1}`;
}

function valueKey(value: unknown): string {
  const metric = metricValue(value);
  if (metric !== undefined) return `metric:${metric.value === null ? "null" : String(metric.value)}:${metric.state}`;
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return `${typeof value}:${String(value)}`;
    default:
      return `other:${reportClosedValueText(value)}`;
  }
}

function chartKind(type: StaticChartSvgInput["type"]): string {
  return type === "bars" ? "Bar" : type === "line" ? "Line" : "Scatter";
}

function formatNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000 || absolute < 0.001) return value.toExponential(2);
  const decimals = absolute < 1 ? 3 : absolute < 10 ? 2 : absolute < 100 ? 1 : 0;
  return value.toFixed(decimals).replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/, "");
}

function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Uint8Array) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Readonly<Record<string, unknown>> : undefined;
}

function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
