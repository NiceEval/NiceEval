import type {
  AnalysisIssue,
  EvidenceRef,
  MetricValue,
} from "../../analysis/index.ts";
import { analysisIssueText, evidenceRefText, presentMetric } from "../classic/format.ts";
import type { ReportLocale } from "../classic/locale.ts";

/** A table-safe projection that still contains the original complete metric. */
export interface MetricDetailRow {
  readonly metric: MetricValue;
  readonly value: string;
  readonly state: MetricValue["state"];
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricValue["basis"];
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

/** Converts a metric for display without splitting it into a new statistical value. */
export function toMetricDetailRow(metric: MetricValue, locale?: ReportLocale): MetricDetailRow {
  const presentation = presentMetric(metric, locale);
  return Object.freeze({
    metric,
    value: presentation.value,
    state: metric.state,
    samples: metric.samples,
    total: metric.total,
    basis: metric.basis,
    issues: metric.issues,
    refs: metric.refs,
  });
}

/** Closed Analysis issues become plain rows without suppressing linked evidence. */
export function toIssueRows(issues: readonly AnalysisIssue[]): readonly Readonly<{
  readonly code: string;
  readonly message: string;
  readonly evidence: string;
}>[] {
  return Object.freeze(issues.map((issue) => Object.freeze({
    code: issue.code,
    message: issue.message,
    evidence: issue.refs.map(evidenceRefText).join(", "),
  })));
}

/** Evidence references become readable rows while keeping their canonical identity text. */
export function toEvidenceRows(refs: readonly EvidenceRef[]): readonly Readonly<{
  readonly reference: string;
}>[] {
  return Object.freeze(refs.map((reference) => Object.freeze({ reference: evidenceRefText(reference) })));
}

/** One string for constrained text surfaces; it includes all references. */
export function toIssueText(issue: AnalysisIssue): string {
  return analysisIssueText(issue);
}
