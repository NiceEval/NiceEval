import { Navigate, createHashRouter, useRouteError, type LoaderFunctionArgs } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ViewRuntime, InspectionRuntimeProvider, type GenerationLease } from "./features/insight/data/index.ts";
import { overviewOperation, RouteInputError } from "./features/insight/data/operations.ts";
import { attemptQueryOptions } from "./features/insight/attempt/data/load.ts";
import { resultsQueryOptions, experimentQueryOptions } from "./features/insight/results/load.ts";
import { closeOverview, type ClosedOverview } from "./features/insight/results/model.ts";
import { runQueryOptions } from "./features/insight/run/load.ts";
import { InsightApp, type InsightRuntimeSnapshot } from "./features/insight/shell/App.tsx";
import { viewManifest, type ViewManifest } from "./features/insight/shell/manifest.ts";
import {
  commitGeneration,
  fetchCurrentGeneration,
  HttpInspectionRepository,
  refreshGeneration,
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

export async function createViewRouter() {
  const selectedRunIds = new URL(document.baseURI).searchParams.getAll("run");
  const generations = new ViewRuntime<InsightRuntimeSnapshot>();
  window.addEventListener("pagehide", () => generations.dispose(), { once: true });
  const initialDescriptor = await fetchCurrentGeneration();
  const prepared = generations.prepare(new HttpInspectionRepository(initialDescriptor));
  let manifest: ViewManifest;
  let overview: ClosedOverview;
  try {
    overview = closeOverview(await prepared.lease.inspect(overviewOperation(selectedRunIds)));
    manifest = viewManifest(overview.catalog);
    const initialRoute = decodeInitialHashRoute();
    await prepareCurrentModel(prepared.lease, manifest, overview, initialRoute ?? manifest.defaultRoute);
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
    try { return decodeURIComponent(value); } catch { throw new RouteInputError("Insight route parameter is malformed."); }
  };
  let locationEpoch = 0;
  const router = createHashRouter([{
    path: "/",
    element: <InspectionRuntimeProvider runtime={generations}>
      <InsightApp checkForUpdate={async () => (await refreshGeneration()).generationId !== generations.current?.identity} refresh={async () => {
      const refreshEpoch = locationEpoch;
      const locationPath = router.state.location.pathname;
      const backgroundPath = (router.state.location.state as { background?: Location } | null)?.background?.pathname;
      const descriptor = await refreshGeneration();
      const candidate = generations.prepare(new HttpInspectionRepository(descriptor));
      let nextOverview: ClosedOverview;
      let nextManifest: ViewManifest;
      let selection: ReturnType<typeof refreshSelection>;
      try {
        nextOverview = closeOverview(await candidate.lease.inspect(overviewOperation(selectedRunIds)));
        nextManifest = viewManifest(nextOverview.catalog);
        selection = refreshSelection(generations.current!.snapshot.overview, nextOverview, nextManifest, locationPath);
        await prepareCurrentModel(candidate.lease, nextManifest, nextOverview, selection.route);
        if (backgroundPath !== undefined) await prepareCurrentModel(candidate.lease, nextManifest, nextOverview, backgroundPath);
        if (locationEpoch !== refreshEpoch || router.state.location.pathname !== locationPath) {
          throw new GenerationPrepareError("View location changed while refresh was preparing.");
        }
        generations.attachSnapshot(candidate, generationSnapshot(nextManifest, nextOverview, selection.fallback ? selection.route : undefined));
        const committed = await commitGeneration(descriptor.generationId);
        if (committed.generationId !== descriptor.generationId) {
          throw new GenerationPrepareError("View Host committed an unexpected generation.");
        }
      } catch (cause) {
        generations.reject(candidate);
        throw new GenerationPrepareError("Unable to prepare refreshed generation.", { cause });
      }
      const previous = generations.commit(candidate);
      generations.retire(previous);
      return Object.freeze({
        manifest: nextManifest,
        ...(selection.fallback ? { fallbackRoute: selection.route, noticeKey: "refresh.selectionChanged" as const } : {}),
      });
    }} />
    </InspectionRuntimeProvider>,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to={manifest.defaultRoute} replace /> },
      { path: "group/:groupKind/:key", handle: { presentation: "page" }, loader: ({ params }: LoaderFunctionArgs) => withLease(async (lease) => { const generation = lease.generation.binding; await generation.queryClient.fetchQuery(resultsQueryOptions(generation, generation.snapshot.manifest, generation.snapshot.overview, required(params, "groupKind"), required(params, "key"))); return null; })(), lazy: async () => ({ Component: (await import("./features/insight/results/ResultsPage.tsx")).ResultsRoute }) },
      { path: "experiment/:experimentId", handle: { presentation: "overlay" }, loader: ({ params }: LoaderFunctionArgs) => withLease(async (lease) => { const generation = lease.generation.binding; await generation.queryClient.fetchQuery(experimentQueryOptions(generation, generation.snapshot.overview, required(params, "experimentId"))); return null; })(), lazy: async () => ({ Component: (await import("./features/insight/results/ResultsPage.tsx")).ResultsRoute }) },
      { path: "run/:runId", handle: { presentation: "overlay" }, loader: ({ params }: LoaderFunctionArgs) => withLease(async (lease) => { const generation = lease.generation.binding; await generation.queryClient.fetchQuery(runQueryOptions(generation, required(params, "runId"))); return null; })(), lazy: async () => ({ Component: (await import("./features/insight/run/RunPage.tsx")).RunRoute }) },
      { path: "attempt/:locator", handle: { presentation: "overlay" }, loader: ({ params }: LoaderFunctionArgs) => withLease(async (lease) => { const generation = lease.generation.binding; await generation.queryClient.fetchQuery(attemptQueryOptions(generation, `@${required(params, "locator")}`)); return null; })(), lazy: async () => ({ Component: (await import("./features/insight/attempt/AttemptRoute.tsx")).AttemptRoute }) },
      { path: "*", element: <Navigate to={manifest.defaultRoute} replace /> },
    ],
  }]);
  let observedLocation = router.state.location;
  router.subscribe((state) => {
    if (state.location !== observedLocation) {
      observedLocation = state.location;
      locationEpoch += 1;
    }
  });
  return router;
}

