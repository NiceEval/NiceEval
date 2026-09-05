import { createHashRouter, replace, useRouteError, type LoaderFunctionArgs } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ViewRuntime, InspectionRuntimeProvider, type GenerationLease } from "./features/insight/data/index.ts";
import { overviewOperation, RouteInputError } from "./features/insight/data/operations.ts";
import { attemptQueryOptions } from "./features/insight/attempt/data/load.ts";
import { resultsQueryOptions, experimentQueryOptions } from "./features/insight/results/load.ts";
import { closeOverview, type ClosedOverview } from "./features/insight/results/model.ts";
import { runQueryOptions } from "./features/insight/run/load.ts";
import {
  InsightApp,
  type InsightRuntimeSnapshot,
  type PreparedInsightPresentation,
} from "./features/insight/shell/App.tsx";
import type { RefreshNavigationLock } from "./features/insight/shell/refresh-lock.tsx";
import {
  resolveSurfacePlan,
  targetForRoute,
  targetFromRouteParts,
  viewManifest,
  type ViewManifest,
} from "./features/insight/shell/manifest.ts";
import type { BackgroundLocation, InsightSurfacePlan, InsightTarget } from "./features/insight/shell/types.ts";
import {
  commitGeneration,
  fetchCurrentGeneration,
  HttpInspectionRepository,
  refreshGeneration,
  ViewHttpError,
} from "./http/repository.ts";

export interface RefreshResult {
  readonly manifest: ViewManifest;
  readonly fallbackRoute?: string;
  readonly noticeKey?: "refresh.selectionChanged";
}
export class GenerationPrepareError extends Error {
  readonly classification = "generation-prepare" as const;
  readonly translationKey = "report.unableToLoad" as const;
}

