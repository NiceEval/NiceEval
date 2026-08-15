import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Effect } from "effect";
import type * as Scope from "effect/Scope";
import { createElement, Fragment as ReactFragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  attemptEvidenceView,
  query,
  type AnalysisIssue,
  type AnalysisRequestError,
  type JsonValue,
  type Sample,
  type SampleClosedError,
} from "../../analysis/index.ts";
import {
  captureAnalysisIssues,
  type AnalysisIssueCapture,
} from "../../sample/capability.ts";
import {
  buildReportMeta,
  resolveReportTitle,
  type PageContext,
  type ReportDefinition,
  type ReportTarget,
} from "../definition/report.ts";
import {
  COMPONENT_RAW_CHILDREN,
  Fragment,
  collectPageDimensions,
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  withPageDimensions,
  type ReportElement,
  type ReportNode,
  type WebContext,
} from "../definition/tree.ts";
import { collectDownloads } from "../definition/primitives/downloads.ts";
import { DOWNLOAD_TARGET_PAGE } from "../definition/primitives.tsx";
import {
  REPORT_BUILD_RSS_BYTES_MAX,
  REPORT_BUILD_TIME_MS_MAX,
  REPORT_DOCUMENT_DEPTH_MAX,
  REPORT_DOCUMENT_NODES_MAX,
  REPORT_PAGES_MAX,
  reportBuildBudgetExceeded,
  type ReportBuildBudgetExceeded,
} from "../execution/model.ts";
import type { ReportProblem } from "../execution/machine.ts";
import {
  routeWithParameterKey,
  staticPathForDownload,
  staticPathForRoute,
  validateDownloadPath,
  validateParameterKey,
  validateReportRoute,
} from "../execution/paths.ts";
import {
  collectRendererAssetDeclarations,
  materializeRendererAssets,
} from "../extension/assets.ts";
import { resolveLocalizedText } from "../model/locale.ts";
import {
  type ResolvedPage,
  type ResolvedPageAssetOutput,
  type ResolvedPageClosureError,
  type ResolvedPageOutput,
} from "../runtime/resolved-page.ts";
import type { ThemeDefinition } from "../theme.ts";
import {
  executeShowTarget,
  type ShowTargetError,
  type ShowTargetRequest,
} from "./show-target.ts";
import {
  isReportTargetRouteInvalid,
  showTargetRequestForRoute,
  type ReportTargetRouteInvalid,
} from "./target-route.ts";
import {
  buildReportProjections,
  closePricingProfileJson,
  reportProjectionFailure,
  type ReportProjectionBuildFailure,
  type ReportProjectionCostInput,
  type ReportProjections,
} from "../execution/machine.ts";

const TEXT_WIDTH = 80;
const WEB_LOCALES = ["en", "zh-CN"] as const;

export interface ReportPageExecutionFailed {
  readonly code: "report-page-execution-failed";
  readonly pageId: string;
  readonly phase: "enumerate" | "params-encode" | "resolve" | "text" | "web" | "assets";
  readonly reason: string;
}

export interface ReportSiteRouteConflict {
  readonly code: "report-site-route-conflict";
  readonly route: string;
  readonly pageIds: readonly [string, string];
}

export type ReportExecutionError =
  | SampleClosedError
  | AnalysisRequestError
  | ShowTargetError
  | ResolvedPageClosureError
  | ReportTargetRouteInvalid
  | ReportPageExecutionFailed
  | ReportSiteRouteConflict
  | ReportProjectionBuildFailure
  | ReportBuildBudgetExceeded;

export interface ClosedTargetExecution {
  readonly page: ResolvedPage;
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}

export interface ClosedSitePage {
  readonly page: ResolvedPage;
  readonly navigation: boolean;
}

