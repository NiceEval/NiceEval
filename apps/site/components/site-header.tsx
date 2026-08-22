"use client";

import Link from "next/link";
import { githubUrl, otherLocale, withLocale, type Dictionary, type Locale } from "../lib/content";
import { track } from "../src/analytics";
import { LogoMark } from "./logo";

// 仅 header 导航指向 introduction;首页的 docsUrl 引用保持 quickstart。
const headerDocsUrl: Record<Locale, string> = {
  en: "https://niceeval.com/docs/introduction",
  zh: "https://niceeval.com/docs/zh/introduction",
};

export type Route = { name: "home" } | { name: "blog" } | { name: "post"; slug: string };

// route 里的相对路径,用来拼当前页在另一种语言下的对应 URL。
export function routeHref(locale: Locale, route: Route) {
  if (route.name === "blog") return withLocale(locale, "blog");
  if (route.name === "post") return withLocale(locale, `blog/${route.slug}`);
  return withLocale(locale);
}

export function Header({ locale, t, route }: { locale: Locale; t: Dictionary; route: Route }) {
  const nextLocale = otherLocale(locale);
  const startHref = route.name === "home" ? "#setup" : `${withLocale(locale)}#setup`;

  return (
    <header className="topbar shell">
      {/* 当前页不渲染指向自身的链接:自链会被 SEO 审计判为浪费权重。 */}
      {route.name === "home" ? (
        <span className="brand" aria-current="page">
          <LogoMark size={24} />
          <span>NiceEval</span>
        </span>
      ) : (
        <Link
          className="brand"
          href={withLocale(locale)}
          aria-label="NiceEval home"
          onClick={() => track("Click Home Link", { location: "header" })}
        >
          <LogoMark size={24} />
          <span>NiceEval</span>
        </Link>
      )}
      <nav className="nav" aria-label="Primary">
        <Link href={startHref} onClick={() => track("Click Nav Start")}>
          {t.navStart}
        </Link>
        {route.name === "blog" ? (
          <span aria-current="page">{t.blog}</span>
        ) : (
          <Link
            href={withLocale(locale, "blog")}
            onClick={() => track("Click Blog Link", { location: "header", locale })}
          >
            {t.blog}
          </Link>
        )}
        <a href={headerDocsUrl[locale]} onClick={() => track("Click Docs Link", { location: "header", locale })}>{t.docs}</a>
        <a href={githubUrl} onClick={() => track("Click GitHub Link", { location: "header" })}>{t.github}</a>
        {/* 切语言必须走完整文档请求。英文正式 URL 没有文件系统 page,只靠
            next.config rewrite 到 /en;Next Link 客户端导航会打到 /en,再被
            proxy 308 回 /,结果 404。 */}
        <a
          className="lang-toggle"
          aria-label={t.languageLabel}
          href={routeHref(nextLocale, route)}
          onClick={() => {
            track("Switch Language", { from: locale, to: nextLocale });
          }}
        >
          {nextLocale === "zh" ? "中文" : "EN"}
        </a>
      </nav>
    </header>
  );
}
