// Dataset 形状校验与 TableContent 投影(docs/feature/reports/README.md)。

import type { Cell } from "../definition/cell.ts";
import type { Dataset, DatasetField, DatasetRow, MetricValue } from "./types.ts";
import { cellProblem, isObject } from "../components/shared.ts";
import type { TableContent } from "../definition/cell.ts";

export function isMetricValue(value: unknown): value is MetricValue {
  return cellProblem(value, "cell") === null;
}

export function isDataset(value: unknown): value is Dataset {
  if (!isObject(value)) return false;
  if (!Array.isArray(value.fields) || !Array.isArray(value.rows)) return false;
  for (const field of value.fields) {
    if (!isObject(field) || typeof field.name !== "string") return false;
    if (field.kind !== "dimension" && field.kind !== "metric") return false;
    if (field.valueType !== "string" && field.valueType !== "number") return false;
  }
  for (const row of value.rows) {
    if (!isObject(row) || typeof row.key !== "string" || !isObject(row.values)) return false;
  }
  return true;
}

export function metricFieldOf(metric: { name: string; unit?: string; better?: "higher" | "lower"; bounds?: { min?: number; max?: number } }): DatasetField {
  return {
    name: metric.name,
    kind: "metric",
    valueType: "number",
    ...(metric.unit !== undefined ? { unit: metric.unit } : {}),
    ...(metric.better !== undefined ? { better: metric.better } : {}),
    ...(metric.bounds !== undefined ? { bounds: metric.bounds } : {}),
  };
}

/** Dataset → TableContent(Table 原语消费)。 */
export function datasetToTableContent(dataset: Dataset): TableContent {
  const columns = dataset.fields.map((f) => ({
    key: f.name,
    ...(f.kind === "metric" && f.better !== undefined ? { better: f.better } : {}),
    ...(f.unit !== undefined ? { unit: f.unit } : {}),
  }));
  const rows = dataset.rows.map((row) => {
    const cells: globalThis.Record<string, Cell> = {};
    for (const field of dataset.fields) {
      const value = row.values[field.name];
      if (field.kind === "dimension") {
        cells[field.name] = { kind: "text", text: String(value ?? row.key) };
        continue;
      }
      if (!isMetricValue(value)) {
        throw new Error(`Dataset row "${row.key}" is missing measure cell for field "${field.name}".`);
      }
      cells[field.name] = { kind: "metric", metric: value };
    }
    return { key: row.key, cells };
  });
  return { columns, rows };
}

export function fieldOf(dataset: Dataset, name: string): DatasetField | undefined {
  return dataset.fields.find((f) => f.name === name);
}

export function requireField(dataset: Dataset, name: string): DatasetField {
  const field = fieldOf(dataset, name);
  if (field === undefined) {
    throw new Error(
      `Chart field "${name}" is not in the Dataset: declared fields are ${dataset.fields.map((f) => JSON.stringify(f.name)).join(", ")}.`,
    );
  }
  return field;
}

export function metricValueOf(row: DatasetRow, fieldName: string): MetricValue | null {
  const value = row.values[fieldName];
  if (!isMetricValue(value)) return null;
  return value;
}
