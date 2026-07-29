// Dataset 形状校验与 TableData / TableContent 互转(docs/feature/reports/library/measures.md)。

import type { Cell } from "../definition/cell.ts";
import type { Dataset, DatasetField, DatasetRow, MetricValue, MetricColumn, TableData } from "./types.ts";
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

export function datasetFieldOf(column: MetricColumn): DatasetField {
  return {
    name: column.key,
    kind: "metric",
    valueType: "number",
    ...(column.unit !== undefined ? { unit: column.unit } : {}),
    ...(column.better !== undefined ? { better: column.better } : {}),
    ...(column.bounds !== undefined ? { bounds: column.bounds } : {}),
  };
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

/** TableData → Dataset(单/复合行维度字段名保留在 fields[0])。 */
export function tableDataToDataset(data: TableData): Dataset {
  const dimensionField: DatasetField = {
    name: data.rowDimension,
    kind: "dimension",
    valueType: "string",
  };
  return {
    fields: [dimensionField, ...data.columns.map(datasetFieldOf)],
    rows: data.rows.map((row) => ({
      key: row.key,
      values: {
        [data.rowDimension]: row.key,
        ...Object.fromEntries(data.columns.map((col) => [col.key, row.cells[col.key]!])),
      },
    })),
  };
}

/** Dataset → 过渡 TableData(MetricTable 等旧组件用)。 */
export function datasetToTableData(dataset: Dataset): TableData {
  const dimensionFields = dataset.fields.filter((f) => f.kind === "dimension");
  if (dimensionFields.length === 0) {
    throw new Error("Dataset must declare at least one dimension field for TableData conversion.");
  }
  const rowDimension = dimensionFields.length === 1 ? dimensionFields[0]!.name : dimensionFields.map((f) => f.name).join(" × ");
  const columns: MetricColumn[] = dataset.fields
    .filter((f) => f.kind === "metric")
    .map((f) => ({
      key: f.name,
      label: f.name,
      ...(f.unit !== undefined ? { unit: f.unit } : {}),
      ...(f.better !== undefined ? { better: f.better } : {}),
      ...(f.bounds !== undefined ? { bounds: f.bounds } : {}),
    }));
  const rows = dataset.rows.map((row) => {
    const cells: globalThis.Record<string, MetricValue> = {};
    for (const col of columns) {
      const value = row.values[col.key];
      if (!isMetricValue(value)) {
        throw new Error(`Dataset row "${row.key}" is missing measure cell for field "${col.key}".`);
      }
      cells[col.key] = value;
    }
    return { key: row.key, cells };
  });
  return { rowDimension, columns, rows };
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

/** ScatterData → Chart 消费的 Dataset(remaining-gap 1.7)。 */
export function scatterDataToDataset(data: import("./types.ts").ScatterData): Dataset {
  const fields: DatasetField[] = [
    { name: data.pointDimension, kind: "dimension", valueType: "string" },
    ...(data.seriesDimension !== undefined
      ? [{ name: data.seriesDimension, kind: "dimension" as const, valueType: "string" as const }]
      : []),
    datasetFieldOf(data.x),
    datasetFieldOf(data.y),
  ];
  const rows: DatasetRow[] = data.rows.map((row) => ({
    key: row.series !== undefined ? `${row.key}\0${row.series}` : row.key,
    values: {
      [data.pointDimension]: row.key,
      ...(data.seriesDimension !== undefined && row.series !== undefined ? { [data.seriesDimension]: row.series } : {}),
      [data.x.key]: row.x,
      [data.y.key]: row.y,
    },
  }));
  return { fields, rows };
}
