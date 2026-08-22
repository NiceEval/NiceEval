import {
  Navigate,
  matchRoutes,
  useOutletContext,
  type Location,
  type RouteObject,
  type UIMatch,
} from "react-router-dom";
import {
  App,
  ReportOverlay,
  ReportPage,
  type ReportOutletContext,
} from "./App.tsx";
import type {
  ReportManifest,
  ReportPageManifest,
  ReportRouteState,
} from "./types.ts";

export interface ReportRouteHandle {
  readonly page: ReportPageManifest;
  readonly presentation: ReportPageManifest["presentation"];
}
interface BackgroundPage {
  readonly page: ReportPageManifest;
  readonly fromHistory: boolean;
}
export interface OverlayNavigation {
  readonly defaultRoute: string;
  current(matches: readonly UIMatch[]): ReportRouteHandle | undefined;
  background(state: unknown): BackgroundPage;
  intercept(
    event: React.MouseEvent<HTMLElement>,
    location: Location,
    navigate: (route: string, state?: ReportRouteState, replace?: boolean) => void,
  ): void;
}
function childRoute(
  page: ReportPageManifest,
  element: React.ReactNode,
): RouteObject {
  const handle: ReportRouteHandle = { page, presentation: page.presentation };
  return page.route === "/"
    ? { index: true, element, handle }
    : { path: page.route.slice(1), element, handle };
}
function routeHandle(
  routes: RouteObject[],
  pathname: string,
): ReportRouteHandle | undefined {
  return matchRoutes(routes, { pathname })?.at(-1)?.route.handle as
    | ReportRouteHandle
    | undefined;
}

export function createReportRoutes(manifest: ReportManifest): RouteObject[] {
  let routes: RouteObject[] = [];
  const pageByRoute = new Map(
    manifest.pages
      .filter((page) => page.presentation === "page")
      .map((page) => [page.route, page]),
  );
  const defaultPage = pageByRoute.get(manifest.defaultRoute);
  if (!defaultPage)
    throw new Error(`Missing default report page ${manifest.defaultRoute}`);
  const navigation: OverlayNavigation = {
    defaultRoute: manifest.defaultRoute,
    current: (matches) =>
      matches.at(-1)?.handle as ReportRouteHandle | undefined,
    background: (state) => {
      const candidate = (state as ReportRouteState | null)?.background;
      const matched =
        candidate === undefined
          ? undefined
          : routeHandle(routes, candidate.pathname);
      return matched?.presentation === "page"
        ? { page: matched.page, fromHistory: true }
        : { page: defaultPage, fromHistory: false };
    },
    intercept: (event, location, navigate) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.hasAttribute("download")
      )
        return;
      let url: URL;
      try {
        url = new URL(anchor.getAttribute("href") ?? "", document.baseURI);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || !url.hash.startsWith("#/"))
        return;
      const route = url.hash.slice(1);
      const matched = routeHandle(routes, route);
      if (!matched) return;
      event.preventDefault();
      if (matched.presentation === "overlay") {
        const active = routeHandle(routes, location.pathname);
        const existing = (location.state as ReportRouteState | null)
          ?.background;
        const background =
          existing ??
          (active?.presentation === "page"
            ? { pathname: location.pathname, search: location.search }
            : { pathname: manifest.defaultRoute });
        // Moving from one overlay to another replaces the transient overlay
        // entry. Close/back therefore returns to the stable background Page,
        // while forward restores the latest shareable overlay URL.
        navigate(route, { background }, active?.presentation === "overlay");
      } else navigate(route);
    },
  };
  function PageRoute({ page }: { readonly page: ReportPageManifest }) {
    const { locale } = useOutletContext<ReportOutletContext>();
    return (
      <div className="niceeval-view-report-slot">
        <ReportPage page={page} locale={locale} />
      </div>
    );
  }
  function OverlayRoute({ page }: { readonly page: ReportPageManifest }) {
    const { locale } = useOutletContext<ReportOutletContext>();
    return (
      <ReportOverlay page={page} locale={locale} navigation={navigation} />
    );
  }
  function RoutedApp() {
    return <App manifest={manifest} navigation={navigation} />;
  }
  const children: RouteObject[] = [];
  for (const page of manifest.pages)
    if (page.route !== "/" || page.route === manifest.defaultRoute)
      children.push(
        childRoute(
          page,
          page.presentation === "overlay" ? (
            <OverlayRoute page={page} />
          ) : (
            <PageRoute page={page} />
          ),
        ),
      );
  if (manifest.defaultRoute !== "/")
    children.unshift({
      index: true,
      element: <Navigate to={manifest.defaultRoute} replace />,
    });
  routes = [{ path: "/", element: <RoutedApp />, children }];
  return routes;
}
