import type { ReportCoverage, ReportDisplayValue } from "../semantic/document.ts";
import type { MetricFormat, MetricValue } from "./metric.ts";

export function formatRatio(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${trimTrailingZeros(Math.round(value * 1000) / 10)}%`;
}

function trimmed(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function abbreviate(abs: number): string {
  if (abs >= 1e9) return `${trimmed(abs / 1e9)}B`;
  if (abs >= 1e6) return `${trimmed(abs / 1e6)}M`;
  if (abs >= 1e3) return `${trimmed(abs / 1e3)}k`;
  return Number.isInteger(abs) ? String(abs) : trimmed(abs);
}

function formatDuration(absMs: number): string {
  if (absMs < 1000) return `${Math.round(absMs)}ms`;
  if (absMs < 60_000) return `${trimmed(absMs / 1000)}s`;
  const totalSeconds = Math.round(absMs / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function formatDollars(abs: number): string {
  if (abs >= 1000) return abbreviate(abs);
  if (abs >= 0.01 || abs === 0) return abs.toFixed(2);
  return abs.toFixed(4);
}

function formatNumberWithUnit(value: number, unit?: string): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (unit === "%" || unit === "ratio") return `${sign}${trimmed(Math.round(abs * 1000) / 10)}%`;
  if (unit === "ms") return sign + formatDuration(abs);
  if (unit === "$" || unit === "USD") return `${sign}$${formatDollars(abs)}`;
  const n = abbreviate(abs);
  return unit ? `${sign}${n} ${unit}` : `${sign}${n}`;
}

export function formatMetricValue(
  value: number | null,
  unit?: string,
  format?: MetricFormat,
): string {
  if (value === null) {
    return "—";
  }
  if (format !== undefined && typeof format === "object" && format.kind === "custom") {
    return format.format(value, "en");
  }
  const resolved = format === "percent"
    ? "%"
    : format === "currency"
      ? "$"
      : format === "duration"
        ? "ms"
        : unit;
  return formatNumberWithUnit(value, resolved);
}

function trimTrailingZeros(value: number): string {
  return String(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function formatMetricDisplay(metric: MetricValue): string {
  return formatMetricValue(metric.value, metric.unit, metric.format);
}

export function formatUsd(value: number): string {
  return formatNumberWithUnit(value, "$");
}

export function formatAxisTick(value: number, step: number, unit?: string): string {
  if (!(step > 0) || !Number.isFinite(step)) return formatNumberWithUnit(value, unit);
  let decimals = 0;
  while (decimals < 10 && Math.abs(Math.round(step * 10 ** decimals) - step * 10 ** decimals) > 1e-9 * 10 ** decimals) {
    decimals += 1;
  }
  if (decimals === 0) return formatNumberWithUnit(value, unit);
  const fixed = (n: number, d: number) => n.toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (unit === "%" || unit === "ratio") return `${sign}${fixed(abs * 100, Math.max(0, decimals - 2))}%`;
  if (unit === "ms") return formatNumberWithUnit(value, unit);
  if (unit === "$" || unit === "USD") return `${sign}$${fixed(abs, decimals)}`;
  return unit ? `${sign}${fixed(abs, decimals)} ${unit}` : `${sign}${fixed(abs, decimals)}`;
}

export function shortestUniqueLabels(ids: readonly string[]): Map<string, string> {
  const segsOf = (id: string) => id.split("/").filter(Boolean);
  const depth = new Map<string, number>(ids.map((id) => [id, 1]));
  for (;;) {
    const byLabel = new Map<string, string[]>();
    for (const id of ids) {
      const segs = segsOf(id);
      const label = segs.slice(-Math.min(depth.get(id)!, segs.length)).join("/") || id;
      byLabel.set(label, [...(byLabel.get(label) ?? []), id]);
    }
    let grew = false;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      for (const id of group) {
        const segs = segsOf(id);
        if (depth.get(id)! < segs.length) {
          depth.set(id, depth.get(id)! + 1);
          grew = true;
        }
      }
    }
    if (!grew) {
      const out = new Map<string, string>();
      for (const id of ids) {
        const segs = segsOf(id);
        out.set(id, segs.slice(-Math.min(depth.get(id)!, segs.length)).join("/") || id);
      }
      return out;
    }
  }
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

export function formatDateTimeMinute(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatInstant(value: number, locale = "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return formatDateTimeMinute(value);
  }
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

export function verdictMark(verdict: string): string {
  if (verdict === "passed") return "✓";
  if (verdict === "failed") return "✗";
  if (verdict === "errored") return "!";
  return "·";
}
