import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import { initialLocale, message, persistLocale } from "./i18n.ts";
import type {
  Locale,
  ReportManifest,
  ReportPageContent,
  ReportPageLoader,
  ReportPageManifest,
} from "./types.ts";
import type { OverlayNavigation } from "./routes.tsx";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly content: ReportPageContent }
  | { readonly status: "error" };
function localized(
  value: { readonly en: string; readonly "zh-CN": string },
  locale: Locale,
): string {
  return value[locale] || value.en;
}
function usePage(
  page: ReportPageManifest,
  locale: Locale,
  loadPage: ReportPageLoader,
): [LoadState, () => void] {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const revision = useRef(0);
  useEffect(() => {
    const request = ++revision.current;
    let active = true;
    setState({ status: "loading" });
    void loadPage(page, locale)
      .then((content) => {
        if (active && revision.current === request)
          setState({ status: "ready", content });
      })
      .catch(() => {
        if (active && revision.current === request)
          setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [loadPage, locale, page, reload]);
  return [state, () => setReload((value) => value + 1)];
}
function FragmentBody({
  state,
  locale,
  retry,
  overlay,
}: {
  readonly state: LoadState;
  readonly locale: Locale;
  readonly retry: () => void;
  readonly overlay: boolean;
}) {
  if (state.status === "loading")
    return (
      <div
        className={`niceeval-view-skeleton${overlay ? " niceeval-view-skeleton-overlay" : ""}`}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="niceeval-view-sr-only">
          {message(locale, overlay ? "loadingDetails" : "loading")}
        </span>
        <div className="niceeval-view-skeleton-heading" aria-hidden="true">
          <span className="niceeval-view-skeleton-line niceeval-view-skeleton-eyebrow" />
          <span className="niceeval-view-skeleton-line niceeval-view-skeleton-title" />
          <span className="niceeval-view-skeleton-line niceeval-view-skeleton-copy" />
        </div>
        <div className="niceeval-view-skeleton-cards" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="niceeval-view-skeleton-content" aria-hidden="true">
          <span className="niceeval-view-skeleton-chart" />
          <span className="niceeval-view-skeleton-table">
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  if (state.status === "error")
    return (
      <div role="alert">
        <p>
          {message(locale, overlay ? "unableToLoadDetails" : "unableToLoad")}
        </p>
        <button type="button" onClick={retry}>
          {message(locale, "retry")}
        </button>
      </div>
    );
  return <>{state.content.body}</>;
}
export function ReportPage({
  page,
  locale,
  loadPage,
}: {
  readonly page: ReportPageManifest;
  readonly locale: Locale;
  readonly loadPage: ReportPageLoader;
}) {
  const [state, retry] = usePage(page, locale, loadPage);
  return (
    <FragmentBody state={state} locale={locale} retry={retry} overlay={false} />
  );
}
export function ReportOverlay({
  page,
  locale,
  navigation,
  loadPage,
}: {
  readonly page: ReportPageManifest;
  readonly locale: Locale;
  readonly navigation: OverlayNavigation;
  readonly loadPage: ReportPageLoader;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const background = navigation.background(location.state);
  const [state, retry] = usePage(page, locale, loadPage);
  const close = useCallback(() => {
    if (background.fromHistory) navigate(-1);
    else navigate(navigation.defaultRoute, { replace: true });
  }, [background.fromHistory, navigate, navigation]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const bodyWasLocked = document.body.classList.contains(
      "niceeval-view-modal-open",
    );
    document.body.classList.add("niceeval-view-modal-open");
    dialog.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) =>
        element.getClientRects().length > 0 &&
        !element.closest("[hidden], [inert], [aria-hidden=\"true\"]")
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (!bodyWasLocked) {
        document.body.classList.remove("niceeval-view-modal-open");
      }
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [close]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        className="niceeval-view-dialog-overlay"
        aria-hidden="true"
        onClick={close}
      />
      <div
        ref={dialogRef}
        className="niceeval-view-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="niceeval-view-dialog-head">
          <h2 id={titleId} className="niceeval-view-dialog-title">
            {state.status === "ready"
              ? localized(state.content.title, locale)
              : message(locale, "details")}
          </h2>
          <button
            type="button"
            className="niceeval-view-dialog-close"
            aria-label={message(locale, "close")}
            onClick={close}
          >
            x
          </button>
        </div>
        <div
          className="niceeval-view-dialog-body niceeval-view-report-slot"
          aria-busy={state.status === "loading"}
        >
          <FragmentBody
            state={state}
            locale={locale}
            retry={retry}
            overlay
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
export function App({
  manifest,
  navigation,
  loadPage,
  reset,
}: {
  readonly manifest: ReportManifest;
  readonly navigation: OverlayNavigation;
  readonly loadPage: ReportPageLoader;
  readonly reset: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const matches = useMatches();
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const refresh = useRevisionRefresh(reset);
  const current = navigation.current(matches);
  const visible =
    current?.presentation === "overlay"
      ? navigation.background(location.state).page
      : current?.page;
  useEffect(() => {
    persistLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    document.title = localized(manifest.title, locale);
  }, [locale, manifest.title]);
  const onDocumentClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      navigation.intercept(event, location, (route, state, replace) =>
        navigate(route, state === undefined ? { replace } : { state, replace }),
      );
    },
    [location, navigate, navigation],
  );
  const pages = manifest.pages.filter(
    (page) => page.presentation === "page" && page.navigation,
  );
  const experimentOptions = manifest.experimentSelection?.options ?? [];
  const currentExperiment = experimentOptions.find(
    (option) => option.route === visible?.route,
  ) ?? experimentOptions[0];
  const experimentLabel = locale === "zh-CN" ? "实验" : "Experiments";
  return (
    <div onClickCapture={onDocumentClick}>
      <header className="niceeval-view-shell">
        <a
          className="niceeval-view-brand"
          href="https://niceeval.com/?utm_source=report&utm_medium=brand"
          target="_blank"
          rel="noopener"
        >
          <span className="niceeval-view-mark" aria-hidden="true" />
          <span>NiceEval</span>
        </a>
        <div className="niceeval-view-pages">
          <nav
            className="niceeval-view-nav"
            aria-label={locale === "zh-CN" ? "报告页面" : "Report pages"}
          >
            <ul>
              {pages.map((page) => (
                <li key={page.pageId}>
                  <a
                    href={`#${page.route === "/" && currentExperiment !== undefined
                      ? currentExperiment.route
                      : page.route}`}
                    aria-current={
                      visible?.route === page.route ||
                        (page.route === "/" && currentExperiment !== undefined)
                        ? "page"
                        : undefined
                    }
                  >
                    {localized(page.title, locale)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="niceeval-view-controls">
          {experimentOptions.length > 0 && currentExperiment !== undefined && (
            <div className="niceeval-view-experiment">
              <label>
                <span>{experimentLabel}</span>
                <select
                  aria-label={experimentLabel}
                  value={currentExperiment.route}
                  onChange={(event) => {
                    const route = event.target.value;
                    if (route !== currentExperiment.route) {
                      navigate(route, {
                        replace: current?.presentation === "overlay",
                      });
                    }
                  }}
                >
                  {experimentOptions.map((option) => (
                    <option key={option.route} value={option.route}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="niceeval-view-language">
            <select
              aria-label="Language"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              <option value="en">EN</option>
              <option value="zh-CN">中文</option>
            </select>
          </label>
        </div>
      </header>
      {refresh.available ? (
        <aside className="niceeval-view-refresh" role="status">
          <span>{locale === "zh-CN" ? "有更新的封存结果可用。" : "A newer sealed result is available."}</span>
          <button type="button" disabled={refresh.working} onClick={refresh.apply}>
            {refresh.working
              ? locale === "zh-CN" ? "正在刷新…" : "Refreshing…"
              : locale === "zh-CN" ? "刷新" : "Refresh"}
          </button>
        </aside>
      ) : null}
      <main className="niceeval-view-main">
        {visible && (
          <div className="niceeval-view-report-slot">
            <ReportPage page={visible} locale={locale} loadPage={loadPage} />
          </div>
        )}
        <Outlet context={{ locale, loadPage }} />
      </main>
    </div>
  );
}
export interface ReportOutletContext {
  readonly locale: Locale;
  readonly loadPage: ReportPageLoader;
}

function useRevisionRefresh(reset: () => void): {
  readonly available: boolean;
  readonly working: boolean;
  readonly apply: () => void;
} {
  const [available, setAvailable] = useState(false);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const probe = async (): Promise<void> => {
      try {
        const response = await fetch(new URL("record.sqlite", document.baseURI), {
          method: "HEAD",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!active) return;
        setAvailable(response.headers.get("x-niceeval-view-stale") === "1");
        if (response.headers.get("x-niceeval-view-refresh") === "supported") {
          timer = window.setTimeout(() => void probe(), 500);
        }
      } catch {
        // A fixed RecordSnapshot remains usable when no operational watcher exists.
      }
    };
    void probe();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  const apply = (): void => {
    setWorking(true);
    void fetch(new URL("record.sqlite", document.baseURI), {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-niceeval-view-action": "refresh" },
    }).then((response) => {
      if (!response.ok) throw new Error("refresh failed");
      reset();
      location.reload();
    }).catch(() => setWorking(false));
  };
  return { available, working, apply };
}
