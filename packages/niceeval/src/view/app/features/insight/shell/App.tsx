import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocation, useMatches, useNavigate, useOutlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

import type { RefreshResult } from "../../../router.tsx";
import { useGenerationSnapshot, type GenerationController } from "../data/index.ts";
import type { ClosedOverview } from "../results/model.ts";
import type { ViewManifest } from "./manifest.ts";
import type { QueryClient } from "@tanstack/react-query";
import type { ViewGeneration } from "../data/index.ts";

export interface InsightRuntimeSnapshot {
  readonly generation: ViewGeneration<InsightRuntimeSnapshot>;
  readonly queryClient: QueryClient;
  readonly manifest: ViewManifest;
  readonly overview: ClosedOverview;
}

interface RouteHandle {
  readonly presentation: "page" | "overlay";
}

export function InsightApp({ controller, refresh }: {
  readonly controller: GenerationController<InsightRuntimeSnapshot>;
  readonly refresh: () => Promise<RefreshResult>;
}) {
  const { manifest } = useGenerationSnapshot(controller);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<RefreshResult["noticeKey"]>();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const matches = useMatches();
  const outlet = useOutlet();
  const background = (location.state as { background?: Location } | null)?.background;
  const currentHandle = matches.at(-1)?.handle as RouteHandle | undefined;
  const stablePage = useRef(outlet);
  if (currentHandle?.presentation !== "overlay" || background === undefined) stablePage.current = outlet;
  const locale = i18n.resolvedLanguage ?? "en";
  useEffect(() => { document.title = t("insight.title"); }, [t]);
  const options = manifest.experimentSelection?.options ?? [];
  const selected = options.find(({ route }) => location.pathname === route) ?? options[0];
  const interceptInsightLink = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (anchor === null || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, document.baseURI);
    if (url.origin !== window.location.origin || !url.hash.startsWith("#/")) return;
    const route = url.hash.slice(1);
    if (!route.startsWith("/attempt/") && !route.startsWith("/run/") && !route.startsWith("/experiment/")) return;
    event.preventDefault();
    navigate(route, { state: { background: background ?? location } });
  }, [background, location, navigate]);
  return (
    <div onClickCapture={interceptInsightLink}>
      <header className="niceeval-view-shell">
        <a className="niceeval-view-brand" href="https://niceeval.com/?utm_source=insight&utm_medium=brand" target="_blank" rel="noopener">
          <span className="niceeval-view-mark" aria-hidden="true" /><span>NiceEval</span>
        </a>
        <nav className="niceeval-view-nav" aria-label={t("nav.pages")}>
          <a href={`#${manifest.defaultRoute}`} aria-current={currentHandle?.presentation === "page" ? "page" : undefined}>
            {t("insight.navigation")}
          </a>
        </nav>
        <div className="niceeval-view-controls">
          {selected !== undefined ? <label className="niceeval-view-experiment">
            <span>{t("nav.experiments")}</span>
            <select value={selected.route} onChange={(event) => navigate(event.target.value)}>
              {options.map((option) => <option key={option.route} value={option.route}>{option.label}</option>)}
            </select>
          </label> : null}
          <label className="niceeval-view-language">
            <select aria-label={t("nav.language")} value={locale} onChange={(event) => void i18n.changeLanguage(event.target.value)}>
              <option value="en">EN</option><option value="zh-CN">中文</option>
            </select>
          </label>
          <button type="button" disabled={refreshing} onClick={() => {
            setRefreshing(true);
            setRefreshFailed(false);
            setRefreshNotice(undefined);
            void refresh().then((result) => {
              setRefreshNotice(result.noticeKey);
            }).catch(() => setRefreshFailed(true)).finally(() => setRefreshing(false));
          }}>{t(refreshing ? "refresh.working" : "refresh.action")}</button>
          {refreshNotice === undefined ? null : <span role="status">{t(refreshNotice)}</span>}
          {refreshFailed ? <span role="alert">{t("refresh.failed")}</span> : null}
        </div>
      </header>
      <main className="niceeval-view-main">{background === undefined ? outlet : <>{stablePage.current}{outlet}</>}</main>
    </div>
  );
}
