// 官方组件 chrome 文案的 locale 字典与 LocalizedText 解析。
// ReportLocale 是开放的 BCP 47 标签(数据协议不封语言上限);官方内置文案与
// 官方固定文案覆盖 en / zh-CN；公共 MetricValue 由 renderer 按当前 locale 格式化。
//
// 领域数据里的 LocalizedText 仍在这里解析；所有官方 Web chrome 文案统一由
// app/i18n.ts 的 i18next catalog 拥有。

import i18n, { type TranslationKey } from "../../../i18n.ts";

export type LocalizedText = string | globalThis.Record<string, string>;

/** 报告渲染的 locale(BCP 47 标签,开放);默认 "en"。 */
export type ReportLocale = string;

export const DEFAULT_REPORT_LOCALE: ReportLocale = "en";

/** 官方固定文案覆盖的 locale 全集。 */
export const DISPLAY_LOCALES: readonly ReportLocale[] = ["en", "zh-CN"];

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

export type ReportMessageKey = Extract<TranslationKey,
  | `verdict.${string}`
  | `cell.${string}`
  | `table.${string}`
  | `experimentList.${string}`
>;

/** 通过唯一的 i18next Web catalog 读取指定 locale 的组件文案。 */
export function localeText(
  locale: ReportLocale,
  key: ReportMessageKey,
  vars?: globalThis.Record<string, string | number>,
): string {
  return i18n.getFixedT(locale)(key, vars);
}

/** 内置消息键 → 覆盖 DISPLAY_LOCALES 的 LocalizedText。 */
export function localizedMessage(key: ReportMessageKey): LocalizedText {
  return Object.freeze({
    en: localeText("en", key),
    "zh-CN": localeText("zh-CN", key),
  });
}

/** 带单复数的计数文案:n === 1 用 `<base>.one`,其余用 `<base>.other`。 */
export function countText(
  locale: ReportLocale,
  base: "experimentList.missedScoreItems" | "cell.evidence",
  n: number,
): string {
  return localeText(locale, base, { n });
}
