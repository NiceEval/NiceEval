import { experimentGroupOf, type ExperimentGroupIdentityValue } from "../../../../shared/aggregate.ts";
import type { ReportManifest, ReportPageManifest } from "./types.ts";

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

export interface ViewManifest extends ReportManifest {
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

  const pages: ReportPageManifest[] = groups.map((group) => page({
    pageId: `group:${group.identity.key}`,
    route: group.route,
    title: { en: "Overview", "zh-CN": "总览" },
    navigation: false,
    presentation: "page",
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
      presentation: "overlay",
      target: { kind: "experiment", experimentId },
    }));
  }
  for (const { runId } of uniqueBy(catalog.runExperiments, ({ runId }) => runId)) {
    pages.push(page({
      pageId: `run:${runId}`,
      route: `/run/${encodeURIComponent(runId)}`,
      title: { en: "Run", "zh-CN": "运行" },
      navigation: false,
      presentation: "overlay",
      target: { kind: "run", runId },
    }));
  }
  for (const { locator } of uniqueBy(catalog.attemptExperiments, ({ locator }) => locator)) {
    pages.push(page({
      pageId: `attempt:${locator}`,
      route: `/attempt/${attemptRouteKey(locator)}`,
      title: { en: "Attempt", "zh-CN": "尝试" },
      navigation: false,
      presentation: "overlay",
      target: { kind: "attempt", locator },
    }));
  }
  pages.unshift(page({
    pageId: "overview",
    route: "/",
    title: { en: "Overview", "zh-CN": "总览" },
    navigation: true,
    presentation: "page",
    target: defaultGroup === undefined
      ? { kind: "group", groupKind: "singleton", key: "" }
      : defaultGroup.identity.kind === "named"
        ? { kind: "group", groupKind: "named", key: defaultGroup.identity.groupId }
        : { kind: "group", groupKind: "singleton", key: defaultGroup.identity.experimentId },
  }));

  return Object.freeze({
    title: { en: "NiceEval overview", "zh-CN": "NiceEval 总览" },
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

function uniqueBy<Value>(values: readonly Value[], keyOf: (value: Value) => string): readonly Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) byKey.set(keyOf(value), value);
  return [...byKey.values()];
}

function page(definition: ReportPageManifest): ReportPageManifest {
  return Object.freeze(definition);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
