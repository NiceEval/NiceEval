// HeroCard:站点标题区的 web 面——hero 标题(h1)、运行 meta(最后运行时间按渲染 locale
// 格式化;latestStartedAt 为 null 时内置「暂无运行」文案;runs > 1 时标注合成来源)
// 与品牌行(等同 PoweredBy,恒含、无拆除 prop)。标题输入是站点声明与 Sample 的合成物,
// 组件只收 data 形态(docs/feature/reports/components/site/hero-card.md)。

import type { ReactElement } from "react";
import type { HeroData } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import { cx } from "../shared.ts";
import { PoweredBy } from "./PoweredBy.tsx";

/** ISO 时间 → 按 locale 的「最后运行」显示(年月日 时:分);不可解析原样返回。 */
function formatLastRun(iso: string, locale: ReportLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * 站点标题区(纯 web 渲染面):`<h1>` 标题 + meta 行 + 品牌行。
 * 嵌入自有 React 页面时配合 `heroData()` 使用。
 */
export function HeroCard({
  title,
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  title: LocalizedText;
  data: HeroData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const meta =
    data.latestStartedAt === null
      ? localeText(locale, "hero.noRuns")
      : [
          localeText(locale, "hero.lastRun", { time: formatLastRun(data.latestStartedAt, locale) }),
          ...(data.runs > 1 ? [localeText(locale, "hero.composedRuns", { n: data.runs })] : []),
        ].join(" · ");
  return (
    <header className={cx("nre", "nre-hero", className)}>
      <h1 className="nre-hero-title">{resolveLocalizedText(title, locale)}</h1>
      <p className="nre-hero-meta">{meta}</p>
      {/* 品牌行与 PoweredBy 同一渲染:品牌跟着组件走,不区分官方宿主与嵌入页面 */}
      <PoweredBy />
    </header>
  );
}
