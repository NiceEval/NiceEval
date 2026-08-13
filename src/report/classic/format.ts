import type { ReportCoverage, ReportDisplayValue } from "../semantic/document.ts";
import type { MetricValue } from "./metric.ts";

export function formatRatio(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMetricDisplay(metric: MetricValue): string {
  if (metric.value === null) {
    return "—";
  }
  if (metric.unit === "ratio") {
    return formatRatio(metric.value);
  }
  if (metric.unit === "USD") {
    return formatUsd(metric.value);
  }
  if (metric.unit === "ms") {
    return `${Math.round(metric.value)}ms`;
  }
  return String(metric.value);
}

export function formatUsd(value: number): string {
  const digits = value === 0 || Math.abs(value) >= 0.01 ? 2 : 4;
  return `$${value.toFixed(digits)}`;
}

export function coverageFromMetric(metric: MetricValue): ReportCoverage {
  return Object.freeze({
    basis: "eval" as const,
    samples: metric.samples,
    total: metric.total,
  });
}

export function displayFromMetric(metric: MetricValue): ReportDisplayValue {
  return Object.freeze({
    value: metric.value,
    display: formatMetricDisplay(metric),
    ...(metric.unit === undefined ? {} : { unit: metric.unit }),
    coverage: coverageFromMetric(metric),
  });
}

export function displayScalar(
  value: number | string | null,
  display: string,
  coverage?: ReportCoverage,
): ReportDisplayValue {
  return Object.freeze({
    value,
    display,
    ...(coverage === undefined ? {} : { coverage }),
  });
}

export function formatRunInstant(value: number): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function formatRunRange(
  earliest: number | null,
  latest: number | null,
  runCount: number,
): string {
  if (earliest === null || latest === null || runCount === 0) {
    return "—";
  }
  return `${runCount} · ${formatRunInstant(earliest)} – ${formatRunInstant(latest)}`;
}

export function observedDisplay(
  value: number | null,
  display: string,
  coverage: ReportCoverage,
): ReportDisplayValue {
  return Object.freeze({
    value,
    display: value === null ? "—" : display,
    coverage,
  });
}
