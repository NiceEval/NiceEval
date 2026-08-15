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
  const value = metric.value === null
    ? missingText()
    : formatMetricScalar(metric.value, metric.format, metric.unit, locale);
  const unit = metricDisplayUnit(metric);
  return `${value}${unit} · ${metric.samples} / ${metric.total} ${metric.basis} · ${metric.state}`;
}

/** Provides all required completeness and evidence facts beside the compact text. */
export function presentMetric(
  metric: MetricValue,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): MetricPresentation {
  return Object.freeze({
    metric,
    value: metric.value === null
      ? missingText()
      : formatMetricScalar(metric.value, metric.format, metric.unit, locale),
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
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (kind === "usd" || kind === "currency" || kind === "currency-usd") {
    const fractionDigits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }
  if (kind === "duration" || kind === "duration-ms" || kind === "milliseconds") {
    return formatDurationMs(value);
  }
  if (kind === "count" || kind === "integer") {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}

/**
 * Formats a MetricValue's scalar with both of its Analysis-owned display
 * channels.  `format` wins when it is explicit; otherwise a known unit still
 * carries the same semantic formatter.  This only changes display bytes, not
 * the closed metric's value, state, denominator, issues, or refs.
 */
export function formatMetricScalar(
  value: number,
  format: MeasureFormat | undefined,
  unit: string | undefined,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  if (!Number.isFinite(value)) return missingText();
  if (unit === "ms" && formatKind(format) === undefined) return formatDurationMs(value);
  return formatMetricNumber(value, format ?? formatFromUnit(unit), locale);
}

/**
 * Units that are already represented by a semantic formatter must not be
 * appended again (`89.7% ratio`, `$1.20 usd`, and `2s ms` are all misleading).
 * Unknown units remain visible because they are part of the closed measure.
 */
export function metricDisplayUnit(metric: MetricValue): string {
  const unit = metric.unit;
  if (unit === undefined || unit.length === 0) return "";
  const kind = formatKind(metric.format ?? formatFromUnit(unit));
  if (unit === "ratio" || unit === "%" || unit === "$" || unit === "usd" || unit === "ms" || unit === "count" ||
    kind === "percent" || kind === "ratio" || kind === "usd" || kind === "currency" || kind === "currency-usd" ||
    kind === "duration" || kind === "duration-ms" || kind === "milliseconds" || kind === "count" || kind === "integer") {
    return "";
  }
  return ` ${unit}`;
}

/** A compact axis label; it deliberately avoids changing the underlying metric. */
export function formatAxisTick(value: number, _step = 0, unit?: string): string {
  if (!Number.isFinite(value)) return missingText();
  const formatted = new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value);
  return unit === undefined || unit.length === 0 ? formatted : `${formatted} ${unit}`;
}

/** Compact metric for classic Stat/Table/chart labels. Evidence stays off the cell. */
export function compactMetricText(
  metric: MetricValue,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return missingText();
  const value = compactMetricNumber(metric, locale);
  if (metric.state === "available" || metric.samples === metric.total) return value;
  return `${value} (${metric.samples}/${metric.total})`;
}

/** Duration, currency, and percent use the 0.12 summary vocabulary. */
export function compactMetricNumber(
  metric: MetricValue,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return missingText();
  return formatMetricScalar(metric.value, metric.format, metric.unit, locale);
}

/** Passed / failed tally derived from an already closed ratio MetricValue. */
export function compactVerdictText(metric: MetricValue): LocalizedText {
  if (metric.value === null || !Number.isFinite(metric.value) || metric.samples <= 0) {
    return missingText();
  }
  const passed = Math.round(metric.value * metric.samples);
  const failed = Math.max(0, metric.samples - passed);
  const en: string[] = [];
  const zh: string[] = [];
  if (passed > 0) {
    en.push(`${passed} passed`);
    zh.push(`${passed} 通过`);
  }
  if (failed > 0) {
    en.push(`${failed} failed`);
    zh.push(`${failed} 失败`);
  }
  if (en.length === 0) return missingText();
  return Object.freeze({ en: en.join(" "), "zh-CN": zh.join(" ") });
}

/** Converts a closed millisecond duration into the 0.12 `4m 33s` form. */
export function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value < 0) return missingText();
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) {
    const seconds = Math.round(value / 100) / 10;
    return `${String(seconds).replace(/\.0$/, "")}s`;
  }
  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Formats a closed UTC millisecond instant the way 0.12 Hero / summary did. */
export function formatInstant(
  value: number,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  if (!Number.isFinite(value)) return missingText();
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return missingText();
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Inclusive run-range label used by SampleSummary. */
export function formatReportDateTimeRange(
  fromMs: number,
  toMs: number,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): { readonly from: string; readonly to: string } {
  return Object.freeze({
    from: formatInstant(fromMs, locale),
    to: formatInstant(toMs, locale),
  });
}

/**
 * Projects one closed table/chart cell into a readable scalar.  Evidence refs
 * become short identities instead of JSON, and MetricValues keep their
 * completeness mark without dumping the contributor list.
 */
export function presentClosedCell(
  value: unknown,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string | number | boolean | LocalizedText | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isMetricValueLike(value)) return compactMetricText(value, locale);
  if (isEvidenceRefLike(value)) return evidenceRefText(value);
  if (isAnalysisIssueLike(value)) return analysisIssueText(value);
  if (isVerdictCounts(value)) return formatVerdictCounts(value);
  if (isLocalizedTextMap(value)) return value;
  if (isEvidenceIdentity(value)) return evidenceIdentityText(value);
  if (Array.isArray(value)) return presentClosedList(value, locale);
  return null;
}

