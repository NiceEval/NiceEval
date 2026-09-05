import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";

import type { RefreshResult } from "../../../router.tsx";
import { AttemptRoute } from "../attempt/AttemptRoute.tsx";
import { useCurrentGeneration } from "../data/index.ts";
import { ResultsRoute } from "../results/ResultsPage.tsx";
import type { ClosedOverview } from "../results/model.ts";
import { RunRoute } from "../run/RunPage.tsx";
import { resolveSurfacePlan, surfaceKey, targetForRoute, type ViewManifest } from "./manifest.ts";
import {
  RefreshInteractionProvider,
  useRefreshNavigationLock,
  type AcquireRefreshNavigationLock,
} from "./refresh-lock.tsx";
import type { InsightCloseTarget, InsightSurface, InsightSurfacePlan } from "./types.ts";

export interface PreparedInsightPresentation {
  readonly originLocationKey: string;
  readonly plan: InsightSurfacePlan;
}

export interface InsightRuntimeSnapshot {
  readonly manifest: ViewManifest;
  readonly overview: ClosedOverview;
  readonly presentation?: PreparedInsightPresentation;
}

export function InsightApp({ checkForUpdate, refresh }: {
  readonly refresh: (acquireLock: AcquireRefreshNavigationLock) => Promise<RefreshResult>;
  readonly checkForUpdate: () => Promise<boolean>;
}) {
  const generation = useCurrentGeneration();
  const { manifest, presentation } = generation.snapshot as InsightRuntimeSnapshot;
  const { acquire, interactionLocked, recoveryRequired } = useRefreshNavigationLock();
  const { t } = useTranslation();
  if (recoveryRequired) return <main className="niceeval-view-main" role="alert">
    <h1>{t("refresh.reloadRequired")}</h1>
    <p>{t("refresh.reloadRequiredDetail")}</p>
    <button type="button" onClick={() => window.location.reload()}>{t("refresh.reload")}</button>
  </main>;
  return <RefreshInteractionProvider locked={interactionLocked}>
    <InsightShell
      manifest={manifest}
      presentation={presentation}
      refresh={() => refresh(acquire)}
      checkForUpdate={checkForUpdate}
      interactionLocked={interactionLocked}
    />
  </RefreshInteractionProvider>;
}

function InsightShell({ checkForUpdate, interactionLocked, manifest, presentation, refresh }: {
  readonly manifest: ViewManifest;
  readonly presentation?: PreparedInsightPresentation;
  readonly refresh: () => Promise<RefreshResult>;
  readonly checkForUpdate: () => Promise<boolean>;
  readonly interactionLocked: boolean;
}) {
  const generation = useCurrentGeneration();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<RefreshResult["noticeKey"]>();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const update = useQuery({
    queryKey: ["view", generation.identity, "update-available"],
    queryFn: checkForUpdate,
    refetchInterval: 500,
    staleTime: 0,
    retry: false,
  });
  const presentationState = useRef<{
    readonly generationIdentity: string;
    readonly originLocationKey: string;
    consumed: boolean;
  } | undefined>(undefined);
  if (presentation === undefined) {
    presentationState.current = undefined;
  } else if (
    presentationState.current?.generationIdentity !== generation.identity ||
    presentationState.current.originLocationKey !== presentation.originLocationKey
  ) {
    presentationState.current = {
      generationIdentity: generation.identity,
      originLocationKey: presentation.originLocationKey,
      consumed: false,
    };
  }
  if (presentationState.current !== undefined && location.key !== presentationState.current.originLocationKey) {
    presentationState.current.consumed = true;
  }
  const surfaces = presentation !== undefined && presentationState.current?.consumed === false
    ? presentation.plan
    : resolveSurfacePlan(manifest, location);
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
    const target = targetForRoute(manifest, route);
    if (target === undefined) return;
    event.preventDefault();
    if (target.kind === "run" || target.kind === "attempt") {
      navigate(route, { state: { background: surfaces.background.location } });
    } else {
      navigate(route, { state: null });
    }
  }, [manifest, navigate, surfaces.background.location]);
  const close = useCallback((target: InsightCloseTarget) => {
    if (target.kind === "history") navigate(-1);
    else navigate(target.route, { replace: true, state: null });
  }, [navigate]);
  const foreground = surfaces.foreground;
  return (
    <div onClickCapture={interceptInsightLink}>
      <header className="niceeval-view-shell">
        <a className="niceeval-view-brand" href="https://niceeval.com/?utm_source=insight&utm_medium=brand" target="_blank" rel="noopener">
          <span className="niceeval-view-mark" aria-hidden="true" /><span>NiceEval</span>
        </a>
        <nav className="niceeval-view-nav" aria-label={t("nav.pages")}>
          <a
            href={`#${manifest.defaultRoute}`}
            aria-current={surfaces.foreground === undefined ? "page" : undefined}
            aria-disabled={interactionLocked || undefined}
          >
            {t("insight.navigation")}
          </a>
        </nav>
        <div className="niceeval-view-controls">
          {selected !== undefined ? <label className="niceeval-view-experiment">
            <span>{t("nav.experiments")}</span>
            <select disabled={interactionLocked} value={selected.route} onChange={(event) => navigate(event.target.value)}>
              {options.map((option) => <option key={option.route} value={option.route}>{option.label}</option>)}
            </select>
          </label> : null}
          <label className="niceeval-view-language">
            <select disabled={interactionLocked} aria-label={t("nav.language")} value={locale} onChange={(event) => void i18n.changeLanguage(event.target.value)}>
              <option value="en">EN</option><option value="zh-CN">中文</option>
            </select>
          </label>
          <button type="button" disabled={refreshing || interactionLocked} onClick={() => {
            setRefreshing(true);
            setRefreshFailed(false);
            setRefreshNotice(undefined);
            void refresh().then((result) => {
              setRefreshNotice(result.noticeKey);
            }).catch(() => setRefreshFailed(true)).finally(() => setRefreshing(false));
          }}>{t(refreshing ? "refresh.working" : "refresh.action")}</button>
          {update.data === true && !refreshing ? <span role="status">{t("refresh.available")}</span> : null}
          {refreshNotice === undefined ? null : <span role="status">{t(refreshNotice)}</span>}
          {refreshFailed ? <span role="alert">{t("refresh.failed")}</span> : null}
        </div>
      </header>
      <main className="niceeval-view-main" inert={interactionLocked ? true : undefined}>
        <SurfaceView key={`background:${surfaceKey(surfaces.background)}`} surface={surfaces.background} />
        {foreground === undefined
          ? null
          : <SurfaceView
              key={`foreground:${surfaceKey(foreground)}`}
              surface={foreground}
              onClose={() => close(foreground.close)}
            />}
      </main>
    </div>
  );
}

function SurfaceView({ surface, onClose }: {
  readonly surface: InsightSurface;
  readonly onClose?: () => void;
}): ReactElement {
  const { target, presentation } = surface;
  if (target.kind === "group" || target.kind === "experiment") return <ResultsRoute target={target} />;
  if (target.kind === "run") return <RunRoute runId={target.runId} presentation={presentation} onClose={onClose} />;
  if (onClose === undefined) throw new Error("Attempt dialog close target is missing.");
  return <AttemptRoute locator={target.locator} onClose={onClose} />;
}