/** Host-private complete page closure used only while forming a revision. */
export interface ClosedReportSite {
  /** Monotonic-enough wall clock anchor for the full Sample-open + byte build budget. */
  readonly startedAtMs: number;
  /** Process RSS immediately before the Record-backed Sample is opened. */
  readonly baselineRssBytes: number;
  readonly sampleIdentity: string;
  readonly reportIdentity: string;
  readonly title: import("../model/locale.ts").LocalizedText;
  readonly theme?: ThemeDefinition;
  readonly pages: readonly ClosedSitePage[];
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}

/**
 * Executes exactly one selected route. It intentionally delegates selection to
 * show-target.ts, whose parameterized branch never calls enumerate().
 */
export function executeReportTarget(input: {
  readonly sample: Sample;
  readonly report: ReportDefinition;
  readonly route?: string;
}): Effect.Effect<ClosedTargetExecution, ReportExecutionError, Scope.Scope> {
  const request = showTargetRequestForRoute(input.report, input.route);
  if (isReportTargetRouteInvalid(request)) return Effect.fail(request);
  return Effect.gen(function* () {
    const capture = yield* captureAnalysisIssues(input.sample);
    return yield* Effect.ensuring(
      Effect.flatMap(
        // show keeps the exact author declaration and never enumerates an
        // unselected parameterized Page.
        executeTarget({
          ...input,
          pages: input.report.pages,
          request,
          capture,
        }),
        (page) => {
          const costs = capturedProjectionCosts(capture, page.target.route, page.target.pageId);
          const pricingProfile = reportPricingProfileJson(input.report);
          const failure = reportProjectionFailure({ pricingProfile, costs });
          if (failure !== undefined) return Effect.fail(failure);
          return Effect.succeed(Object.freeze({
            page,
            // Every cost entry captured during this one Page execution binds
            // to that route/page and retains Analysis's measure/row/profile.
            projections: buildReportProjections({
              pricingProfile,
              costs,
            }),
            problems: analysisProblems(capture.issues(), page.target.pageId),
          }));
        },
      ),
      Effect.sync(() => capture.close()),
    );
  });
}

/** One normalized Page declaration owned by the selected Report. */
type ReportPageDefinition = ReportDefinition["pages"][number];

