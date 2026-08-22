import * as Dialog from "@radix-ui/react-dialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import { initialLocale, message, persistLocale } from "./i18n.ts";
import type {
  Locale,
  ReportFragment,
  ReportManifest,
  ReportPageManifest,
} from "./types.ts";
import type { OverlayNavigation } from "./routes.tsx";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly fragment: ReportFragment }
  | { readonly status: "error" };
function localized(
  value: { readonly en: string; readonly "zh-CN": string },
  locale: Locale,
): string {
  return value[locale] || value.en;
}
function useFragment(page: ReportPageManifest): [LoadState, () => void] {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const revision = useRef(0);
  useEffect(() => {
    const request = ++revision.current;
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetch(new URL(page.fragment, document.baseURI), {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ReportFragment;
      })
      .then((fragment) => {
        if (revision.current === request)
          setState({ status: "ready", fragment });
      })
      .catch(() => {
        if (revision.current === request && !controller.signal.aborted)
          setState({ status: "error" });
      });
    return () => controller.abort();
  }, [page, reload]);
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
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: localized(state.fragment.html, locale),
      }}
    />
  );
}
export function ReportPage({
  page,
  locale,
}: {
  readonly page: ReportPageManifest;
  readonly locale: Locale;
}) {
  const [state, retry] = useFragment(page);
  return (
    <FragmentBody state={state} locale={locale} retry={retry} overlay={false} />
  );
}
export function ReportOverlay({
  page,
  locale,
  navigation,
}: {
  readonly page: ReportPageManifest;
  readonly locale: Locale;
  readonly navigation: OverlayNavigation;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const background = navigation.background(location.state);
  const [state, retry] = useFragment(page);
  const close = useCallback(() => {
    if (background.fromHistory) navigate(-1);
    else navigate(navigation.defaultRoute, { replace: true });
  }, [background.fromHistory, navigate, navigation]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgb(0 0 0 / 50%)",
            zIndex: 20,
          }}
        />
        <Dialog.Content
          className="niceeval-view-dialog"
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 21,
          }}
          aria-describedby={undefined}
        >
          <div className="niceeval-view-dialog-head">
            <Dialog.Title className="niceeval-view-dialog-title">
              {state.status === "ready"
                ? localized(state.fragment.title, locale)
                : message(locale, "details")}
            </Dialog.Title>
            <Dialog.Close
              className="niceeval-view-dialog-close"
              aria-label={message(locale, "close")}
            >
              x
            </Dialog.Close>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function App({
  manifest,
  navigation,
}: {
  readonly manifest: ReportManifest;
  readonly navigation: OverlayNavigation;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const matches = useMatches();
  const [locale, setLocale] = useState<Locale>(initialLocale);
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
                    href={`#${page.route}`}
                    aria-current={
                      visible?.route === page.route ? "page" : undefined
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
      <main className="niceeval-view-main">
        {visible && (
          <div className="niceeval-view-report-slot">
            <ReportPage page={visible} locale={locale} />
          </div>
        )}
        <Outlet context={{ locale }} />
      </main>
    </div>
  );
}
export interface ReportOutletContext {
  readonly locale: Locale;
}
