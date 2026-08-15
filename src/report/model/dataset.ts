import type {
  ClosedRows,
  JsonValue,
  MeasureFormat,
  MetricValue,
} from "../../analysis/index.ts";
import { isClosedRows } from "../../analysis/contracts.ts";
import { isMetricValue } from "./metrics.ts";
import type {
  ClosedDataset,
  Dataset,
  DatasetDimensionValueType,
  DatasetField,
  DatasetRow,
  DatasetValue,
} from "./types.ts";

const closedDatasetBrands = new WeakSet<object>();

/** A bad Dataset request never becomes a fake zero, metric, or Evidence row. */
export class ReportDatasetError extends Error {
  readonly code = "report-dataset-invalid";

  constructor(reason: string) {
    super(reason);
    this.name = "ReportDatasetError";
  }
}

/** Declares one presentation Dimension field; null coordinates remain valid. */
export function dimensionField(
  name: string,
  valueType: DatasetDimensionValueType = "scalar",
): DatasetField {
  assertFieldName(name);
  if (!isDimensionValueType(valueType)) {
    throw new ReportDatasetError("unsupported Dimension field value type " + JSON.stringify(valueType));
  }
  return Object.freeze({ name, kind: "dimension" as const, valueType });
}

/**
 * Declares a Metric field by its Report row property name.  Current Analysis
 * Measures do not carry a display-column name, so accepting one explicitly
 * avoids guessing from an opaque Measure id.
 */
export function metricField(
  name: string,
  measure: Readonly<{
    readonly unit?: string;
    readonly format?: MeasureFormat;
    readonly better?: "higher" | "lower" | "neutral";
  }>,
): DatasetField {
  assertFieldName(name);
  return Object.freeze({
    name,
    kind: "metric" as const,
    valueType: "number" as const,
    ...(measure.unit === undefined ? {} : { unit: measure.unit }),
    ...(measure.format === undefined ? {} : { format: measure.format }),
    ...(measure.better === undefined ? {} : { better: measure.better }),
  });
}

/**
 * Projects Analysis-issued ClosedRows into a neutral Dataset while preserving
 * row key, collection identity, frame-level issues, Evidence refs, and every
 * full MetricValue cell.  It does not reduce, filter, or re-close rows.
 */
export function datasetFromClosedRows<Row extends object>(
  rows: ClosedRows<Row>,
  fields: readonly DatasetField[],
): ClosedDataset {
  if (!isClosedRows(rows)) {
    throw new ReportDatasetError("datasetFromClosedRows requires Analysis-issued ClosedRows");
  }
  const closedFields = closeFields(fields);
  const datasetRows = rows.map((row, rowIndex) => closeRow(row, rowIndex, closedFields));
  const dataset: ClosedDataset = Object.freeze({
    kind: "closed-dataset" as const,
    identity: rows.identity,
    fields: closedFields,
    rows: Object.freeze(datasetRows),
    issues: rows.issues,
    refs: rows.refs,
  });
  closedDatasetBrands.add(dataset);
  return dataset;
}

/** True only for a Dataset created from Analysis-issued ClosedRows above. */
export function isClosedDataset(value: unknown): value is ClosedDataset {
  return isDataset(value) && closedDatasetBrands.has(value as object) &&
    (value as { readonly kind?: unknown }).kind === "closed-dataset";
}