export async function createViewRouter(unmountRoot: () => void) {
  const selectedRunIds = new URL(document.baseURI).searchParams.getAll("run");
  const generations = new ViewRuntime<InsightRuntimeSnapshot>();
  const pageLifetime = new AbortController();
  let disposeRouter: (() => void) | undefined;
  window.addEventListener("pagehide", () => {
    pageLifetime.abort(new Error("NiceEval View page was hidden."));
    unmountRoot();
    disposeRouter?.();
    generations.dispose();
  }, { once: true });
  const initialDescriptor = await fetchCurrentGeneration();
  const prepared = generations.prepare(new HttpInspectionRepository(initialDescriptor));
  let manifest: ViewManifest;
  let overview: ClosedOverview;
  try {
    overview = closeOverview(await prepared.lease.inspect(overviewOperation(selectedRunIds)));
    manifest = viewManifest(overview.catalog);
    const initialLocation = decodeInitialHashLocation(manifest.defaultRoute);
    const preparedLocation = targetForRoute(manifest, initialLocation.pathname) === undefined
      ? { pathname: manifest.defaultRoute }
      : initialLocation;
    await prepareSurfacePlan(prepared.lease, manifest, overview, resolveSurfacePlan(manifest, preparedLocation));
    generations.attachSnapshot(prepared, generationSnapshot(manifest, overview));
    generations.commit(prepared);
  } catch (cause) {
    generations.reject(prepared);
    throw new GenerationPrepareError("Unable to prepare initial generation.", { cause });
  }
  const withLease = <Value,>(load: (lease: GenerationLease<InsightRuntimeSnapshot>) => Promise<Value>) => async (): Promise<Value> => {
    const lease = generations.acquireCurrent();
    try { return await load(lease); } finally { lease.release(); }
  };
  const required = (params: Readonly<{ [key: string]: string | undefined }>, key: string): string => {
    const value = params[key];
    if (!value) throw new RouteInputError("Insight route parameter is missing.");
    return value;
  };
  const loadRoute = (parts: (params: LoaderFunctionArgs["params"]) => readonly string[]) =>
    ({ params }: LoaderFunctionArgs) => withLease(async (lease) => {
      const target = targetFromRouteParts(parts(params));
      if (target === undefined) throw new RouteInputError("Insight route parameter is malformed.");
      const generation = lease.generation.binding;
      await prepareTargetModel(lease, generation.snapshot.manifest, generation.snapshot.overview, target);
      return null;
    })();
  const currentDefaultRoute = () => generations.current?.snapshot.manifest.defaultRoute ?? manifest.defaultRoute;
  let locationEpoch = 0;
  const router = createHashRouter([{
    path: "/",
    element: <InspectionRuntimeProvider runtime={generations}>
      <InsightApp checkForUpdate={async () => {
        requireActivePage(pageLifetime.signal);
        const descriptor = await refreshGeneration();
        requireActivePage(pageLifetime.signal);
        return descriptor.generationId !== generations.current?.identity;
      }} refresh={async (acquireLock) => {
        const refreshEpoch = locationEpoch;
        const locationPath = router.state.location.pathname;
        const locationKey = router.state.location.key;
        const locationState = router.state.location.state;
        const previousIdentity = generations.current!.identity;
        const descriptor = await refreshGeneration();
        requireActivePage(pageLifetime.signal);
        if (descriptor.generationId === previousIdentity) return currentRefreshResult(generations);
        const candidate = generations.prepare(new HttpInspectionRepository(descriptor));
        let candidateOpen = true;
        let commitLock: RefreshNavigationLock | undefined;
        let lockOpen = false;
        let hostCommitted = false;
        try {
          const nextOverview = closeOverview(await candidate.lease.inspect(overviewOperation(selectedRunIds)));
          const nextManifest = viewManifest(nextOverview.catalog);
          const selection = refreshSelection(generations.current!.snapshot.overview, nextOverview, nextManifest, locationPath);
          const surfaces = resolveSurfacePlan(nextManifest, {
            pathname: selection.route,
            state: selection.fallback ? null : locationState,
          });
          await prepareSurfacePlan(candidate.lease, nextManifest, nextOverview, surfaces);
          requireActivePage(pageLifetime.signal);
          if (!refreshLocationStable(router, locationEpoch, refreshEpoch, locationPath, locationKey)) {
            generations.reject(candidate);
            candidateOpen = false;
            throw new GenerationPrepareError("View location changed while refresh was preparing.");
          }

          commitLock = await acquireLock(pageLifetime.signal);
          lockOpen = true;
          requireActivePage(pageLifetime.signal);
          if (!refreshLocationStable(router, locationEpoch, refreshEpoch, locationPath, locationKey)) {
            generations.reject(candidate);
            candidateOpen = false;
            await commitLock.release();
            lockOpen = false;
            throw new GenerationPrepareError("View location changed while refresh was preparing.");
          }

          generations.attachSnapshot(candidate, generationSnapshot(
            nextManifest,
            nextOverview,
            selection.fallback ? { originLocationKey: locationKey, plan: surfaces } : undefined,
          ));
          const resolution = await resolveHostCommit(descriptor.generationId, previousIdentity, pageLifetime.signal);
          requireActivePage(pageLifetime.signal);
          if (resolution === "rejected") {
            throw new GenerationPrepareError("View Host rejected the prepared generation.");
          }
          if (resolution === "uncertain") {
            generations.reject(candidate);
            candidateOpen = false;
            commitLock.recover();
            lockOpen = false;
            return currentRefreshResult(generations);
          }
          hostCommitted = true;

          if (selection.fallback && !commitLock.hasUserIntent()) {
            await commitLock.enqueueFallback(selection.route);
            requireActivePage(pageLifetime.signal);
          }
          const previous = generations.commit(candidate);
          candidateOpen = false;
          generations.retire(previous);
          const proceeded = await commitLock.release();
          lockOpen = false;
          const fallbackApplied = selection.fallback && proceeded !== "user";
          return Object.freeze({
            manifest: nextManifest,
            ...(fallbackApplied ? { fallbackRoute: selection.route, noticeKey: "refresh.selectionChanged" as const } : {}),
          });
        } catch (cause) {
          if (pageLifetime.signal.aborted) throw pageLifetime.signal.reason;
          if (hostCommitted && lockOpen) {
            if (candidateOpen && candidate.generation.status === "preparing") generations.reject(candidate);
            commitLock!.recover();
            return currentRefreshResult(generations);
          }
          if (candidateOpen) generations.reject(candidate);
          if (lockOpen) await commitLock!.release();
          if (cause instanceof GenerationPrepareError) throw cause;
          throw new GenerationPrepareError("Unable to prepare refreshed generation.", { cause });
        }
      }} />
    </InspectionRuntimeProvider>,
    errorElement: <RouteError />,
    children: [
      { index: true, loader: () => {
        const route = currentDefaultRoute();
        return route === "/" ? null : replace(route);
      } },
      { path: "group/:groupKind/:key", element: null, loader: loadRoute((params) => ["group", required(params, "groupKind"), required(params, "key")]) },
      { path: "experiment/:experimentId", element: null, loader: loadRoute((params) => ["experiment", required(params, "experimentId")]) },
      { path: "run/:runId", element: null, loader: loadRoute((params) => ["run", required(params, "runId")]) },
      { path: "attempt/:locator", element: null, loader: loadRoute((params) => ["attempt", required(params, "locator")]) },
      { path: "*", loader: () => replace(currentDefaultRoute()) },
    ],
  }]);
  disposeRouter = () => router.dispose();
  await waitForRouterInitialization(router);
  let observedLocation = router.state.location;
  router.subscribe((state) => {
    if (state.location !== observedLocation) {
      observedLocation = state.location;
      locationEpoch += 1;
    }
  });
  return router;
}

