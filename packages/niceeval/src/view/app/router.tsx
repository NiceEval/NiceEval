import { Navigate, createHashRouter, useRouteError, type LoaderFunctionArgs } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GenerationController, InspectionRuntimeProvider, type GenerationLease } from "./features/insight/data/index.ts";
import { overviewOperation, RouteInputError } from "./features/insight/data/operations.ts";
import { loadAttempt } from "./features/insight/attempt/data/load.ts";
import { loadResults, loadExperiment } from "./features/insight/results/load.ts";
import { closeOverview, type ClosedOverview } from "./features/insight/results/model.ts";
import { loadRun } from "./features/insight/run/load.ts";
import { InsightApp, type InsightRuntimeSnapshot } from "./features/insight/shell/App.tsx";
import { viewManifest, type ViewManifest } from "./features/insight/shell/manifest.ts";
import { createBrowserInspectionRepository } from "./sqlite/repository.ts";

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
  const generations = new GenerationController<InsightRuntimeSnapshot>(createBrowserInspectionRepository);
  const prepared = generations.prepare();
  let manifest: ViewManifest;
  let overview: ClosedOverview;
  try {
    overview = closeOverview(await prepared.lease.inspect(overviewOperation()));
    manifest = viewManifest(overview.catalog);
    await prepareDefaultModel(prepared.lease, manifest);
    generations.attachSnapshot(prepared, generationSnapshot(prepared.generation, manifest, overview));
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
  const router = createHashRouter([{
    path: "/",
    element: <InspectionRuntimeProvider controller={generations}>
      <InsightApp controller={generations} refresh={async () => {
      const response = await fetch(new URL("record.sqlite", document.baseURI), {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "x-niceeval-view-action": "refresh" },
      });
      if (!response.ok) throw new GenerationPrepareError("View refresh was rejected.");
      const candidate = generations.prepare();
      let nextOverview: ClosedOverview;
      let nextManifest: ViewManifest;
      let selection: ReturnType<typeof refreshSelection>;
      try {
        nextOverview = closeOverview(await candidate.lease.inspect(overviewOperation()));
        nextManifest = viewManifest(nextOverview.catalog);
        selection = refreshSelection(generations.current!.snapshot.overview, nextOverview, nextManifest, window.location.hash.slice(1));
        await prepareCurrentModel(candidate.lease, nextManifest, selection.route);
        generations.attachSnapshot(candidate, generationSnapshot(candidate.generation, nextManifest, nextOverview));
      } catch (cause) {
        generations.reject(candidate);
        throw new GenerationPrepareError("Unable to prepare refreshed generation.", { cause });
      }
      const previousRoute = window.location.hash.slice(1) || generations.current!.snapshot.manifest.defaultRoute;
      const previous = generations.commit(candidate);
      try {
        if (selection.fallback) {
          await router.navigate(selection.route, { replace: true, state: null });
        } else {
          await router.revalidate();
        }
        if (router.state.errors !== null) throw new Error("Refreshed route publication failed.");
        generations.retire(previous);
        return Object.freeze({
          manifest: nextManifest,
          ...(selection.fallback ? { fallbackRoute: selection.route, noticeKey: "refresh.selectionChanged" as const } : {}),
        });
      } catch (cause) {
        generations.restore(candidate.generation, previous);
        await router.navigate(previousRoute, { replace: true, state: null });
        throw new GenerationPrepareError("Unable to publish refreshed generation.", { cause });
      }
    }} />
    </InspectionRuntimeProvider>,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to={manifest.defaultRoute} replace /> },
      { path: "group/:groupKind/:key", handle: { presentation: "page" }, loader: ({ params }: LoaderFunctionArgs) => withLease((lease) => loadResults(lease, lease.generation.snapshot.manifest, required(params, "groupKind"), required(params, "key")))(), lazy: async () => ({ Component: (await import("./features/insight/results/ResultsPage.tsx")).ResultsRoute }) },
      { path: "experiment/:experimentId", handle: { presentation: "overlay" }, loader: ({ params }: LoaderFunctionArgs) => withLease((lease) => loadExperiment(lease, required(params, "experimentId")))(), lazy: async () => ({ Component: (await import("./features/insight/results/ResultsPage.tsx")).ResultsRoute }) },
      { path: "run/:runId", handle: { presentation: "overlay" }, loader: ({ params }: LoaderFunctionArgs) => withLease((lease) => loadRun(lease, required(params, "runId")))(), lazy: async () => ({ Component: (await import("./features/insight/run/RunPage.tsx")).RunRoute }) },
      { path: "attempt/:locator", handle: { presentation: "overlay" }, loader: ({ params }: LoaderFunctionArgs) => withLease((lease) => loadAttempt(lease, `@${required(params, "locator")}`))(), lazy: async () => ({ Component: (await import("./features/insight/attempt/AttemptRoute.tsx")).AttemptRoute }) },
      { path: "*", element: <Navigate to={manifest.defaultRoute} replace /> },
    ],
  }]);
  return router;
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

async function prepareDefaultModel(lease: GenerationLease, manifest: ViewManifest): Promise<void> {
  const group = manifest.groups[0];
  await loadResults(lease, manifest, group?.identity.kind, group?.identity.kind === "named" ? group.identity.groupId : group?.identity.experimentId);
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
async function prepareCurrentModel(lease: GenerationLease, manifest: ViewManifest, route: string): Promise<void> {
  let segments: string[];
  try { segments = route.split("/").filter(Boolean).map(decodeURIComponent); }
  catch { throw new RouteInputError("Insight route is malformed."); }
  if (segments[0] === "attempt" && segments[1]) await loadAttempt(lease, `@${segments[1]}`);
  else if (segments[0] === "run" && segments[1]) await loadRun(lease, segments[1]);
  else if (segments[0] === "experiment" && segments[1]) await loadExperiment(lease, segments[1]);
  else if (segments[0] === "group") await loadResults(lease, manifest, segments[1], segments[2]);
  else await prepareDefaultModel(lease, manifest);
}

function generationSnapshot(
  generation: InsightRuntimeSnapshot["generation"],
  manifest: ViewManifest,
  overview: ClosedOverview,
): InsightRuntimeSnapshot {
  return Object.freeze({ generation, queryClient: generation.queryClient, manifest, overview });
}
