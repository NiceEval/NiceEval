// Chart 映射:Dataset + Series 声明 → 可绘制点集(docs/feature/reports/library.md)。

import type { LocalizedText } from "../../model/locale.ts";
import type { AttemptLocator } from "../../../attempt-locator.ts";
import type { Dataset, DatasetField } from "../../model/types.ts";
import type { MetricValue } from "../../../analysis/index.ts";
import { isMetricValue } from "../../model/metrics.ts";
import { metricValueOf, requireField } from "../../model/dataset.ts";
import { attemptLocatorOfEvidenceRef } from "./shared.ts";

export interface SeriesProps {
  id: string;
  mark: "line" | "bar" | "area" | "scatter";
  x?: string;
  y?: string;
  points?: string;
  by?: string;
  value?: string;
  xAxis?: string;
  yAxis?: string;
  stack?: string;
  connect?: boolean;
  connectNulls?: boolean;
  hidden?: boolean;
  label?: LocalizedText;
  color?: string;
  line?: "solid" | "dashed" | "dotted";
  point?: "circle" | "square" | "diamond";
}

export type ChartMark = SeriesProps["mark"];

export interface ChartFieldBinding {
  id?: string;
  field: string;
  sort?: string;
  limit?: number;
}

export type ChartAxisBinding = string | ChartFieldBinding;

export interface ChartSeriesOverride {
  hidden?: boolean;
  label?: LocalizedText;
  line?: "solid" | "dashed" | "dotted";
  point?: "circle" | "square" | "diamond";
}

export interface MappedPoint {
  key: string;
  seriesId: string;
  seriesValue?: string;
  pointLabel: string;
  x: number;
  y: number;
  /** 分类轴的原始显示值；数值轴省略。 */
  xLabel?: string;
  yLabel?: string;
  xCell?: MetricValue;
  yCell?: MetricValue;
  /** 证据 locator(closed refs 里 kind=attempt 的 identity.locator;其余 ref 不产生假链接)。 */
  refs: readonly AttemptLocator[];
}

export interface MappedSeries {
  id: string;
  mark: ChartMark;
  points: MappedPoint[];
  stack?: string;
  connect: boolean;
  hidden: boolean;
  label?: LocalizedText;
  line?: "solid" | "dashed" | "dotted";
  point?: "circle" | "square" | "diamond";
  byField?: string;
}

export interface ChartAxes {
  xField: string;
  yField: string;
  xMeta: DatasetField;
  yMeta: DatasetField;
}

function bindingField(binding: ChartAxisBinding): string {
  return typeof binding === "string" ? binding : binding.field;
}

function categoryValues(dataset: Dataset, fieldName: string): string[] {
  const values = new Set<string>();
  for (const row of dataset.rows) {
    const raw = row.values[fieldName];
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      values.add(String(raw));
    }
  }
  return [...values];
}

function numericFromField(
  field: DatasetField,
  raw: unknown,
  categories: readonly string[],
): number | null {
  if (field.kind === "metric") {
    if (isMetricValue(raw)) {
      return typeof raw.value === "number" ? raw.value : null;
    }
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  if (field.valueType === "number" && typeof raw === "number") return raw;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    const index = categories.indexOf(String(raw));
    return index === -1 ? null : index;
  }
  return null;
}

function stringFromValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return "";
}

export function resolveChartAxes(dataset: Dataset, x: ChartAxisBinding, y: ChartAxisBinding): ChartAxes {
  const xField = bindingField(x);
  const yField = bindingField(y);
  const xMeta = requireField(dataset, xField);
  const yMeta = requireField(dataset, yField);
  return { xField, yField, xMeta, yMeta };
}

export function validateSeriesOverrides(overrides: Readonly<Record<string, ChartSeriesOverride>> | undefined, seriesIds: readonly string[]): void {
  if (overrides === undefined) return;
  for (const key of Object.keys(overrides)) {
    if (!seriesIds.includes(key)) {
      throw new Error(
        `Chart.series references unknown series id ${JSON.stringify(key)}: declared <Series> ids are ${seriesIds.map((id) => JSON.stringify(id)).join(", ")}.`,
      );
    }
  }
}