/** Enumerates and closes every page instance exactly once for view/static. */
export function executeReportSite(input: {
  readonly sample: Sample;
  readonly report: ReportDefinition;
  readonly budget: ReportBuildBudgetAnchor;
}): Effect.Effect<ClosedReportSite, ReportExecutionError, Scope.Scope> {
  return Effect.gen(function* () {
    const { startedAtMs, baselineRssBytes } = input.budget;
    // The outer capture covers enumerate()/params encode phases for generic
    // Analysis issues only. Cost projections belong only to actual Page
    // executions, where the Host can bind a real route/pageId.
    const outerCapture = yield* captureAnalysisIssues(input.sample);
    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const pages: ClosedSitePage[] = [];
        const routeOwners = new Map<string, string>();
        const siteIssues: AnalysisIssue[] = [];
        const projectionCosts: ReportProjectionCostInput[] = [];
        const pricingProfile = reportPricingProfileJson(input.report);
        // The Report declaration is the only page owner. A custom Report that
        // wants official drill-down Pages composes those exported Pages
        // explicitly; the Host never merges another Report by id.
        const definitions = input.report.pages;
        const plainCount = definitions.filter((page) => page.params === undefined).length;
        if (plainCount > REPORT_PAGES_MAX) {
          return yield* Effect.fail(reportBuildBudgetExceeded("pages", REPORT_PAGES_MAX, plainCount));
        }

        for (const definition of definitions) {
          yield* checkBuildBudgets(input.budget);
          if (definition.params === undefined) {
            const { page, projectionCosts: pageCosts, issues } = yield* executePageWithCapture({
              ...input,
              pages: definitions,
              request: { kind: "page", pageId: definition.id },
              capturePage: (capture) =>
                capturedProjectionCosts(capture, definition.path, definition.id),
            });
            yield* addSitePage(pages, routeOwners, page, definition.navigation);
            yield* registerProjectionCosts(pricingProfile, projectionCosts, pageCosts);
            siteIssues.push(...issues);
            continue;
          }

          const values = yield* invokeAuthor(
            definition.id,
            "enumerate",
            outerCapture,
            () => definition.params.enumerate(input.sample),
          );
          if (values === null || values === undefined || typeof (values as Iterable<JsonValue>)[Symbol.iterator] !== "function") {
            return yield* Effect.fail(pageFailure(
              definition.id,
              "enumerate",
              "params.enumerate() must return a finite Iterable",
            ));
          }
          for (const params of values as Iterable<JsonValue>) {
            if (pages.length >= REPORT_PAGES_MAX) {
              return yield* Effect.fail(reportBuildBudgetExceeded("pages", REPORT_PAGES_MAX, pages.length + 1));
            }
            const key = yield* invokeAuthor(
              definition.id,
              "params-encode",
              outerCapture,
              () => definition.params.encode(params),
            );
            const invalidKey = typeof key === "string" ? validateParameterKey(key) : undefined;
            if (typeof key !== "string" || invalidKey !== undefined) {
              return yield* Effect.fail(pageFailure(
                definition.id,
                "params-encode",
                invalidKey?.reason ?? "params.encode() must return a canonical parameter key",
              ));
            }
            const route = routeWithParameterKey(definition.path, key);
            const routeIssue = validateReportRoute(route);
            if (routeIssue !== undefined) {
              return yield* Effect.fail(pageFailure(definition.id, "params-encode", routeIssue.reason));
            }
            // executeShowTarget supplies the required decode -> encode
            // canonical round trip, but does not enumerate this page again.
            const { page, projectionCosts: pageCosts, issues } = yield* executePageWithCapture({
              ...input,
              pages: definitions,
              request: {
                kind: "parameterized-page",
                pageId: definition.id,
                key,
                route,
              },
              capturePage: (capture) => capturedProjectionCosts(capture, route, definition.id),
            });
            yield* addSitePage(pages, routeOwners, page, false);
            yield* registerProjectionCosts(pricingProfile, projectionCosts, pageCosts);
            siteIssues.push(...issues);
            yield* checkBuildBudgets(input.budget);
          }
        }

        siteIssues.push(...outerCapture.issues());

        return Object.freeze({
          startedAtMs,
          baselineRssBytes,
          sampleIdentity: input.sample.snapshot.identity.id,
          reportIdentity: reportDefinitionIdentity(input.report),
          title: resolveReportTitle(input.report),
          ...(input.report.theme === undefined ? {} : { theme: input.report.theme }),
          pages: Object.freeze(pages),
          projections: buildReportProjections({
            pricingProfile,
            costs: projectionCosts,
          }),
          problems: analysisProblems(mergeAnalysisIssues(siteIssues)),
        });
      }),
      Effect.sync(() => outerCapture.close()),
    );
  });
}

/** One Page execution with its own capture: page, bound projection costs, and issues. */
function executePageWithCapture(input: {
  readonly sample: Sample;
  readonly report: ReportDefinition;
  readonly pages: readonly ReportPageDefinition[];
  readonly request: ShowTargetRequest;
  readonly capturePage: (capture: AnalysisIssueCapture) => ReportProjectionCostInput[];
}): Effect.Effect<
  {
    readonly page: ResolvedPage;
    readonly projectionCosts: readonly ReportProjectionCostInput[];
    readonly issues: readonly AnalysisIssue[];
  },
  ReportExecutionError,
  Scope.Scope
> {
  return Effect.gen(function* () {
    const capture = yield* captureAnalysisIssues(input.sample);
    return yield* Effect.ensuring(
      Effect.map(
        executeTarget({ ...input, capture }),
        (page) => Object.freeze({
          page,
          projectionCosts: Object.freeze(input.capturePage(capture)),
          issues: capture.issues(),
        }),
      ),
      Effect.sync(() => capture.close()),
    );
  });
}

