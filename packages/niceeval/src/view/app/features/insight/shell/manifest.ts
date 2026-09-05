import { experimentGroupOf, type ExperimentGroupIdentityValue } from "../../../../../shared/aggregate.ts";
import type {
  BackgroundLocation,
  InsightManifest,
  InsightPage,
  InsightRouteState,
  InsightSurface,
  InsightSurfacePlan,
  InsightTarget,
} from "./types.ts";

export interface ViewCatalogSelection {
  readonly experiments: readonly string[];
  readonly runExperiments: readonly { readonly runId: string; readonly experimentId: string }[];
  readonly attemptExperiments: readonly { readonly locator: string; readonly experimentId: string }[];
}

export interface ViewExperimentGroup {
  readonly identity: ExperimentGroupIdentityValue;
  readonly members: readonly string[];
  readonly route: string;
  readonly label: string;
}

export interface ViewManifest extends InsightManifest {
  readonly groups: readonly ViewExperimentGroup[];
}

export function viewManifest(
  catalog: ViewCatalogSelection,
  initialRunIds: readonly string[] = [],
): ViewManifest {
  const byKey = new Map<string, { readonly identity: ExperimentGroupIdentityValue; readonly members: string[] }>();
  for (const experimentId of [...new Set(catalog.experiments)].sort(compareCodeUnits)) {
    const identity = experimentGroupOf(experimentId);
    const current = byKey.get(identity.key) ?? { identity, members: [] };
    current.members.push(experimentId);
    byKey.set(identity.key, current);
  }
  const groups = Object.freeze([...byKey.values()]
    .sort((left, right) => compareCodeUnits(left.identity.key, right.identity.key))
    .map(({ identity, members }) => Object.freeze({
      identity,
      members: Object.freeze(members),
      route: groupRoute(identity),
      label: identity.key,
    })));
  const initialExperimentId = initialRunIds
    .map((runId) => catalog.runExperiments.find((candidate) => candidate.runId === runId)?.experimentId)
    .find((experimentId): experimentId is string => experimentId !== undefined);
  const defaultGroup = initialExperimentId === undefined
    ? groups[0]
    : groups.find(({ members }) => members.includes(initialExperimentId)) ?? groups[0];
  const defaultRoute = defaultGroup?.route ?? "/";

  const pages: InsightPage[] = groups.map((group) => page({
    pageId: `group:${group.identity.key}`,
    route: group.route,
    title: { en: "NiceEval Insight", "zh-CN": "NiceEval Insight" },
    navigation: false,
    target: group.identity.kind === "named"
      ? { kind: "group", groupKind: "named", key: group.identity.groupId }
      : { kind: "group", groupKind: "singleton", key: group.identity.experimentId },
  }));
  for (const { experimentId } of catalog.experiments.map((experimentId) => ({ experimentId }))) {
    pages.push(page({
      pageId: `experiment:${experimentId}`,
      route: `/experiment/${encodeURIComponent(experimentId)}`,
      title: { en: "Experiment", "zh-CN": "实验" },
      navigation: false,
      target: { kind: "experiment", experimentId },
    }));
  }
  for (const { runId } of uniqueBy(catalog.runExperiments, ({ runId }) => runId)) {
    pages.push(page({
      pageId: `run:${runId}`,
      route: `/run/${encodeURIComponent(runId)}`,
      title: { en: "Run", "zh-CN": "运行" },
      navigation: false,
      target: { kind: "run", runId },
    }));
  }
  for (const { locator } of uniqueBy(catalog.attemptExperiments, ({ locator }) => locator)) {
    pages.push(page({
      pageId: `attempt:${locator}`,
      route: `/attempt/${attemptRouteKey(locator)}`,
      title: { en: "Attempt", "zh-CN": "尝试" },
      navigation: false,
      target: { kind: "attempt", locator },
    }));
  }
  pages.unshift(page({
    pageId: "overview",
    route: "/",
    title: { en: "NiceEval Insight", "zh-CN": "NiceEval Insight" },
    navigation: true,
    target: defaultGroup === undefined
      ? { kind: "group", groupKind: "singleton", key: "" }
      : defaultGroup.identity.kind === "named"
        ? { kind: "group", groupKind: "named", key: defaultGroup.identity.groupId }
        : { kind: "group", groupKind: "singleton", key: defaultGroup.identity.experimentId },
  }));

  return Object.freeze({
    title: { en: "NiceEval Insight", "zh-CN": "NiceEval Insight" },
    defaultRoute,
    experimentSelection: { options: groups.map(({ route, label }) => Object.freeze({ route, label })) },
    pages: Object.freeze(pages),
    groups,
  });
}

