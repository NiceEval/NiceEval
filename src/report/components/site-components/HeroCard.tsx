// HeroCard:站点标题区的 web 面——hero 标题(h1)与品牌行(等同 PoweredBy,
// 恒含、无拆除 prop)。标题输入是站点声明与 Sample 的合成物。data 保留在双面
// 组件契约中供 text 面输出运行摘要,web 面不展示(docs/feature/reports/components/site/hero-card.md)。

import type { ReactElement } from "react";
import type { HeroData } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import { cx } from "../shared.ts";
import type { HeroBrandProps } from "./hero-types.ts";
import { PoweredBy } from "./PoweredBy.tsx";

/**
 * 站点标题区(纯 web 渲染面):可选品牌内容 + `<h1>` 标题 + NiceEval 品牌行。
 * 嵌入自有 React 页面时配合 `heroData()` 使用。
 */
export function HeroCard({
  title,
  logo,
  description,
  links = [],
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: HeroBrandProps & {
  title: LocalizedText;
  data: HeroData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  return (
    <header className={cx("niceeval-report", "niceeval-hero", className)}>
      {logo !== undefined ? (
        <img
          className="niceeval-hero-logo"
          src={logo.src}
          alt={resolveLocalizedText(logo.alt, locale)}
        />
      ) : null}
      <h1 className="niceeval-hero-title">{resolveLocalizedText(title, locale)}</h1>
      {description !== undefined ? (
        <p className="niceeval-hero-description">{resolveLocalizedText(description, locale)}</p>
      ) : null}
      {links.length > 0 ? (
        <nav className="niceeval-hero-links">
          {links.map((link) => (
            <a
              key={`${link.href}:${resolveLocalizedText(link.label, locale)}`}
              className="niceeval-hero-link"
              href={link.href}
              rel="noopener"
            >
              {resolveLocalizedText(link.label, locale)}
            </a>
          ))}
        </nav>
      ) : null}
      {/* 品牌行与 PoweredBy 同一渲染:品牌跟着组件走,不区分官方宿主与嵌入页面 */}
      <PoweredBy />
    </header>
  );
}