/**
 * Validates one Page's capture before retaining it. Route ownership makes
 * capture keys page-local, so re-closing every prior Page here would only
 * repeat canonical JSON work quadratically; the final site closure performs
 * the one whole-site canonicalization.
 */
function registerProjectionCosts(
  pricingProfile: JsonValue | null,
  output: ReportProjectionCostInput[],
  costs: readonly ReportProjectionCostInput[],
): Effect.Effect<void, ReportProjectionBuildFailure> {
  const failure = reportProjectionFailure({ pricingProfile, costs });
  if (failure !== undefined) return Effect.fail(failure);
  output.push(...costs);
  return Effect.void;
}

/**
 * Reads the cost entries an Analysis execution capture recorded and binds them
 * to one Page execution.  The Host never rebuilds a projection from a
 * MetricValue.value or from the built-in show data.
 */
function capturedProjectionCosts(
  capture: AnalysisIssueCapture,
  route: string,
  pageId: string,
): ReportProjectionCostInput[] {
  return capture.costEntries().map((entry) => Object.freeze({
    page: Object.freeze({ pageId, route }),
    measureId: entry.measureId,
    row: Object.freeze({ key: entry.row.key, dimensions: entry.row.dimensions }),
    profileIdentity: entry.profileIdentity,
    projection: entry.projection,
  }));
}

/** The closed JSON form of the Report's PricingProfile, or null without one. */
function reportPricingProfileJson(report: ReportDefinition): JsonValue | null {
  return report.pricing === null ? null : closePricingProfileJson(report.pricing);
}

/** Merges per-Page issue captures into the site-wide problem table input. */
function mergeAnalysisIssues(issues: readonly AnalysisIssue[]): readonly AnalysisIssue[] {
  const unique = new Map<string, AnalysisIssue>();
  for (const issue of issues) {
    const key = `${issue.code}\u0000${issue.message}\u0000${issue.refs
      .map((ref) => ref.identity.locator).sort(compareUtf8).join("\u0001")}`;
    if (!unique.has(key)) unique.set(key, issue);
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    compareUtf8(left.code, right.code) || compareUtf8(left.message, right.message)
  ));
}

function executeTarget(input: {
  readonly sample: Sample;
  readonly report: ReportDefinition;
  /** The target-visible Page set from the selected Report declaration. */
  readonly pages: readonly ReportPageDefinition[];
  readonly request: ShowTargetRequest;
  readonly capture: AnalysisIssueCapture;
}): Effect.Effect<ResolvedPage, ReportExecutionError, Scope.Scope> {
  return executeShowTarget<ReportPageExecutionFailed, never>({
    definition: { pages: input.pages },
    sample: input.sample,
    request: input.request,
    evidence: (locator) => query(input.sample, {
      kind: "domain-view",
      view: attemptEvidenceView,
      locator,
    }),
    runAuthor: input.capture.run,
    close: (rendered, context) => closeRenderedPage({
      rendered: rendered as ReportNode,
      sample: input.sample,
      report: input.report,
      capture: input.capture,
      hrefPages: input.pages,
      page: context.page,
      route: context.target.route,
    }),
  });
}

