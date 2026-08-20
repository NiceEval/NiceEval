import type { ReportDefinition } from "../definition/report.ts";
import { validateParameterKey, validateReportRoute } from "../execution/paths.ts";
import type { ShowTargetRequest } from "./show-target.ts";

export interface ReportTargetRouteInvalid {
  readonly code: "report-route-invalid";
  readonly route: string;
  readonly reason: string;
  readonly available: readonly string[];
}

/**
 * Maps one public route to the one-target executor without enumerating a
 * parameterized Page.  Exact ordinary routes win; a parameterized route may
 * consume exactly one canonical key segment after its declared base path.
 */
export function showTargetRequestForRoute(
  definition: ReportDefinition,
  route: string | undefined,
): ShowTargetRequest | ReportTargetRouteInvalid {
  if (route === undefined) return Object.freeze({ kind: "default" as const });

  const routeIssue = validateReportRoute(route);
  if (routeIssue !== undefined) return invalid(definition, route, routeIssue.reason);

  const ordinary = definition.pages.find((page) => page.params === undefined && page.path === route);
  if (ordinary !== undefined) {
    return Object.freeze({ kind: "page" as const, pageId: ordinary.id });
  }

  const matches = definition.pages.flatMap((page) => {
    if (page.params === undefined) return [];
    const prefix = page.path === "/" ? "/" : `${page.path}/`;
    if (!route.startsWith(prefix)) return [];
    const key = route.slice(prefix.length);
    if (validateParameterKey(key) !== undefined) return [];
    return [{ page, key }];
  });
  if (matches.length === 1) {
    const match = matches[0]!;
    return Object.freeze({
      kind: "parameterized-page" as const,
      pageId: match.page.id,
      key: match.key,
      route,
    });
  }
  return invalid(
    definition,
    route,
    matches.length > 1
      ? "the route is ambiguous between parameterized Pages"
      : "the route is not declared by this Report",
  );
}

export function isReportTargetRouteInvalid(
  value: ShowTargetRequest | ReportTargetRouteInvalid,
): value is ReportTargetRouteInvalid {
  return "code" in value;
}

function invalid(
  definition: ReportDefinition,
  route: string,
  reason: string,
): ReportTargetRouteInvalid {
  return Object.freeze({
    code: "report-route-invalid" as const,
    route,
    reason,
    available: Object.freeze(definition.pages.map((page) =>
      page.params === undefined
        ? page.path
        : page.path === "/" ? "/:key" : `${page.path}/:key`
    )),
  });
}
