/**
 * Report owns presentation-friendly names for closed Analysis output, not a
 * second value model.  The source of truth for Sample, MetricValue, Evidence,
 * and ClosedRows remains `niceeval/analysis`.
 */
import type {
  AnalysisIssue,
  ClosedRows,
  ClosedRowsIdentity,
  Dimension,
  DimensionValue,
  EvidenceRef,
  JsonValue,
  LogicalSlot,
  Measure,
  MeasureFormat,
  MetricBasis,
  MetricState,
  MetricValue,
  Sample,
} from "../../analysis/index.ts";

export type {
  AnalysisIssue,
  ClosedRows,
  ClosedRowsIdentity,
  Dimension,
  DimensionValue,
  EvidenceRef,
  JsonValue,
  LogicalSlot,
  Measure,
  MeasureFormat,
  MetricBasis,
  MetricState,
  MetricValue,
  Sample,
} from "../../analysis/index.ts";

/** A Report receives the Host-issued Analysis Sample; it cannot construct one. */
export type ReportSample = Sample;

/** The Report catalog is intentionally logical-Slot based. */
export type ReportDimension<
  Value extends DimensionValue = DimensionValue,
> = Dimension<LogicalSlot, Value>;

/** A Report measure is an Analysis Measure, never a Report-local reducer. */
export type ReportMeasure<Value = number> = Measure<LogicalSlot, Value>;

/**
 * A scalar coordinate or a complete Analysis-owned metric is safe to put in a
 * closed Report row.  It deliberately excludes callbacks, readers, paths,
 * Scope values, and Attempt handles.
 */
export type ClosedDataValue = DimensionValue | MetricValue;

/** A display row retains Analysis's opaque row identity in its `key` field. */
export type ClosedDataRow = Readonly<Record<string, ClosedDataValue>> & Readonly<{
  readonly key: string;
}>;

/**
 * Dataset is a neutral presentation shape.  It is not a new statistics
 * engine: every metric cell is an existing complete MetricValue.
 */
export type DatasetValue = ClosedDataValue;

export type DatasetDimensionValueType = "string" | "number" | "boolean" | "scalar";

export interface DatasetField {
  readonly name: string;
  readonly kind: "dimension" | "metric";
  /**
   * `scalar` is necessary for a Dimension such as flag(name), whose closed
   * coordinates may legitimately be string, number, boolean, or null.
   */
  readonly valueType: DatasetDimensionValueType;
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly bounds?: { readonly min?: number; readonly max?: number };
}

export interface DatasetRow {
  readonly key: string;
  readonly values: Readonly<Record<string, DatasetValue>>;
}

export interface Dataset<Row extends DatasetRow = DatasetRow> {
  readonly fields: readonly DatasetField[];
  readonly rows: readonly Row[];
}

/**
 * A Dataset obtained from Analysis-issued ClosedRows.  It preserves the source
 * collection's identity, aggregate issues, and Evidence refs without claiming
 * to be a newly issued ClosedRows value.
 */
export interface ClosedDataset<Row extends DatasetRow = DatasetRow> extends Dataset<Row> {
  readonly kind: "closed-dataset";
  readonly identity: ClosedRowsIdentity;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}