/** A table/heading label that keeps author-provided locale maps intact. */
export function presentClosedLabel(value: unknown): LocalizedText {
  if (typeof value === "string") return value;
  if (isLocalizedTextMap(value)) return value;
  const presented = presentClosedCell(value);
  if (typeof presented === "string") return presented;
  if (isLocalizedTextMap(presented)) return presented;
  if (typeof presented === "number" || typeof presented === "boolean") return String(presented);
  return missingText();
}

/** Human-readable evidence identity kept alongside the original EvidenceRef. */
export function evidenceRefText(reference: EvidenceRef): string {
  return evidenceIdentityText(reference.identity);
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

function formatFromUnit(unit: string | undefined): MeasureFormat | undefined {
  if (unit === "ratio" || unit === "%") return "percent";
  if (unit === "$" || unit === "usd") return "usd";
  return undefined;
}

function presentClosedList(
  values: readonly unknown[],
  locale: ReportLocale,
): string | null {
  if (values.length === 0) return null;
  if (values.every(isEvidenceRefLike) || values.every(isEvidenceIdentity)) {
    return values.length === 1 ? String(presentClosedCell(values[0], locale) ?? missingText()) : `${values.length} evidence`;
  }
  if (values.every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) {
    return values.map((entry) => String(entry)).join(", ");
  }
  const presented = values
    .map((entry) => presentClosedCell(entry, locale))
    .filter((entry): entry is string | number | boolean => entry !== null);
  return presented.length === 0 ? null : presented.map(String).join(", ");
}

function evidenceIdentityText(identity: unknown): string {
  if (typeof identity === "string" && identity.length > 0) return identity;
  const record = asRecord(identity);
  if (record === undefined) return "evidence";
  if (record.kind === "attempt" && typeof record.locator === "string") return `attempt:${record.locator}`;
  const parts = [record.kind, record.evalId, record.experimentId, record.locator]
    .filter((part): part is string => typeof part === "string" && part.length > 0);
  return parts.length === 0 ? "evidence" : parts.join(":");
}

function formatVerdictCounts(value: {
  readonly passed?: number;
  readonly failed?: number;
  readonly errored?: number;
  readonly skipped?: number;
}): LocalizedText {
  const en: string[] = [];
  const zh: string[] = [];
  if ((value.passed ?? 0) > 0) {
    en.push(`${value.passed} passed`);
    zh.push(`${value.passed} 通过`);
  }
  if ((value.failed ?? 0) > 0) {
    en.push(`${value.failed} failed`);
    zh.push(`${value.failed} 失败`);
  }
  if ((value.errored ?? 0) > 0) {
    en.push(`${value.errored} errored`);
    zh.push(`${value.errored} 出错`);
  }
  if ((value.skipped ?? 0) > 0) {
    en.push(`${value.skipped} skipped`);
    zh.push(`${value.skipped} 跳过`);
  }
  return en.length === 0
    ? missingText()
    : Object.freeze({ en: en.join(" "), "zh-CN": zh.join(" ") });
}

function isMetricValueLike(value: unknown): value is MetricValue {
  const record = asRecord(value);
  return record !== undefined &&
    (typeof record.value === "number" || record.value === null) &&
    typeof record.samples === "number" &&
    typeof record.total === "number" &&
    typeof record.state === "string" &&
    Array.isArray(record.issues) &&
    Array.isArray(record.refs);
}

function isEvidenceRefLike(value: unknown): value is EvidenceRef {
  const record = asRecord(value);
  return record !== undefined && record.identity !== undefined && isEvidenceIdentity(record.identity);
}

function isAnalysisIssueLike(value: unknown): value is AnalysisIssue {
  const record = asRecord(value);
  return record !== undefined &&
    typeof record.code === "string" &&
    typeof record.message === "string" &&
    Array.isArray(record.refs);
}

function isEvidenceIdentity(value: unknown): boolean {
  const record = asRecord(value);
  if (record === undefined || typeof record.kind !== "string") return false;
  return typeof record.locator === "string" ||
    typeof record.evalId === "string" ||
    typeof record.experimentId === "string" ||
    typeof record.runId === "string";
}

function isVerdictCounts(value: unknown): value is {
  readonly passed?: number;
  readonly failed?: number;
  readonly errored?: number;
  readonly skipped?: number;
} {
  const record = asRecord(value);
  if (record === undefined) return false;
  const keys = Object.keys(record);
  if (keys.length === 0) return false;
  return keys.every((key) =>
    (key === "passed" || key === "failed" || key === "errored" || key === "skipped") &&
    typeof record[key] === "number"
  );
}

function isLocalizedTextMap(value: unknown): value is Exclude<LocalizedText, string> {
  const record = asRecord(value);
  if (record === undefined) return false;
  const keys = Object.keys(record);
  return keys.length > 0 && keys.every((key) => typeof record[key] === "string") &&
    (typeof record.en === "string" || typeof record["zh-CN"] === "string");
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}