function closeRenderedPage(input: {
  readonly rendered: ReportNode;
  readonly sample: Sample;
  readonly report: ReportDefinition;
  /** Keeps Analysis calls made while resolving component trees page-bound. */
  readonly capture: AnalysisIssueCapture;
  /** Link targets are resolved only against the selected Report declaration. */
  readonly hrefPages: readonly ReportPageDefinition[];
  readonly page: PageContext;
  readonly route: string;
}): Effect.Effect<ResolvedPageOutput, ReportPageExecutionFailed> {
  return Effect.tryPromise({
    try: () => input.capture.run(async (): Promise<ResolvedPageOutput> => {
      const resolved = await resolveReportTree(input.rendered, {
        scope: input.sample,
        page: input.page,
        report: buildReportMeta(input.report),
      });
      validateReportTree(resolved);
      assertDocumentBudget(resolved, input.page.id, input.page.path);

      const text = WEB_LOCALES.map((locale) => {
        const pageDimensions = collectPageDimensions(resolved, input.report.dimensionPins, "text");
        const context = createTextContext({
          width: TEXT_WIDTH,
          locale,
          pageDimensions,
          command: (target) => commandForTarget(input.hrefPages, target),
        });
        return Object.freeze({
          locale,
          width: TEXT_WIDTH,
          text: renderNodeToText(resolved, context),
        });
      });

      const web = WEB_LOCALES.map((locale) => {
        const pageDimensions = collectPageDimensions(resolved, input.report.dimensionPins, "web");
        const context = withPageDimensions<WebContext>({
          locale,
          href: (target) => hrefForTarget(input.hrefPages, input.route, target),
          dimension: () => {
            throw new Error("a Report web face queried an undeclared dimension");
          },
        }, pageDimensions);
        const html = runWithWebContext(Object.freeze(context), () => renderToStaticMarkup(
          createElement(ReactFragment, null, resolved as ReactNode),
        ));
        return Object.freeze({ locale, html });
      });

      const downloads = collectDownloads(resolved).map((download) => Object.freeze({
        id: download.path,
        path: download.path,
        mediaType: download.mediaType,
        bytes: download.bytes,
      }));
      const rendererAssets = await materializeRendererAssets(
        collectRendererAssetDeclarations(resolved),
        async (path) => new Uint8Array(await readFile(path)),
      );
      const assets: ResolvedPageAssetOutput[] = [
        ...rendererAssets.styles.map((asset) => Object.freeze({
          kind: "style" as const,
          path: asset.path,
          mediaType: "text/css; charset=utf-8",
          bytes: asset.content,
          sha256: asset.hash,
        })),
        ...rendererAssets.scripts.map((asset) => Object.freeze({
          kind: "script" as const,
          path: asset.path,
          mediaType: "text/javascript; charset=utf-8",
          bytes: asset.content,
          sha256: asset.hash,
        })),
      ];
      return Object.freeze({
        title: input.page.title,
        head: input.report.head as unknown as JsonValue,
        text: Object.freeze(text),
        web: Object.freeze(web),
        downloads: Object.freeze(downloads),
        assets: Object.freeze(assets),
      });
    }),
    catch: (cause): ReportPageExecutionFailed => pageFailure(
      input.page.id,
      classifyCloseFailure(cause),
      boundedReason(cause),
    ),
  });
}

function invokeAuthor<Value>(
  pageId: string,
  phase: ReportPageExecutionFailed["phase"],
  capture: AnalysisIssueCapture,
  callback: () => Value | PromiseLike<Value>,
): Effect.Effect<Value, ReportPageExecutionFailed> {
  return Effect.tryPromise({
    try: () => new Promise<Value>((resolve) => resolve(capture.run(callback))),
    catch: (cause) => pageFailure(pageId, phase, boundedReason(cause)),
  });
}

function addSitePage(
  pages: ClosedSitePage[],
  routeOwners: Map<string, string>,
  page: ResolvedPage,
  navigation: boolean,
): Effect.Effect<void, ReportSiteRouteConflict | ReportBuildBudgetExceeded> {
  const owner = routeOwners.get(page.target.route);
  if (owner !== undefined) {
    return Effect.fail(Object.freeze({
      code: "report-site-route-conflict" as const,
      route: page.target.route,
      pageIds: Object.freeze([owner, page.target.pageId]) as readonly [string, string],
    }));
  }
  if (pages.length >= REPORT_PAGES_MAX) {
    return Effect.fail(reportBuildBudgetExceeded("pages", REPORT_PAGES_MAX, pages.length + 1));
  }
  routeOwners.set(page.target.route, page.target.pageId);
  pages.push(Object.freeze({ page, navigation }));
  return Effect.void;
}