/** Validates a neutral Dataset shape without claiming that it came from Analysis. */
export function isDataset(value: unknown): value is Dataset {
  if (!isPlainRecord(value) || !Array.isArray(value.fields) || !Array.isArray(value.rows)) return false;
  try {
    const fields = closeFields(value.fields);
    for (let index = 0; index < value.rows.length; index += 1) {
      const row = value.rows[index];
      if (!isDatasetRow(row)) return false;
      for (const field of fields) {
        if (!Object.hasOwn(row.values, field.name)) return false;
        if (!fieldValueMatches(field, row.values[field.name])) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function fieldOf(dataset: Dataset, name: string): DatasetField | undefined {
  return dataset.fields.find((field) => field.name === name);
}

export function requireField(dataset: Dataset, name: string): DatasetField {
  const field = fieldOf(dataset, name);
  if (field !== undefined) return field;
  throw new ReportDatasetError(
    "Dataset field " + JSON.stringify(name) + " is not declared; fields are " +
      dataset.fields.map((entry) => JSON.stringify(entry.name)).join(", "),
  );
}

/** Reads an existing MetricValue cell without changing any of its semantics. */
export function metricValueOf(row: DatasetRow, fieldName: string): MetricValue | null {
  const value = row.values[fieldName];
  return isMetricValue(value) ? value : null;
}

function closeFields(fields: readonly unknown[]): readonly DatasetField[] {
  if (!Array.isArray(fields)) throw new ReportDatasetError("Dataset fields must be an array");
  const names = new Set<string>();
  const closed = fields.map((field) => {
    if (!isPlainRecord(field)) throw new ReportDatasetError("Dataset field must be an object");
    const name = field.name;
    if (typeof name !== "string") throw new ReportDatasetError("Dataset field name must be a string");
    assertFieldName(name);
    if (names.has(name)) {
      throw new ReportDatasetError("Dataset field " + JSON.stringify(name) + " is declared more than once");
    }
    names.add(name);
    const kind = field.kind;
    if (kind !== "dimension" && kind !== "metric") {
      throw new ReportDatasetError("Dataset field " + JSON.stringify(name) + " has an unknown kind");
    }
    const valueType = field.valueType;
    if (!isDimensionValueType(valueType)) {
      throw new ReportDatasetError("Dataset field " + JSON.stringify(name) + " has an unknown value type");
    }
    if (kind === "metric" && valueType !== "number") {
      throw new ReportDatasetError("Metric Dataset fields must use valueType \"number\"");
    }
    const unit = field.unit;
    if (unit !== undefined && typeof unit !== "string") {
      throw new ReportDatasetError("Dataset field unit must be a string");
    }
    const format = field.format;
    if (format !== undefined && !isMeasureFormat(format)) {
      throw new ReportDatasetError("Dataset field format must be a closed MeasureFormat");
    }
    const better = field.better;
    if (better !== undefined && !isBetter(better)) {
      throw new ReportDatasetError("Dataset field better must be higher, lower, or neutral");
    }
    const bounds = field.bounds;
    if (bounds !== undefined && !validBounds(bounds)) {
      throw new ReportDatasetError("Dataset field bounds must be finite and ordered");
    }
    return Object.freeze({
      name,
      kind,
      valueType,
      ...(unit === undefined ? {} : { unit }),
      ...(format === undefined ? {} : { format }),
      ...(better === undefined ? {} : { better }),
      ...(bounds === undefined
        ? {}
        : { bounds: Object.freeze({ ...bounds }) }),
    }) satisfies DatasetField;
  });
  return Object.freeze(closed);
}

function closeRow(
  value: object,
  rowIndex: number,
  fields: readonly DatasetField[],
): DatasetRow {
  if (!isPlainRecord(value) || typeof value.key !== "string") {
    throw new ReportDatasetError("Closed row " + String(rowIndex) + " must have a stable string key");
  }
  const values: Record<string, DatasetValue> = Object.create(null);
  for (const field of fields) {
    if (!Object.hasOwn(value, field.name)) {
      throw new ReportDatasetError(
        "Closed row " + JSON.stringify(value.key) + " is missing field " + JSON.stringify(field.name),
      );
    }
    const fieldValue = value[field.name];
    if (!fieldValueMatches(field, fieldValue)) {
      throw new ReportDatasetError(
        "Closed row " + JSON.stringify(value.key) + " has an invalid " + field.kind +
          " field " + JSON.stringify(field.name),
      );
    }
    values[field.name] = fieldValue;
  }
  return Object.freeze({ key: value.key, values: Object.freeze(values) });
}

function isDatasetRow(value: unknown): value is DatasetRow {
  return isPlainRecord(value) && typeof value.key === "string" && isPlainRecord(value.values);
}

function fieldValueMatches(field: DatasetField, value: unknown): value is DatasetValue {
  if (field.kind === "metric") return isMetricValue(value);
  if (value === null) return true;
  switch (field.valueType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "scalar":
      return typeof value === "string" || typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value));
  }
}

function assertFieldName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new ReportDatasetError("Dataset field names must be non-empty strings");
  }
  if (name === "key") {
    throw new ReportDatasetError('Dataset reserves "key" for stable row identity');
  }
}

function isDimensionValueType(value: unknown): value is DatasetDimensionValueType {
  return value === "string" || value === "number" || value === "boolean" || value === "scalar";
}

function isBetter(value: unknown): value is "higher" | "lower" | "neutral" {
  return value === "higher" || value === "lower" || value === "neutral";
}

function validBounds(
  value: unknown,
): value is { readonly min?: number; readonly max?: number } {
  if (!isPlainRecord(value)) return false;
  if (
    (value.min !== undefined && (typeof value.min !== "number" || !Number.isFinite(value.min))) ||
    (value.max !== undefined && (typeof value.max !== "number" || !Number.isFinite(value.max)))
  ) {
    return false;
  }
  return value.min === undefined || value.max === undefined || value.min <= value.max;
}

function isMeasureFormat(value: unknown): value is MeasureFormat {
  return typeof value === "string" ||
    (isPlainRecord(value) && typeof value.kind === "string" &&
      (value.options === undefined || isJsonValue(value.options)));
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || value === null || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : isPlainRecord(value) && Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
