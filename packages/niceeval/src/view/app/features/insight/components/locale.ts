// 官方组件 chrome 文案的 locale 字典与 LocalizedText 解析。
// ReportLocale 是开放的 BCP 47 标签(数据协议不封语言上限);官方内置文案与
// 官方固定文案覆盖 en / zh-CN；公共 MetricValue 由 renderer 按当前 locale 格式化。
//
// 这是旧表所需词条的 plain React 闭包，不 import CLI 专用字典，也不保留
// Report authoring framework 的其它组件词条。

export type LocalizedText = string | globalThis.Record<string, string>;

/** 报告渲染的 locale(BCP 47 标签,开放);默认 "en"。 */
export type ReportLocale = string;

export const DEFAULT_REPORT_LOCALE: ReportLocale = "en";

/** 官方固定文案覆盖的 locale 全集。 */
import { LOCALES } from "../../../../../i18n/core.ts";

export const DISPLAY_LOCALES: readonly ReportLocale[] = LOCALES;

/**
 * LocalizedText 的确定回退:取当前 locale;缺失时取 en;仍缺失时取按 locale 键字典序的
 * 第一个非空值。对象没有任何非空值时报错,不渲染空文案。
 */
export function resolveLocalizedText(text: LocalizedText, locale: ReportLocale): string {
  if (typeof text === "string") return text;
  const direct = text[locale];
  if (direct !== undefined && direct !== "") return direct;
  const english = text.en;
  if (english !== undefined && english !== "") return english;
  for (const key of Object.keys(text).sort()) {
    const value = text[key];
    if (value !== undefined && value !== "") return value;
  }
  throw new Error(
    "LocalizedText object has no non-empty value. Provide at least one locale entry, e.g. { en: \"…\" }.",
  );
}

const en = {
  "verdict.passed": "passed",
  "verdict.failed": "failed",
  "verdict.errored": "errored",
  "verdict.skipped": "skipped",
  "cell.missing": "no data",
  "cell.unscorable": "unscorable",
  "cell.noCurrentResult": "no result for current config",
  "cell.metricFailed": "failed",
  "cell.metricUnavailable": "unavailable",
  "cell.metricUnsupported": "unsupported",
  "cell.metricMigrationRequired": "migration required",
  "cell.measuredTitle": "{samples}/{total} attempts measured",
  "cell.noneMeasurableTitle": "0/{total} attempts measurable",
  "cell.coverageTitle": "coverage {samples}/{total}: this metric is null for the remaining attempts",
  "cell.coverageDetail": "Result coverage {samples}/{total}",
  "cell.evidence.one": "{n} attempt",
  "cell.evidence.other": "{n} attempts",
  "table.model": "Model",
  "table.agent": "Agent",
  "table.filterPlaceholder": "Filter rows…",
  "experimentList.experiment": "Experiment",
  "experimentList.avgDuration": "Avg. time",
  "experimentList.passRate": "Pass rate",
  "experimentList.totalScore": "Total score",
  "experimentList.missedScoreItems.one": "{n} missed check",
  "experimentList.missedScoreItems.other": "{n} missed checks",
  "experimentList.tokens": "Tokens",
  "experimentList.cost": "Cost",
  "experimentList.result": "Result",
  "experimentList.status": "Status",
  "experimentList.filterPlaceholder": "Filter experiments…",
} as const;

export type ReportMessageKey = keyof typeof en;

const zhCN: globalThis.Record<ReportMessageKey, string> = {
  "verdict.passed": "通过",
  "verdict.failed": "失败",
  "verdict.errored": "错误",
  "verdict.skipped": "跳过",
  "cell.missing": "无数据",
  "cell.unscorable": "测不出",
  "cell.noCurrentResult": "当前配置下无结果",
  "cell.metricFailed": "读取失败",
  "cell.metricUnavailable": "不可用",
  "cell.metricUnsupported": "不支持",
  "cell.metricMigrationRequired": "需要迁移",
  "cell.measuredTitle": "{samples}/{total} 次 attempt 测得",
  "cell.noneMeasurableTitle": "0/{total} 次 attempt 可测",
  "cell.coverageTitle": "覆盖率 {samples}/{total}:其余 attempt 测不了这个指标",
  "cell.coverageDetail": "结果完整度 {samples}/{total}",
  "cell.evidence.one": "{n} 个 Attempt",
  "cell.evidence.other": "{n} 个 Attempt",
  "table.model": "模型",
  "table.agent": "Agent",
  "table.filterPlaceholder": "筛选行…",
  "experimentList.experiment": "实验",
  "experimentList.avgDuration": "平均耗时",
  "experimentList.passRate": "通过率",
  "experimentList.totalScore": "总分",
  "experimentList.missedScoreItems.one": "{n} 项未满足",
  "experimentList.missedScoreItems.other": "{n} 项未满足",
  "experimentList.tokens": "Tokens",
  "experimentList.cost": "成本",
  "experimentList.result": "结果",
  "experimentList.status": "状态",
  "experimentList.filterPlaceholder": "筛选实验…",
};

const dictionaries: globalThis.Record<string, globalThis.Record<ReportMessageKey, string>> = {
  en,
  "zh-CN": zhCN,
};

/** 查字典 + 简单插值({name} 占位符)。内置词典未覆盖的 locale 回退 en。 */
export function localeText(
  locale: ReportLocale,
  key: ReportMessageKey,
  vars?: globalThis.Record<string, string | number>,
): string {
  const template = dictionaries[locale]?.[key] ?? dictionaries.en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/** 内置消息键 → 覆盖 DISPLAY_LOCALES 的 LocalizedText。 */
export function localizedMessage(key: ReportMessageKey): LocalizedText {
  const text: globalThis.Record<string, string> = {};
  for (const locale of DISPLAY_LOCALES) text[locale] = localeText(locale, key);
  return text;
}

/** 带单复数的计数文案:n === 1 用 `<base>.one`,其余用 `<base>.other`。 */
export function countText(
  locale: ReportLocale,
  base: "experimentList.missedScoreItems" | "cell.evidence",
  n: number,
): string {
  return localeText(locale, `${base}.${n === 1 ? "one" : "other"}` as ReportMessageKey, { n });
}