export interface ReportBuildBudgetAnchor {
  readonly startedAtMs: number;
  readonly baselineRssBytes: number;
}

/** Starts the budget before Record selection opens the fixed Sample. */
export function startReportBuildBudget(): ReportBuildBudgetAnchor {
  return Object.freeze({
    startedAtMs: Date.now(),
    baselineRssBytes: process.memoryUsage().rss,
  });
}

function checkBuildBudgets(anchor: ReportBuildBudgetAnchor): Effect.Effect<void, ReportBuildBudgetExceeded> {
  const elapsed = Date.now() - anchor.startedAtMs;
  if (elapsed > REPORT_BUILD_TIME_MS_MAX) {
    return Effect.fail(reportBuildBudgetExceeded("build-time", REPORT_BUILD_TIME_MS_MAX, elapsed));
  }
  const rssGrowth = Math.max(0, process.memoryUsage().rss - anchor.baselineRssBytes);
  if (rssGrowth > REPORT_BUILD_RSS_BYTES_MAX) {
    return Effect.fail(reportBuildBudgetExceeded("build-rss", REPORT_BUILD_RSS_BYTES_MAX, rssGrowth));
  }
  return Effect.void;
}

function assertDocumentBudget(node: ReportNode, pageId: string, route: string): void {
  const observed = countDocument(node, 0);
  if (observed.nodes > REPORT_DOCUMENT_NODES_MAX) {
    throw reportBuildBudgetExceeded(
      "document-nodes",
      REPORT_DOCUMENT_NODES_MAX,
      observed.nodes,
      { pageId, route },
    );
  }
  if (observed.depth > REPORT_DOCUMENT_DEPTH_MAX) {
    throw reportBuildBudgetExceeded(
      "document-depth",
      REPORT_DOCUMENT_DEPTH_MAX,
      observed.depth,
      { pageId, route },
    );
  }
}

function countDocument(node: ReportNode, depth: number): { readonly nodes: number; readonly depth: number } {
  if (node === null || node === undefined || typeof node === "boolean") return { nodes: 0, depth };
  if (Array.isArray(node)) {
    return node.reduce(
      (total, child) => {
        const counted = countDocument(child, depth);
        return { nodes: total.nodes + counted.nodes, depth: Math.max(total.depth, counted.depth) };
      },
      { nodes: 0, depth },
    );
  }
  if (!isElement(node)) return { nodes: 1, depth: depth + 1 };
  const currentDepth = depth + 1;
  if (node.type !== Fragment && typeof node.type === "function" &&
    (node.type as unknown as Record<symbol, unknown>)[COMPONENT_RAW_CHILDREN] === true) {
    return { nodes: 1, depth: currentDepth };
  }
  const child = countDocument(node.props.children as ReportNode, currentDepth);
  return { nodes: child.nodes + 1, depth: Math.max(currentDepth, child.depth) };
}

function isElement(value: unknown): value is ReportElement {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<ReportElement>;
  return typeof candidate.$$typeof === "symbol" &&
    (candidate.$$typeof === Symbol.for("react.element") || candidate.$$typeof === Symbol.for("react.transitional.element")) &&
    typeof candidate.props === "object" && candidate.props !== null;
}

function routeForTarget(pages: readonly ReportPageDefinition[], target: ReportTarget): string | undefined {
  const page = pages.find((candidate) => candidate.id === target.page);
  if (page === undefined) return undefined;
  if (page.params === undefined) return target.params === undefined ? page.path : undefined;
  if (target.params === undefined) return undefined;
  try {
    const key = page.params.encode(target.params);
    return validateParameterKey(key) === undefined ? routeWithParameterKey(page.path, key) : undefined;
  } catch {
    return undefined;
  }
}