function groupRoute(identity: ExperimentGroupIdentityValue): string {
  return identity.kind === "named"
    ? `/group/named/${encodeURIComponent(identity.groupId)}`
    : `/group/singleton/${encodeURIComponent(identity.experimentId)}`;
}

export function attemptRouteKey(locator: string): string {
  return encodeURIComponent(locator.startsWith("@") ? locator.slice(1) : locator);
}

export function targetForRoute(manifest: ViewManifest, route: string): InsightTarget | undefined {
  if (route === "/") return manifest.pages.find((candidate) => candidate.route === route)?.target;
  if (!route.startsWith("/")) return undefined;
  const encoded = route.slice(1).replace(/\/$/u, "").split("/");
  try {
    return targetFromRouteParts(encoded.map(decodeRouterSegment));
  } catch {
    return undefined;
  }
}

function decodeRouterSegment(value: string): string {
  return decodeURIComponent(value).replace(/%2F/gu, "/");
}

export function targetFromRouteParts(parts: readonly string[]): InsightTarget | undefined {
  if (parts.length === 3 && parts[0] === "group" && (parts[1] === "named" || parts[1] === "singleton") && parts[2]) {
    return { kind: "group", groupKind: parts[1], key: parts[2] };
  }
  if (parts.length !== 2 || !parts[1]) return undefined;
  if (parts[0] === "experiment") return { kind: "experiment", experimentId: parts[1] };
  if (parts[0] === "run") return { kind: "run", runId: parts[1] };
  if (parts[0] === "attempt") return { kind: "attempt", locator: `@${parts[1]}` };
  return undefined;
}

export function resolveSurfacePlan(
  manifest: ViewManifest,
  location: BackgroundLocation & { readonly state?: unknown },
): InsightSurfacePlan {
  const route = location.pathname;
  const target = targetForRoute(manifest, route);
  if (target === undefined) throw new Error("Insight route target is malformed.");
  const current = surface(location, target, "page");
  if (target.kind === "group" || target.kind === "experiment") return { background: current };

  const routeState = insightRouteState(location.state);
  const background = routeState?.background === undefined
    ? undefined
    : pageSurfaceForRoute(manifest, routeState.background);
  if (target.kind === "run" && background === undefined) return { background: current };
  if (background !== undefined) {
    return {
      background,
      foreground: { ...surface(location, target, "dialog"), close: { kind: "history" } },
    };
  }

  const defaultLocation = Object.freeze({ pathname: manifest.defaultRoute });
  const defaultTarget = targetForRoute(manifest, defaultLocation.pathname);
  if (defaultTarget === undefined) throw new Error("Insight default route target is missing.");
  return {
    background: surface(defaultLocation, defaultTarget, "page"),
    foreground: {
      ...surface(location, target, "dialog"),
      close: { kind: "replace", route: manifest.defaultRoute },
    },
  };
}

export function surfaceKey(surface: InsightSurface): string {
  return `${surface.target.kind}:${surface.location.pathname}:${surface.location.search ?? ""}`;
}

function pageSurfaceForRoute(manifest: ViewManifest, location: BackgroundLocation): InsightSurface | undefined {
  const target = targetForRoute(manifest, location.pathname);
  if (target === undefined || target.kind === "attempt") return undefined;
  return surface(location, target, "page");
}

function surface(
  location: BackgroundLocation,
  target: InsightTarget,
  presentation: InsightSurface["presentation"],
): InsightSurface {
  return Object.freeze({
    location: Object.freeze({ pathname: location.pathname, ...(location.search === undefined ? {} : { search: location.search }) }),
    target,
    presentation,
  });
}

function insightRouteState(value: unknown): InsightRouteState | undefined {
  if (value === null || typeof value !== "object" || !("background" in value)) return undefined;
  const background = value.background;
  if (background === null || typeof background !== "object" || !("pathname" in background) || typeof background.pathname !== "string") {
    return undefined;
  }
  const search = "search" in background && typeof background.search === "string" ? background.search : undefined;
  return { background: { pathname: background.pathname, ...(search === undefined ? {} : { search }) } };
}

function uniqueBy<Value>(values: readonly Value[], keyOf: (value: Value) => string): readonly Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) byKey.set(keyOf(value), value);
  return [...byKey.values()];
}

function page(definition: InsightPage): InsightPage {
  return Object.freeze(definition);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
