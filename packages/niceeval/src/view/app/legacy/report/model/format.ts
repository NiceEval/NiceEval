// unit 驱动的内置格式化:
//   "%" → 87%    "ms" → 1.2s    "$" → $0.31    其余 → 1.2k 缩写(带 unit 后缀)
// 输入是已闭合的完整 MetricValue(value 可以为 null,state/samples/total 原样保留);
// 这里只格式化显示字节,不重新统计、不把 null 猜成零。

import type { MetricState, MetricValue, Verdict } from "../definition/cell.tsx";
import {
  DEFAULT_REPORT_LOCALE,
  localeText,
  type ReportLocale,
} from "./locale.ts";

/** 旧表使用的 MeasureFormat 显示覆盖词表。 */
export type MetricFormat =
  | string
  | {
      readonly kind: string;
      readonly options?: unknown;
    }
  | { readonly kind: "custom"; readonly format: (value: number, locale: string) => string };

/** 一位小数、去掉无意义的 ".0" 尾巴。 */
function trimmed(value: number): string {
  const text = value.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** 1.2k / 3.4M / 5.6B 式缩写(输入为非负数)。 */
function abbreviate(absolute: number): string {
  if (absolute >= 1e9) return `${trimmed(absolute / 1e9)}B`;
  if (absolute >= 1e6) return `${trimmed(absolute / 1e6)}M`;
  if (absolute >= 1e3) return `${trimmed(absolute / 1e3)}k`;
  return Number.isInteger(absolute) ? String(absolute) : trimmed(absolute);
}

function formatDuration(absoluteMs: number): string {
  if (absoluteMs < 1000) return `${Math.round(absoluteMs)}ms`;
  if (absoluteMs < 60_000) return `${trimmed(absoluteMs / 1000)}s`;
  const totalSeconds = Math.round(absoluteMs / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function formatDollars(absolute: number): string {
  if (absolute >= 1000) return abbreviate(absolute);
  if (absolute >= 0.01 || absolute === 0) return absolute.toFixed(2);
  // 小额成本保留有效位,不四舍成 "$0.00" 假零。
  return absolute.toFixed(4);
}

/** unit 是量纲声明,也是格式化的唯一开关。 */
function formatNumberWithUnit(value: number, unit?: string): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (unit === "%") return `${sign}${trimmed(Math.round(absolute * 1000) / 10)}%`;
  if (unit === "ms") return sign + formatDuration(absolute);
  if (unit === "$") return `${sign}$${formatDollars(absolute)}`;
  const number = abbreviate(absolute);
  return unit ? `${sign}${number} ${unit}` : `${sign}${number}`;
}

/** 当前 MeasureFormat kind 词表 → unit 开关。未知 kind 回落声明 unit。 */
function resolveFormatUnit(format: MetricFormat | undefined, unit?: string): string | undefined {
  const kind = typeof format === "string"
    ? format
    : format && "kind" in format
    ? format.kind
    : undefined;
  switch (kind) {
    case "percent":
    case "ratio":
      return "%";
    case "usd":
    case "currency":
    case "currency-usd":
      return "$";
    case "duration":
    case "duration-ms":
    case "milliseconds":
      return "ms";
    case "number":
    case "count":
    case "integer":
      return undefined;
    default:
      return unit;
  }
}

/** @internal Scalar display for the legacy table implementation only. */
export function formatMetricScalar(
  value: number | null,
  unit?: string,
  format?: MetricFormat,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  if (value === null) return missingText("noSamples", locale);
  if (
    format &&
    typeof format === "object" &&
    format.kind === "custom" &&
    "format" in format &&
    typeof format.format === "function"
  ) {
    return format.format(value, locale);
  }
  return formatNumberWithUnit(value, resolveFormatUnit(format, unit));
}

/**
 * available / partial 保留数值；空值与失败态显示其闭合状态，避免把 unavailable、
 * failed 与 unsupported 都悄悄压成同一个零或空字符串。
 */
export function metricStateText(
  state: MetricState,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  switch (state) {
    case "available":
    case "partial":
    case "empty":
      return missingText("noSamples", locale);
    case "failed":
      return localeText(locale, "cell.metricFailed");
    case "unavailable":
      return localeText(locale, "cell.metricUnavailable");
    case "unsupported":
      return localeText(locale, "cell.metricUnsupported");
    case "migration-required":
      return localeText(locale, "cell.metricMigrationRequired");
  }
}

/** Formats one complete closed MetricValue without discarding state or coverage. */
export function formatMetricValue(
  metric: MetricValue,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  const display = metric.value === null
    ? metricStateText(metric.state, locale)
    : formatMetricScalar(metric.value, metric.unit, metric.format, locale);
  return `${display} · ${metric.samples} / ${metric.total} ${metric.basis} · ${metric.state}`;
}

/** missing 格内建 code → locale 词典 key。词表未命中时 missingText 原样返回 code。 */
const MISSING_CODE_KEYS = {
  noSamples: "cell.missing",
  unscorable: "cell.unscorable",
  noCurrentResult: "cell.noCurrentResult",
} as const;

/** `missing` 格的本地化原因。code 是结构化代码,不是显示文本。 */
export function missingText(code: string, locale: ReportLocale = DEFAULT_REPORT_LOCALE): string {
  const key = MISSING_CODE_KEYS[code as keyof typeof MISSING_CODE_KEYS];
  return key ? localeText(locale, key) : code;
}

/** 无单位纯数字(scoreboard 总分等):一位小数,去尾零。 */
export function formatPlainNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + trimmed(Math.round(Math.abs(value) * 10) / 10);
}

/** passed / failed / errored / skipped 的判定符。 */
export function verdictMark(verdict: Verdict): string {
  switch (verdict) {
    case "passed":
      return "✓";
    case "failed":
      return "✗";
    case "errored":
      return "!";
    case "skipped":
      return "–";
  }
}