function decodeInitialHashRoute(): string | undefined {
  const hash = window.location.hash;
  if (!hash.startsWith("#/")) return undefined;
  return hash.slice(1);
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

async function prepareDefaultModel(lease: GenerationLease, manifest: ViewManifest, overview: ClosedOverview): Promise<void> {
  const group = manifest.groups[0];
  const generation = lease.generation.binding;
  await generation.queryClient.fetchQuery(resultsQueryOptions(generation, manifest, overview, group?.identity.kind, group?.identity.kind === "named" ? group.identity.groupId : group?.identity.experimentId));
}

function refreshSelection(
  previous: ClosedOverview,
  next: ClosedOverview,
  manifest: ViewManifest,
  route: string,
): { readonly route: string; readonly fallback: boolean } {
  let segments: string[];
  try { segments = route.split("/").filter(Boolean).map(decodeURIComponent); }
  catch { return { route: manifest.defaultRoute, fallback: true }; }
  if (segments[0] === "attempt" && segments[1]) {
    const locator = `@${segments[1]}`;
    if (next.catalog.attemptExperiments.some((entry) => entry.locator === locator)) return { route, fallback: false };
    const experimentId = previous.catalog.attemptExperiments.find((entry) => entry.locator === locator)?.experimentId;
    const run = next.catalog.runExperiments
      .filter((entry) => entry.experimentId === experimentId)
      .sort((left, right) => compareCodeUnits(left.runId, right.runId))[0];
    return run === undefined
      ? { route: manifest.defaultRoute, fallback: true }
      : { route: `/run/${encodeURIComponent(run.runId)}`, fallback: true };
  }
  if (segments[0] === "run" && segments[1]) {
    return next.catalog.runExperiments.some((entry) => entry.runId === segments[1])
      ? { route, fallback: false }
      : { route: manifest.defaultRoute, fallback: true };
  }
  if (segments[0] === "experiment" && segments[1]) {
    return next.catalog.experiments.includes(segments[1])
      ? { route, fallback: false }
      : { route: manifest.defaultRoute, fallback: true };
  }
  if (segments[0] === "group" && manifest.pages.some((page) => page.route === route)) {
    return { route, fallback: false };
  }
  return { route: manifest.defaultRoute, fallback: route !== manifest.defaultRoute };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
async function prepareCurrentModel(lease: GenerationLease, manifest: ViewManifest, overview: ClosedOverview, route: string): Promise<void> {
  let segments: string[];
  try { segments = route.split("/").filter(Boolean).map(decodeURIComponent); }
  catch { throw new RouteInputError("Insight route is malformed."); }
  const generation = lease.generation.binding;
  if (segments[0] === "attempt" && segments[1]) await generation.queryClient.fetchQuery(attemptQueryOptions(generation, `@${segments[1]}`));
  else if (segments[0] === "run" && segments[1]) await generation.queryClient.fetchQuery(runQueryOptions(generation, segments[1]));
  else if (segments[0] === "experiment" && segments[1]) await generation.queryClient.fetchQuery(experimentQueryOptions(generation, overview, segments[1]));
  else if (segments[0] === "group") await generation.queryClient.fetchQuery(resultsQueryOptions(generation, manifest, overview, segments[1], segments[2]));
  else await prepareDefaultModel(lease, manifest, overview);
}

function generationSnapshot(
  manifest: ViewManifest,
  overview: ClosedOverview,
  routeGuard?: string,
): InsightRuntimeSnapshot {
  return Object.freeze({ manifest, overview, ...(routeGuard === undefined ? {} : { routeGuard }) });
}
