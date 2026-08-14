/** Analysis owns result, issue, evidence, and row identities. */
export type {
  AnalysisIssue,
  ClosedRows,
  ClosedRowsIdentity,
  DomainView,
  EvidenceRef,
  MeasureFormat,
  MetricBasis,
  MetricState,
  MetricValue,
} from "../../analysis/index.ts";

/**
 * Report's data-only recursive value domain. It is the validator's safe
 * storage shape for external table and chart values after callbacks finish.
 */
export type ReportClosedScalar = null | boolean | number | string;

export interface ReportClosedArray extends ReadonlyArray<ReportClosedValue> {}

export interface ReportClosedObject {
  readonly [key: string]: ReportClosedValue;
}

export type ReportClosedValue =
  | ReportClosedScalar
  | ReportClosedArray
  | ReportClosedObject;

/** @internal Backing name used by Report execution while it closes node data. */
export type ClosedValue = ReportClosedValue;