export function mapChartSeries(
  dataset: Dataset,
  axes: ChartAxes,
  specs: readonly SeriesProps[],
  overrides?: Readonly<Record<string, ChartSeriesOverride>>,
): { series: MappedSeries[]; missing: number } {
  validateSeriesOverrides(overrides, specs.map((s) => s.id));
  const out: MappedSeries[] = [];
  let missing = 0;

  for (const spec of specs) {
    const override = overrides?.[spec.id];
    const xField = spec.x ?? axes.xField;
    const yField = spec.y ?? axes.yField;
    const xMeta = requireField(dataset, xField);
    const yMeta = requireField(dataset, yField);
    const xCategories = xMeta.kind === "dimension" ? categoryValues(dataset, xField) : [];
    const yCategories = yMeta.kind === "dimension" ? categoryValues(dataset, yField) : [];
    const byField = spec.by;
    const pointsField = spec.points;
    const points: MappedPoint[] = [];

    for (const row of dataset.rows) {
      if (spec.value !== undefined && byField !== undefined) {
        const byVal = stringFromValue(row.values[byField]);
        if (byVal !== spec.value) continue;
      }
      const xRaw = row.values[xField];
      const yRaw = row.values[yField];
      const x = numericFromField(xMeta, xRaw, xCategories);
      const y = numericFromField(yMeta, yRaw, yCategories);
      if (x === null || y === null) {
        missing += 1;
        continue;
      }
      const seriesValue = byField !== undefined ? stringFromValue(row.values[byField]) : undefined;
      const pointLabel = pointsField !== undefined ? stringFromValue(row.values[pointsField]) : row.key;
      const refMetric = yMeta.kind === "metric" ? metricValueOf(row, yField) : metricValueOf(row, xField);
      const refs: AttemptLocator[] = (refMetric?.refs ?? []).flatMap((ref) => {
        const locator = attemptLocatorOfEvidenceRef(ref);
        return locator === undefined ? [] : [locator];
      });
      points.push({
        key: row.key,
        seriesId: spec.id,
        ...(seriesValue !== undefined ? { seriesValue } : {}),
        pointLabel,
        x,
        y,
        ...(xMeta.kind === "dimension" ? { xLabel: stringFromValue(xRaw) } : {}),
        ...(yMeta.kind === "dimension" ? { yLabel: stringFromValue(yRaw) } : {}),
        ...(xMeta.kind === "metric" && isMetricValue(xRaw) ? { xCell: xRaw } : {}),
        ...(yMeta.kind === "metric" && isMetricValue(yRaw) ? { yCell: yRaw } : {}),
        refs,
      });
    }

    out.push({
      id: spec.id,
      mark: spec.mark,
      points,
      ...(spec.stack !== undefined ? { stack: spec.stack } : {}),
      connect: spec.connect ?? false,
      hidden: override?.hidden ?? spec.hidden ?? false,
      ...(override?.label !== undefined ? { label: override.label } : spec.label !== undefined ? { label: spec.label } : {}),
      ...(override?.line !== undefined ? { line: override.line } : spec.line !== undefined ? { line: spec.line } : {}),
      ...(override?.point !== undefined ? { point: override.point } : spec.point !== undefined ? { point: spec.point } : {}),
      ...(byField !== undefined ? { byField } : {}),
    });
  }
  return { series: out, missing };
}

export function seriesDimensionValues(mapped: readonly MappedSeries[], byField: string): string[] {
  const values = new Set<string>();
  for (const series of mapped) {
    if (series.byField !== byField || series.hidden) continue;
    for (const point of series.points) {
      if (point.seriesValue !== undefined) values.add(point.seriesValue);
    }
  }
  return [...values].sort();
}