function waitForRouterInitialization(router: ReturnType<typeof createHashRouter>): Promise<void> {
  if (router.state.initialized) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = router.subscribe((state) => {
      if (!state.initialized) return;
      unsubscribe();
      resolve();
    });
    if (router.state.initialized) {
      unsubscribe();
      resolve();
    }
  });
}

function requireActivePage(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

function refreshLocationStable(
  router: ReturnType<typeof createHashRouter>,
  currentEpoch: number,
  refreshEpoch: number,
  locationPath: string,
  locationKey: string,
): boolean {
  return currentEpoch === refreshEpoch &&
    router.state.location.pathname === locationPath &&
    router.state.location.key === locationKey &&
    router.state.navigation.state === "idle";
}

function currentRefreshResult(runtime: ViewRuntime<InsightRuntimeSnapshot>): RefreshResult {
  return Object.freeze({ manifest: runtime.current!.snapshot.manifest });
}

async function resolveHostCommit(
  candidateIdentity: string,
  previousIdentity: string,
  signal: AbortSignal,
): Promise<"committed" | "rejected" | "uncertain"> {
  let failure: unknown;
  try {
    const committed = await commitGeneration(candidateIdentity);
    requireActivePage(signal);
    if (committed.generationId === candidateIdentity) return "committed";
    failure = new GenerationPrepareError("View Host committed an unexpected generation.");
  } catch (cause) {
    requireActivePage(signal);
    failure = cause;
  }

  let current: Awaited<ReturnType<typeof fetchCurrentGeneration>>;
  try {
    current = await fetchCurrentGeneration();
    requireActivePage(signal);
  } catch {
    requireActivePage(signal);
    return "uncertain";
  }
  if (current.generationId === candidateIdentity) return "committed";
  return failure instanceof ViewHttpError && failure.code === "view-generation-stale" && current.generationId === previousIdentity
    ? "rejected"
    : "uncertain";
}

function decodeInitialHashLocation(defaultRoute: string): BackgroundLocation & { readonly state?: unknown } {
  const hash = window.location.hash;
  const route = hash.startsWith("#/") ? hash.slice(1) : defaultRoute;
  const searchStart = route.indexOf("?");
  return {
    pathname: searchStart < 0 ? route : route.slice(0, searchStart),
    ...(searchStart < 0 ? {} : { search: route.slice(searchStart) }),
    state: initialRouteState(),
  };
}

function initialRouteState(): unknown {
  const state: unknown = window.history.state;
  return state !== null && typeof state === "object" && "usr" in state ? state.usr : undefined;
}

function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation();
  const key = error !== null && typeof error === "object" && "translationKey" in error &&
    (error.translationKey === "report.unableToLoad" || error.translationKey === "report.unableToLoadDetails")
    ? error.translationKey
    : "report.unableToLoad";
  return <main className="niceeval-view-main" role="alert">
    <h1>{t("report.unableToLoad")}</h1>
    <p>{t(key)}</p>
    <a href="#/">{t("report.backToResults")}</a>
  </main>;
}

