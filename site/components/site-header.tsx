"use client";

import Link from "next/link";
import { docsUrl, githubUrl, otherLocale, withLocale, type Dictionary, type Locale } from "../lib/content";
import { track } from "../src/analytics";

const LOCALE_COOKIE = "niceeval-locale";

export type Route = { name: "home" } | { name: "blog" } | { name: "post"; slug: string };

// route 里的相对路径,用来拼当前页在另一种语言下的对应 URL。
export function routeHref(locale: Locale, route: Route) {
  if (route.name === "blog") return withLocale(locale, "blog");
  if (route.name === "post") return withLocale(locale, `blog/${route.slug}`);
  return withLocale(locale);
}

export function rememberLocale(locale: Locale) {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000`;
  } catch {
    // Language switching still works for this navigation even if the cookie can't be set.
  }
}

export function Header({ locale, t, route }: { locale: Locale; t: Dictionary; route: Route }) {
  const nextLocale = otherLocale(locale);
  const startHref = route.name === "home" ? "#setup" : `${withLocale(locale)}#setup`;

  return (
    <header className="topbar shell">
      <Link
        className="brand"
        href={withLocale(locale)}
        aria-label="NiceEval home"
        onClick={() => track("Click Home Link", { location: "header" })}
      >
        <span className="mark" />
        <span>NiceEval</span>
      </Link>
      <nav className="nav" aria-label="Primary">
        <Link href={startHref} onClick={() => track("Click Nav Start")}>
          {t.navStart}
        </Link>
        <Link
          href={withLocale(locale, "blog")}
          onClick={() => track("Click Blog Link", { location: "header", locale })}
        >
          {t.blog}
        </Link>
        <a href={docsUrl[locale]} onClick={() => track("Click Docs Link", { location: "header", locale })}>{t.docs}</a>
        <a href={githubUrl} onClick={() => track("Click GitHub Link", { location: "header" })}>{t.github}</a>
        <Link
          className="lang-toggle"
          aria-label={t.languageLabel}
          href={routeHref(nextLocale, route)}
          onClick={() => {
            track("Switch Language", { from: locale, to: nextLocale });
            rememberLocale(nextLocale);
          }}
        >
          {nextLocale === "zh" ? "中文" : "EN"}
        </Link>
      </nav>
    </header>
  );
}