function hrefForTarget(
  pages: readonly ReportPageDefinition[],
  sourceRoute: string,
  target: ReportTarget,
): string | undefined {
  const source = staticPathForRoute(sourceRoute).posix;
  if (target.page === DOWNLOAD_TARGET_PAGE) {
    const path = isJsonRecord(target.params) ? target.params.path : undefined;
    if (typeof path !== "string" || validateDownloadPath(path) !== undefined) return undefined;
    return relativeHref(source, staticPathForDownload(path).posix);
  }
  const route = routeForTarget(pages, target);
  return route === undefined ? undefined : relativeHref(source, staticPathForRoute(route).posix);
}

function isJsonRecord(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativeHref(sourceFile: string, targetFile: string): string {
  const sourceSegments = sourceFile.split("/");
  sourceSegments.pop();
  const targetSegments = targetFile.split("/");
  let common = 0;
  while (common < sourceSegments.length && common < targetSegments.length &&
    sourceSegments[common] === targetSegments[common]) common += 1;
  const relative = [
    ...sourceSegments.slice(common).map(() => ".."),
    ...targetSegments.slice(common),
  ].join("/");
  return relative || "./";
}

function commandForTarget(pages: readonly ReportPageDefinition[], target: ReportTarget): string | undefined {
  const route = routeForTarget(pages, target);
  return route === undefined ? undefined : `niceeval show --page ${shellQuote(route)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function analysisProblems(
  issues: readonly AnalysisIssue[],
  pageId?: string,
): readonly ReportProblem[] {
  return Object.freeze(issues.map((issue) => Object.freeze({
    code: `analysis-${issue.code}`,
    path: Object.freeze(pageId === undefined ? [] : ["page", pageId]),
    refs: Object.freeze(issue.refs.map((reference) => String(reference.identity.locator)).sort(compareUtf8)),
    summary: issue.message,
  })));
}

export function reportDefinitionIdentity(report: ReportDefinition): string {
  const closed = {
    title: resolveReportTitle(report),
    head: report.head,
    theme: report.theme ?? null,
    // The Analysis-computed pricing content identity joins the definition
    // identity, so a Profile change is a new Report execution.
    pricing: report.pricing === null ? null : report.pricing.contentIdentity,
    pages: report.pages.map((page) => ({
      id: page.id,
      path: page.path,
      title: page.title,
      navigation: page.navigation,
      parameterized: page.params !== undefined,
      load: page.load?.toString() ?? null,
      render: page.render.toString(),
      params: page.params === undefined
        ? null
        : {
          encode: page.params.encode.toString(),
          decode: page.params.decode.toString(),
          enumerate: page.params.enumerate.toString(),
        },
    })),
  };
  return createHash("sha256").update(canonicalJson(closed)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(Object.is(value, -0) ? 0 : value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function classifyCloseFailure(cause: unknown): ReportPageExecutionFailed["phase"] {
  const message = boundedReason(cause).toLowerCase();
  if (message.includes("asset") || message.includes("enoent")) return "assets";
  if (message.includes("text")) return "text";
  if (message.includes("web") || message.includes("react")) return "web";
  return "resolve";
}

function pageFailure(
  pageId: string,
  phase: ReportPageExecutionFailed["phase"],
  reason: string,
): ReportPageExecutionFailed {
  return Object.freeze({ code: "report-page-execution-failed" as const, pageId, phase, reason });
}

function boundedReason(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "object" && cause !== null &&
      typeof Reflect.get(cause, "code") === "string"
    ? String(Reflect.get(cause, "code"))
    : String(cause);
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 512).trim() || "Report callback failed";
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

/** Used by the site shell without re-running any author callback. */
export function closedPageTitle(page: ResolvedPage, locale: string): string {
  return resolveLocalizedText(page.title, locale);
}
