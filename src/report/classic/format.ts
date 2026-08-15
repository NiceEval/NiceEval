import type {
  AnalysisIssue,
  EvidenceRef,
  MeasureFormat,
  MetricValue,
} from "../../analysis/index.ts";
import type { LocalizedText } from "../../shared/types.ts";
import { DEFAULT_REPORT_LOCALE, type ReportLocale } from "./locale.ts";

/** A display projection that retains the original MetricValue for navigation. */
export interface MetricPresentation {
  readonly metric: MetricValue;
  readonly value: string;
  readonly coverage: string;
  readonly state: MetricValue["state"];
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly text: string;
}

/**
 * Formats a closed metric without manufacturing a value for null.  This is a
 * presentation helper only: the MetricValue itself remains the source passed
 * to Stat, Table, and charts.
 */
export function formatMetricValue(
  metric: MetricValue,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  const value = metric.value === null ? missingText() : formatMetricNumber(metric.value, metric.format, locale);
  const unit = metric.unit === undefined || metric.unit.length === 0 ? "" : ` ${metric.unit}`;
  return `${value}${unit} · ${metric.samples} / ${metric.total} ${metric.basis} · ${metric.state}`;
}

/** Provides all required completeness and evidence facts beside the compact text. */
export function presentMetric(
  metric: MetricValue,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): MetricPresentation {
  return Object.freeze({
    metric,
    value: metric.value === null ? missingText() : formatMetricNumber(metric.value, metric.format, locale),
    coverage: `${metric.samples} / ${metric.total} ${metric.basis}`,
    state: metric.state,
    issues: metric.issues,
    refs: metric.refs,
    text: formatMetricValue(metric, locale),
  });
}

/** A null metric is not zero: all classic missing-value paths use this mark. */
export function missingText(): string {
  return "—";
}

/** Formats a scalar according to the finite Analysis-owned format vocabulary. */
export function formatMetricNumber(
  value: number,
  format: MeasureFormat | undefined,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  if (!Number.isFinite(value)) return missingText();
  const kind = formatKind(format);
  if (kind === "percent" || kind === "ratio") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (kind === "usd" || kind === "currency-usd") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}

/** A compact axis label; it deliberately avoids changing the underlying metric. */
export function formatAxisTick(value: number, _step = 0, unit?: string): string {
  if (!Number.isFinite(value)) return missingText();
  const formatted = new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value);
  return unit === undefined || unit.length === 0 ? formatted : `${formatted} ${unit}`;
}

/** Human-readable evidence identity kept alongside the original EvidenceRef. */
export function evidenceRefText(reference: EvidenceRef): string {
  return reference.identity.kind === "attempt"
    ? `attempt:${reference.identity.locator}`
    : JSON.stringify(reference.identity);
}

/** Human-readable Analysis issue that never drops its linked EvidenceRefs. */
export function analysisIssueText(issue: AnalysisIssue): string {
  const refs = issue.refs.length === 0 ? "" : ` (${issue.refs.map(evidenceRefText).join(", ")})`;
  return `${issue.code}: ${issue.message}${refs}`;
}

/** Converts a closed text value to a label while retaining author-provided maps. */
export function formatLocalizedText(value: LocalizedText, locale: ReportLocale = DEFAULT_REPORT_LOCALE): string {
  if (typeof value === "string") return value;
  const exact = value[locale];
  return exact ?? value.en ?? Object.values(value)[0] ?? "";
}

function formatKind(format: MeasureFormat | undefined): string | undefined {
  if (typeof format === "string") return format.toLowerCase();
  return format?.kind.toLowerCase();
}