async function prepareSurfacePlan(
  lease: GenerationLease,
  manifest: ViewManifest,
  overview: ClosedOverview,
  plan: InsightSurfacePlan,
): Promise<void> {
  await prepareTargetModel(lease, manifest, overview, plan.background.target);
  if (plan.foreground !== undefined) await prepareTargetModel(lease, manifest, overview, plan.foreground.target);
}

async function prepareTargetModel(
  lease: GenerationLease,
  manifest: ViewManifest,
  overview: ClosedOverview,
  target: InsightTarget,
): Promise<void> {
  const generation = lease.generation.binding;
  if (target.kind === "attempt") await generation.queryClient.fetchQuery(attemptQueryOptions(generation, target.locator));
  else if (target.kind === "run") await generation.queryClient.fetchQuery(runQueryOptions(generation, target.runId));
  else if (target.kind === "experiment") await generation.queryClient.fetchQuery(experimentQueryOptions(generation, overview, target.experimentId));
  else await generation.queryClient.fetchQuery(resultsQueryOptions(generation, manifest, overview, target.groupKind, target.key));
}

function refreshSelection(
  previous: ClosedOverview,
  next: ClosedOverview,
  manifest: ViewManifest,
  route: string,
): { readonly route: string; readonly fallback: boolean } {
  const target = targetForRoute(manifest, route);
  if (target === undefined) return { route: manifest.defaultRoute, fallback: true };
  if (target.kind === "attempt") {
    if (next.catalog.attemptExperiments.some((entry) => entry.locator === target.locator)) return { route, fallback: false };
    const experimentId = previous.catalog.attemptExperiments.find((entry) => entry.locator === target.locator)?.experimentId;
    if (experimentId === undefined) return { route, fallback: false };
    const run = next.catalog.runExperiments
      .filter((entry) => entry.experimentId === experimentId)
      .sort((left, right) => compareCodeUnits(left.runId, right.runId))[0];
    return run === undefined
      ? { route: manifest.defaultRoute, fallback: true }
      : { route: `/run/${encodeURIComponent(run.runId)}`, fallback: true };
  }
  if (target.kind === "run") {
    if (!previous.catalog.runExperiments.some((entry) => entry.runId === target.runId)) return { route, fallback: false };
    return next.catalog.runExperiments.some((entry) => entry.runId === target.runId)
      ? { route, fallback: false }
      : { route: manifest.defaultRoute, fallback: true };
  }
  if (target.kind === "experiment") {
    if (!previous.catalog.experiments.includes(target.experimentId)) return { route, fallback: false };
    return next.catalog.experiments.includes(target.experimentId)
      ? { route, fallback: false }
      : { route: manifest.defaultRoute, fallback: true };
  }
  return { route, fallback: false };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function generationSnapshot(
  manifest: ViewManifest,
  overview: ClosedOverview,
  presentation?: PreparedInsightPresentation,
): InsightRuntimeSnapshot {
  return Object.freeze({ manifest, overview, ...(presentation === undefined ? {} : { presentation }) });
}
