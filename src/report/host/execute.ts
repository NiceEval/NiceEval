import { Effect } from "effect";
import type * as Scope from "effect/Scope";
import type {
  AnalysisRequestError,
  SampleClosedError,
  AnalysisIssue,
  JsonValue,
  Sample,
} from "../../analysis/contracts.ts";
import {
  attemptEvidenceView,
  query,
} from "../../analysis/api.ts";
import {
  assertSampleOpen,
  captureAnalysisIssues,
  type AnalysisIssueCapture,
} from "../../sample/capability.ts";
import {
  isReportComponentInvocation,
  reportComponentDescriptor,
  type ComposeContext,
  type PageContext,
  type ResolveContext,
} from "../components.ts";
import {
  isReport,
  reportDefinition,
  type EvidenceLocator,
  type Report,
  type PageLoadContext,
} from "../definition.ts";
import {
  freezeClosedReportNode,
  validateClosedReportNode,
  type ClosedReportNode,
} from "../semantic/closed.ts";
import type { LocalizedText } from "../../shared/types.ts";
import {
  REPORT_DOWNLOAD_FILE_BYTES_MAX,
  REPORT_DOWNLOAD_FILES_MAX,
  REPORT_PAGES_MAX,
  freezeReportExecution,
  reportSampleSummary,
  reportLimit,
  type ReportDefinitionInvalid,
  type ReportExecution,
  type ReportDownloadResult,
  type ReportLimitExceeded,
  type ReportPageResult,
  type ReportPageSummary,
  type ReportRouteInvalid,
  type ReportTargetSelection,
} from "../execution/model.ts";
import {
  hostStaticPath,
  routeWithParameterKey,
  staticPathConflicts,
  staticPathForDownload,
  staticPathForRoute,
  validateDownloadPath,
  validateParameterKey,
  validateReportRoute,
  type ReportStaticPath,
} from "../execution/paths.ts";
import {
  reportProblemIdFor,
  reportProblemTable,
  type ReportExecutionProblem,
  type ReportProblem,
  type ReportProblemTable,
} from "../execution/problems.ts";

/** Expected failures that prevent forming any ReportExecution. */
export type ReportExecutionError =
  | SampleClosedError
  | AnalysisRequestError
  | ReportDefinitionInvalid
  | ReportLimitExceeded
  | ReportRouteInvalid;

type AnalysisExecutionError = SampleClosedError | AnalysisRequestError;

interface PageWork {
  readonly page: HostPage;
  readonly route?: string;
  readonly params?: JsonValue;
  readonly problems: readonly ReportExecutionProblem[];
}

interface PagePlan {
  readonly work: readonly PageWork[];
  readonly summaries: readonly ReportPageSummary[];
}

interface RenderedPage {
  readonly state: "rendered";
  readonly page: HostPage;
  readonly route: string;
  readonly node: ClosedReportNode;
  readonly downloads: readonly PageDownload[];
  readonly problems: ReportProblem[];
  conflicted: boolean;
}

interface FailedPage {
  readonly state: "failed";
  readonly page: HostPage;
  readonly route?: string;
  readonly problems: ReportProblem[];
}

type PageAttempt = RenderedPage | FailedPage;

interface PageDownload {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

interface DownloadAttempt {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly pages: RenderedPage[];
  readonly problems: ReportProblem[];
  conflicted: boolean;
}

type HostCallback = (...arguments_: unknown[]) => unknown;

interface HostReport {
  readonly title?: LocalizedText;
  readonly pages: readonly HostPage[];
}

interface HostPageBase {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly render: HostCallback;
}

interface HostPlainPage extends HostPageBase {
  readonly kind: "plain";
  readonly load?: HostCallback;
}

interface HostPageParams {
  readonly encode: HostCallback;
  readonly decode: HostCallback;
  readonly enumerate: HostCallback;
}

interface HostParameterizedPage extends HostPageBase {
  readonly kind: "parameterized";
  readonly params: HostPageParams;
  readonly load: HostCallback;
}

type HostPage = HostPlainPage | HostParameterizedPage;

type CallbackResult<Value> =
  | { readonly state: "succeeded"; readonly value: Value }
  | { readonly state: "failed" };

interface CallbackFailure {
  readonly kind: "report-callback-failure";
}

const callbackFailure: CallbackFailure = Object.freeze({ kind: "report-callback-failure" as const });

type NodeResult =
  | { readonly state: "resolved"; readonly value: unknown }
  | { readonly state: "failed"; readonly problem: ReportExecutionProblem };

type ClosedNodeResult =
  | { readonly state: "resolved"; readonly value: ClosedReportNode }
  | { readonly state: "failed"; readonly problem: ReportExecutionProblem };

interface NodeResolver {
  readonly sample: Sample;
  readonly page: PageContext;
  readonly capture: AnalysisIssueCapture;
  readonly active: Set<object>;
  readonly results: WeakMap<object, NodeResult>;
  readonly downloads: PageDownload[];
}

/**
 * Executes exactly the requested Report target while the caller-owned Sample
 * Scope is live.  It contains no runtime launch: interruption remains an
 * Effect Cause, while callback failures become isolated execution problems.
 */
export function executeReport(input: {
  readonly sample: Sample;
  readonly report: Report;
  readonly target: ReportTargetSelection;
}): Effect.Effect<ReportExecution, ReportExecutionError, Scope.Scope> {
  return Effect.gen(function* () {
    // Make the scope requirement explicit: this host is only legal while the
    // Sample capability's owning Scope remains open.
    yield* Effect.scope;
    const report = yield* readReportDefinition(input.report);
    yield* assertSampleOpen(input.sample);
    const capture = yield* captureAnalysisIssues(input.sample);
    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const plan = yield* planPages({ report, sample: input.sample, target: input.target, capture });
        const attempts = yield* executePagePlan({ sample: input.sample, work: plan.work, capture });
        const downloads = yield* collectDownloadAttempts(attempts);
        markOutputConflicts(attempts, downloads, input.target);
        const problems = allProblems(attempts, downloads, capture.issues());
        const problemTable = reportProblemTable(problems);
        const results = materializePageResults(attempts, problemTable);
        const downloadResults = materializeDownloadResults(downloads, problemTable);
        return freezeReportExecution({
          report: Object.freeze({
            id: reportExecutionId(report.pages),
            ...(report.title === undefined ? {} : { title: report.title }),
          }),
          sample: reportSampleSummary(input.sample.snapshot),
          target: input.target,
          pageSummaries: plan.summaries,
          pages: results,
          downloads: downloadResults,
          problemTable,
        });
      }),
      Effect.sync(() => capture.close()),
    );
  });
}

function readReportDefinition(
  report: Report,
): Effect.Effect<HostReport, ReportDefinitionInvalid> {
  return Effect.try({
    try: () => {
      if (!isReport(report)) throw new TypeError("Report was not created by defineReport");
      return hostReport(reportDefinition(report));
    },
    catch: (): ReportDefinitionInvalid => definitionInvalid("Report was not created by defineReport"),
  });
}

/**
 * The public definition is branded by the author module.  The Host erases its
 * generic callback inputs only after checking every field it will invoke. This
 * keeps arbitrary callback values at the execution boundary rather than
 * asserting a particular Page generic at the call site.
 */
function hostReport(value: unknown): HostReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("a Report definition must be a direct object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("a Report definition must be a direct object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") continue; // defineReport's private brand
    if (key !== "title" && key !== "pages") {
      throw new TypeError(`a Report definition has an unknown field: ${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`a Report definition has an unsafe ${key} field`);
    }
  }
  const pages = requiredDataField(value, "pages", "a Report definition");
  if (!isDataArray(pages) || pages.length === 0) {
    throw new TypeError("a Report definition needs one or more Pages");
  }
  const title = optionalDataField(value, "title");
  if (title !== undefined && !isLocalizedText(title)) {
    throw new TypeError("a Report title must be closed localized text");
  }
  const normalizedPages = Object.freeze(pages.map((page) => hostPage(page)));
  assertKnownDefinitionPaths(normalizedPages);
  return Object.freeze({
    ...(title === undefined ? {} : { title }),
    pages: normalizedPages,
  });
}

function assertKnownDefinitionPaths(pages: readonly HostPage[]): void {
  const ids = new Set<string>();
  const plainPaths: ReportStaticPath[] = [];
  for (const page of pages) {
    if (ids.has(page.id)) throw new TypeError(`a Report Page id is duplicated: ${page.id}`);
    ids.add(page.id);
    if (validateReportRoute(page.path) !== undefined) {
      throw new TypeError(`a Report Page path is invalid: ${page.path}`);
    }
    if (!isParameterizedPage(page)) plainPaths.push(staticPathForRoute(page.path));
  }
  if (staticPathConflicts(plainPaths).length > 0) {
    throw new TypeError("ordinary Report Page routes have a known static path collision");
  }
}

function hostPage(value: unknown): HostPage {
  if (!isPlainDataRecord(value)) {
    throw new TypeError("a Report Page must be a direct object");
  }
  for (const key of Object.keys(value)) {
    if (!["id", "path", "title", "navigation", "params", "load", "render"].includes(key)) {
      throw new TypeError(`a Report Page has an unknown field: ${key}`);
    }
  }
  const id = requiredString(value.id, "a Report Page id");
  const path = requiredString(value.path, "a Report Page path");
  if (!isLocalizedText(value.title)) {
    throw new TypeError("a Report Page title must be closed localized text");
  }
  const render = requiredCallback(value.render, "a Report Page render callback");
  if (!Object.hasOwn(value, "params")) {
    if (Object.hasOwn(value, "navigation") && typeof value.navigation !== "boolean") {
      throw new TypeError("a plain Report Page navigation field must be boolean");
    }
    const load = optionalCallback(value.load, "a plain Report Page load callback");
    return Object.freeze({
      kind: "plain" as const,
      id,
      path,
      title: value.title,
      ...(load === undefined ? {} : { load }),
      render,
    });
  }
  if (value.navigation !== false) {
    throw new TypeError("a parameterized Report Page must be non-navigable");
  }
  if (!isPlainDataRecord(value.params)) {
    throw new TypeError("a parameterized Report Page params field must be a direct object");
  }
  const params = value.params;
  for (const key of Object.keys(params)) {
    if (key !== "encode" && key !== "decode" && key !== "enumerate") {
      throw new TypeError(`a Page params object has an unknown field: ${key}`);
    }
  }
  return Object.freeze({
    kind: "parameterized" as const,
    id,
    path,
    title: value.title,
    params: Object.freeze({
      encode: requiredCallback(params.encode, "a Page params encode callback"),
      decode: requiredCallback(params.decode, "a Page params decode callback"),
      enumerate: requiredCallback(params.enumerate, "a Page params enumerate callback"),
    }),
    load: requiredCallback(value.load, "a parameterized Report Page load callback"),
    render,
  });
}

function requiredDataField(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(`${label} is missing a direct ${key} field`);
  }
  return descriptor.value;
}

function optionalDataField(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(`a Report definition has an unsafe ${key} field`);
  }
  return descriptor.value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !hasOnlyUnicodeScalars(value)) {
    throw new TypeError(`${label} must be a Unicode string`);
  }
  return value;
}

function isLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value === "string") return hasOnlyUnicodeScalars(value);
  if (!isPlainDataRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([locale, text]) =>
    locale.length > 0 && hasOnlyUnicodeScalars(locale) &&
    typeof text === "string" && hasOnlyUnicodeScalars(text)
  );
}

function requiredCallback(value: unknown, label: string): HostCallback {
  if (!isHostCallback(value)) throw new TypeError(`${label} must be a function`);
  return value;
}

function optionalCallback(value: unknown, label: string): HostCallback | undefined {
  if (value === undefined) return undefined;
  return requiredCallback(value, label);
}

function isHostCallback(value: unknown): value is HostCallback {
  return typeof value === "function";
}

function planPages(input: {
  readonly report: HostReport;
  readonly sample: Sample;
  readonly target: ReportTargetSelection;
  readonly capture: AnalysisIssueCapture;
}): Effect.Effect<PagePlan, ReportRouteInvalid | ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  switch (input.target.kind) {
    case "static":
      return planStaticPages(input.report.pages, input.sample, input.capture);
    case "show":
      return input.target.route === undefined
        ? Effect.succeed(planPlainPages(input.report.pages))
        : planRoutePages(input.report.pages, input.target.route, input.capture);
    case "view":
      return planRoutePages(input.report.pages, input.target.route, input.capture);
  }
}

function planPlainPages(pages: readonly HostPage[]): PagePlan {
  const work = pages
    .filter((page) => !isParameterizedPage(page))
    .map((page) => Object.freeze({ page, route: page.path, problems: Object.freeze([]) }));
  return Object.freeze({
    work: Object.freeze(work),
    summaries: pageSummaries(pages, new Map(work.map((entry) => [entry.page.id, 1]))),
  });
}

function planRoutePages(
  pages: readonly HostPage[],
  route: string,
  capture: AnalysisIssueCapture,
): Effect.Effect<PagePlan, ReportRouteInvalid | AnalysisExecutionError, Scope.Scope> {
  const invalidRoute = validateReportRoute(route);
  if (invalidRoute !== undefined) {
    return Effect.fail(Object.freeze({
      code: "report-route-invalid" as const,
      route,
      reason: invalidRoute.reason,
    }));
  }
  return Effect.gen(function* () {
    const work: PageWork[] = [];
    const counts = new Map<string, number>();
    for (const page of pages) {
      if (!isParameterizedPage(page)) {
        if (page.path === route) {
          work.push(Object.freeze({ page, route, problems: Object.freeze([]) }));
          counts.set(page.id, 1);
        }
        continue;
      }
      const key = parameterKeyForRoute(page, route);
      if (key === undefined) continue;
      const normalized = yield* normalizeParameterFromKey(page, key, capture);
      if (normalized.state === "invalid") {
        work.push(Object.freeze({
          page,
          route,
          problems: Object.freeze([pageProblem("page-params-invalid", page.id, normalized.reason)]),
        }));
      } else {
        work.push(Object.freeze({ page, route, params: normalized.params, problems: Object.freeze([]) }));
      }
      counts.set(page.id, 1);
    }
    if (work.length === 0) {
      return yield* Effect.fail(Object.freeze({
        code: "report-route-invalid" as const,
        route,
        reason: "the route does not identify a Page in this Report",
      }));
    }
    return Object.freeze({ work: Object.freeze(work), summaries: pageSummaries(pages, counts) });
  });
}

function planStaticPages(
  pages: readonly HostPage[],
  sample: Sample,
  capture: AnalysisIssueCapture,
): Effect.Effect<PagePlan, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  return Effect.gen(function* () {
    const work: PageWork[] = [];
    const counts = new Map<string, number>();
    for (const page of pages) {
      if (!isParameterizedPage(page)) {
        work.push(Object.freeze({ page, route: page.path, problems: Object.freeze([]) }));
        counts.set(page.id, 1);
        yield* assertPageLimit(work.length);
        continue;
      }
      const enumerated = yield* invokeCallback(() => page.params.enumerate(sample), capture);
      if (enumerated.state === "failed") {
        work.push(Object.freeze({
          page,
          problems: Object.freeze([pageProblem("page-params-invalid", page.id, "params.enumerate() failed")]),
        }));
        counts.set(page.id, 0);
        continue;
      }
      const values = collectIterable(enumerated.value, REPORT_PAGES_MAX - work.length);
      if (values.state === "invalid") {
        work.push(Object.freeze({
          page,
          problems: Object.freeze([pageProblem("page-params-invalid", page.id, values.reason)]),
        }));
        counts.set(page.id, 0);
        continue;
      }
      if (values.state === "limit") {
        return yield* Effect.fail(reportLimit("pages", REPORT_PAGES_MAX, REPORT_PAGES_MAX + 1));
      }
      let count = 0;
      for (const value of values.values) {
        const normalized = yield* normalizeEnumeratedParameter(page, value, capture);
        if (normalized.state === "invalid") {
          work.push(Object.freeze({
            page,
            problems: Object.freeze([pageProblem("page-params-invalid", page.id, normalized.reason)]),
          }));
        } else {
          work.push(Object.freeze({
            page,
            route: normalized.route,
            params: normalized.params,
            problems: Object.freeze([]),
          }));
          count += 1;
        }
        yield* assertPageLimit(work.length);
      }
      counts.set(page.id, count);
    }
    return Object.freeze({ work: Object.freeze(work), summaries: pageSummaries(pages, counts) });
  });
}

function executePagePlan(input: {
  readonly sample: Sample;
  readonly work: readonly PageWork[];
  readonly capture: AnalysisIssueCapture;
}): Effect.Effect<readonly PageAttempt[], ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  return Effect.gen(function* () {
    const cache = new Map<string, PageAttempt>();
    const results: PageAttempt[] = [];
    for (const work of input.work) {
      const key = `${work.page.id}\u0000${work.route ?? ""}`;
      const cached = cache.get(key);
      if (cached !== undefined) {
        results.push(cached);
        continue;
      }
      const result = yield* executePage({ sample: input.sample, work, capture: input.capture });
      cache.set(key, result);
      results.push(result);
    }
    return Object.freeze(results);
  });
}

function executePage(input: {
  readonly sample: Sample;
  readonly work: PageWork;
  readonly capture: AnalysisIssueCapture;
}): Effect.Effect<PageAttempt, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const { page, route, problems } = input.work;
  if (problems.length > 0 || route === undefined) {
    return Effect.succeed(failedPage(page, route, problems));
  }
  return Effect.gen(function* () {
    const pageContext: PageContext = Object.freeze({ id: page.id, path: route, title: page.title });
    const loaded = yield* loadPage({
      page,
      sample: input.sample,
      params: input.work.params,
      pageContext,
      capture: input.capture,
    });
    if (loaded.state === "failed") {
      return failedPage(page, route, [pageProblem("page-load-failed", page.id, "Page load() failed")]);
    }
    const rendered = yield* invokeCallback(() => page.render(loaded.value, pageContext), input.capture);
    if (rendered.state === "failed") {
      return failedPage(page, route, [pageProblem("page-render-failed", page.id, "Page render() failed")]);
    }
    const resolver: NodeResolver = {
      sample: input.sample,
      page: pageContext,
      capture: input.capture,
      active: new Set<object>(),
      results: new WeakMap<object, NodeResult>(),
      downloads: [],
    };
    const resolved = yield* resolveNode(rendered.value, resolver);
    if (resolved.state === "failed") {
      return failedPage(page, route, [resolved.problem]);
    }
    const validation = validateClosedReportNode(resolved.value);
    const limit = semanticLimit(validation.nodeCount, validation.issues);
    if (limit !== undefined) return yield* Effect.fail(limit);
    if (!validation.valid) {
      return failedPage(page, route, [pageProblem(
        "semantic-tree-invalid",
        page.id,
        validation.issues[0]?.reason ?? "the Page returned an invalid semantic tree",
      )]);
    }
    const closed = yield* closeNode(resolved.value, page.id);
    if (closed.state === "failed") return failedPage(page, route, [closed.problem]);
    return {
      state: "rendered" as const,
      page,
      route,
      node: closed.value,
      downloads: Object.freeze([...resolver.downloads]),
      problems: [],
      conflicted: false,
    };
  });
}

function loadPage(input: {
  readonly page: HostPage;
  readonly sample: Sample;
  readonly params: JsonValue | undefined;
  readonly pageContext: PageContext;
  readonly capture: AnalysisIssueCapture;
}): Effect.Effect<CallbackResult<unknown>, AnalysisExecutionError, Scope.Scope> {
  const page = input.page;
  if (isParameterizedPage(page)) {
    const params = input.params;
    if (params === undefined) return Effect.succeed(Object.freeze({ state: "failed" as const }));
    const load = page.load;
    return invokeCallback(
      () => load(input.sample, params, pageLoadContext(input.sample, input.pageContext, input.capture)),
      input.capture,
    );
  }
  const load = page.load;
  if (load === undefined) return Effect.succeed(Object.freeze({ state: "succeeded" as const, value: input.sample }));
  return invokeCallback(
    () => load(input.sample, undefined, pageLoadContext(input.sample, input.pageContext, input.capture)),
    input.capture,
  );
}

function pageLoadContext(
  sample: Sample,
  page: PageContext,
  capture: AnalysisIssueCapture,
): PageLoadContext {
  return Object.freeze({
    page,
    evidence: (locator: EvidenceLocator) => capture.run(() => query(sample, {
      kind: "domain-view",
      view: attemptEvidenceView,
      locator,
    })),
  });
}

function resolveNode(
  value: unknown,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  if (isReportComponentInvocation(value)) return resolveComponent(value, resolver);
  if (!isPlainDataRecord(value)) {
    return Effect.succeed(Object.freeze({ state: "resolved" as const, value }));
  }
  const cached = resolver.results.get(value);
  if (cached !== undefined) return Effect.succeed(cached);
  if (resolver.active.has(value)) {
    return Effect.succeed(Object.freeze({
      state: "failed" as const,
      problem: pageProblem("semantic-tree-invalid", resolver.page.id, "a Page tree cannot contain a cycle"),
    }));
  }
  resolver.active.add(value);
  return Effect.gen(function* () {
      const type = value.type;
      if (type === "download") {
        const result = yield* resolveDownloadNode(value, resolver);
        resolver.results.set(value, result);
        return result;
      }
      if (type !== "stack" && type !== "grid" && type !== "callout") {
        const result: NodeResult = Object.freeze({ state: "resolved" as const, value });
        resolver.results.set(value, result);
        return result;
      }
      const children = value.children;
      if (!isDataArray(children)) {
        const result: NodeResult = Object.freeze({ state: "resolved" as const, value });
        resolver.results.set(value, result);
        return result;
      }
      const resolvedChildren: unknown[] = [];
      for (const child of children) {
        const resolved = yield* resolveNode(child, resolver);
        if (resolved.state === "failed") return resolved;
        resolvedChildren.push(resolved.value);
      }
      const node = Object.freeze({ ...value, children: Object.freeze(resolvedChildren) });
      const result: NodeResult = Object.freeze({ state: "resolved" as const, value: node });
      resolver.results.set(value, result);
      return result;
    }).pipe(Effect.ensuring(Effect.sync(() => resolver.active.delete(value))));
}

function resolveDownloadNode(
  value: Record<string, unknown>,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const file = readDownloadFile(value.file);
  if (file === undefined || !hasExactFields(value, ["type", "file", "children"])) {
    return Effect.succeed(Object.freeze({
      state: "failed" as const,
      problem: pageProblem(
        "semantic-tree-invalid",
        resolver.page.id,
        "a Download node must contain closed file data and semantic children",
      ),
    }));
  }
  const invalidPath = validateDownloadPath(file.id);
  if (invalidPath !== undefined) {
    return Effect.succeed(Object.freeze({
      state: "failed" as const,
      problem: pageProblem("download-conflict", resolver.page.id, invalidPath.reason),
    }));
  }
  if (file.bytes.byteLength > REPORT_DOWNLOAD_FILE_BYTES_MAX) {
    return Effect.fail(reportLimit(
      "download-file-bytes",
      REPORT_DOWNLOAD_FILE_BYTES_MAX,
      file.bytes.byteLength,
    ));
  }
  const children = value.children;
  if (!isDataArray(children)) {
    return Effect.succeed(Object.freeze({
      state: "failed" as const,
      problem: pageProblem("semantic-tree-invalid", resolver.page.id, "a Download node children field must be an array"),
    }));
  }
  return Effect.gen(function* () {
    const resolvedChildren: unknown[] = [];
    for (const child of children) {
      const resolved = yield* resolveNode(child, resolver);
      if (resolved.state === "failed") return resolved;
      resolvedChildren.push(resolved.value);
    }
    resolver.downloads.push(file);
    return Object.freeze({
      state: "resolved" as const,
      value: Object.freeze({
        type: "download" as const,
        id: file.id,
        children: Object.freeze(resolvedChildren),
      }),
    });
  });
}

function readDownloadFile(value: unknown): PageDownload | undefined {
  if (!isPlainDataRecord(value) || !hasExactFields(value, ["path", "mediaType", "bytes"])) {
    return undefined;
  }
  if (typeof value.path !== "string" || typeof value.mediaType !== "string" ||
    value.mediaType.length === 0 || !hasOnlyUnicodeScalars(value.mediaType) ||
    !(value.bytes instanceof Uint8Array)) {
    return undefined;
  }
  return Object.freeze({
    id: value.path,
    mediaType: value.mediaType,
    bytes: new Uint8Array(value.bytes),
  });
}

function hasExactFields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const fields = Object.keys(value);
  return fields.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function resolveComponent(
  invocation: { readonly component: unknown; readonly props: Readonly<Record<string, unknown>> },
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const key = invocation;
  const cached = resolver.results.get(key);
  if (cached !== undefined) return Effect.succeed(cached);
  if (resolver.active.has(key)) {
    return Effect.succeed(Object.freeze({
      state: "failed" as const,
      problem: pageProblem("semantic-tree-invalid", resolver.page.id, "a component tree cannot contain a cycle"),
    }));
  }
  let descriptor: ReturnType<typeof reportComponentDescriptor>;
  try {
    descriptor = reportComponentDescriptor(invocation.component);
  } catch {
    return Effect.succeed(Object.freeze({
      state: "failed" as const,
      problem: pageProblem("component-compose-failed", resolver.page.id, "an unknown Report component was invoked"),
    }));
  }
  resolver.active.add(key);
  return Effect.gen(function* () {
      if (descriptor.kind === "compose") {
        const composed = yield* invokeCallback(() => descriptor.compose(
          invocation.props,
          composeContext(resolver),
        ), resolver.capture);
        if (composed.state === "failed") {
          return Object.freeze({
            state: "failed" as const,
            problem: pageProblem("component-compose-failed", resolver.page.id, "a component compose() callback failed"),
          });
        }
        const result = yield* resolveNode(composed.value, resolver);
        resolver.results.set(key, result);
        return result;
      }
      const data = descriptor.resolve === undefined
        ? Object.freeze({ state: "succeeded" as const, value: invocation.props })
        : yield* invokeCallback(
          () => descriptor.resolve!(invocation.props, resolveContext(resolver)),
          resolver.capture,
        );
      if (data.state === "failed" || !isClosedCallbackValue(data.value)) {
        return Object.freeze({
          state: "failed" as const,
          problem: pageProblem("component-resolve-failed", resolver.page.id, "a component resolve() callback failed or returned an unsafe value"),
        });
      }
      const primitive = yield* invokePrimitiveFaces({ descriptor, data: data.value, props: invocation.props, resolver });
      resolver.results.set(key, primitive);
      return primitive;
    }).pipe(Effect.ensuring(Effect.sync(() => resolver.active.delete(key))));
}

function invokePrimitiveFaces(input: {
  readonly descriptor: Extract<ReturnType<typeof reportComponentDescriptor>, { readonly kind: "primitive" }>;
  readonly data: unknown;
  readonly props: Readonly<Record<string, unknown>>;
  readonly resolver: NodeResolver;
}): Effect.Effect<NodeResult, AnalysisExecutionError, Scope.Scope> {
  return Effect.gen(function* () {
    const text = yield* invokeCallback(
      () => input.descriptor.text(input.data, { locale: "en", width: 80 }),
      input.resolver.capture,
    );
    const web = yield* invokeCallback(
      () => input.descriptor.web(input.data, { locale: "en" }),
      input.resolver.capture,
    );
    const dimensions = input.descriptor.dimensions === undefined
      ? Object.freeze({ state: "succeeded" as const, value: undefined })
      : yield* invokeCallback(
        () => input.descriptor.dimensions!(input.data, input.props),
        input.resolver.capture,
      );
    if (text.state === "failed" || web.state === "failed" || dimensions.state === "failed") {
      return Object.freeze({
        state: "failed" as const,
        problem: pageProblem("component-resolve-failed", input.resolver.page.id, "a primitive face or dimensions callback failed"),
      });
    }
    return Object.freeze({
      state: "resolved" as const,
      value: Object.freeze({
        type: "primitive" as const,
        text: text.value,
        web: web.value,
        ...(dimensions.value === undefined ? {} : { dimensions: dimensions.value }),
      }),
    });
  });
}

function closeNode(
  node: unknown,
  pageId: string,
): Effect.Effect<ClosedNodeResult, never> {
  return Effect.try({
    try: () => freezeClosedReportNode(node),
    catch: (): ReportExecutionProblem => pageProblem(
      "semantic-tree-invalid",
      pageId,
      "the Page returned a semantic tree that cannot be closed",
    ),
  }).pipe(Effect.match({
    onFailure: (problem): ClosedNodeResult => Object.freeze({ state: "failed" as const, problem }),
    onSuccess: (value): ClosedNodeResult => Object.freeze({ state: "resolved" as const, value }),
  }));
}

function normalizeParameterFromKey(
  page: HostParameterizedPage,
  key: string,
  capture: AnalysisIssueCapture,
): Effect.Effect<
  | { readonly state: "normalized"; readonly params: JsonValue }
  | { readonly state: "invalid"; readonly reason: string },
  AnalysisExecutionError,
  Scope.Scope
> {
  const invalidKey = validateParameterKey(key);
  if (invalidKey !== undefined) return Effect.succeed(Object.freeze({ state: "invalid" as const, reason: invalidKey.reason }));
  return Effect.gen(function* () {
    const decoded = yield* invokeCallback(() => page.params.decode(key), capture);
    if (decoded.state === "failed" || !isJsonValue(decoded.value)) {
      return Object.freeze({ state: "invalid" as const, reason: "params.decode() failed or returned a non-JSON value" });
    }
    const encoded = yield* invokeCallback(() => page.params.encode(decoded.value), capture);
    if (encoded.state === "failed" || typeof encoded.value !== "string" || encoded.value !== key) {
      return Object.freeze({ state: "invalid" as const, reason: "params encode/decode did not round-trip to the requested key" });
    }
    return Object.freeze({ state: "normalized" as const, params: decoded.value });
  });
}

function normalizeEnumeratedParameter(
  page: HostParameterizedPage,
  value: unknown,
  capture: AnalysisIssueCapture,
): Effect.Effect<
  | { readonly state: "normalized"; readonly params: JsonValue; readonly route: string }
  | { readonly state: "invalid"; readonly reason: string },
  AnalysisExecutionError,
  Scope.Scope
> {
  if (!isJsonValue(value)) {
    return Effect.succeed(Object.freeze({ state: "invalid" as const, reason: "params.enumerate() yielded a non-JSON value" }));
  }
  return Effect.gen(function* () {
    const encoded = yield* invokeCallback(() => page.params.encode(value), capture);
    if (encoded.state === "failed" || typeof encoded.value !== "string") {
      return Object.freeze({ state: "invalid" as const, reason: "params.encode() failed or returned a non-string key" });
    }
    const normalized = yield* normalizeParameterFromKey(page, encoded.value, capture);
    if (normalized.state === "invalid") return normalized;
    const route = routeWithParameterKey(page.path, encoded.value);
    const invalidRoute = validateReportRoute(route);
    if (invalidRoute !== undefined) {
      return Object.freeze({ state: "invalid" as const, reason: invalidRoute.reason });
    }
    return Object.freeze({ state: "normalized" as const, params: normalized.params, route });
  });
}

function invokeCallback<Value>(
  callback: () => Value | Promise<Value>,
  capture?: AnalysisIssueCapture,
): Effect.Effect<CallbackResult<Value>, AnalysisExecutionError> {
  return Effect.tryPromise({
    try: () => {
      const invoke = () => Promise.resolve().then(callback);
      return capture === undefined ? invoke() : capture.run(invoke);
    },
    catch: callbackError,
  }).pipe(
    Effect.map((value): CallbackResult<Value> => Object.freeze({ state: "succeeded" as const, value })),
    Effect.catchAll((error) => isAnalysisExecutionError(error)
      ? Effect.fail(error)
      : Effect.succeed<CallbackResult<Value>>(Object.freeze({ state: "failed" as const }))),
  );
}

function callbackError(error: unknown): AnalysisExecutionError | CallbackFailure {
  return isAnalysisExecutionError(error) ? error : callbackFailure;
}

function isAnalysisExecutionError(value: unknown): value is AnalysisExecutionError {
  if (!isPlainDataRecord(value)) return false;
  if (value.code === "analysis-request-invalid") {
    return hasExactFields(value, ["code", "reason"]) && typeof value.reason === "string";
  }
  if (value.code !== "analysis-sample-closed" || !hasExactFields(value, ["code", "sample"])) {
    return false;
  }
  const sample = value.sample;
  return isPlainDataRecord(sample) && hasExactFields(sample, ["kind", "id"]) &&
    sample.kind === "analysis-sample" && typeof sample.id === "string";
}

function parameterKeyForRoute(
  page: HostParameterizedPage,
  route: string,
): string | undefined {
  const prefix = page.path === "/" ? "/" : `${page.path}/`;
  if (!route.startsWith(prefix)) return undefined;
  const key = route.slice(prefix.length);
  return key.length > 0 && !key.includes("/") ? key : undefined;
}

function isParameterizedPage(
  page: HostPage,
): page is HostParameterizedPage {
  return page.kind === "parameterized";
}

function pageSummaries(
  pages: readonly HostPage[],
  counts: ReadonlyMap<string, number>,
): readonly ReportPageSummary[] {
  return Object.freeze(pages.map((page) => Object.freeze({
    pageId: page.id,
    path: page.path,
    kind: isParameterizedPage(page) ? "parameterized" as const : "plain" as const,
    instanceCount: counts.get(page.id) ?? 0,
  })).sort((left, right) => compareUtf8(left.pageId, right.pageId)));
}

function failedPage(
  page: HostPage,
  route: string | undefined,
  problems: readonly ReportExecutionProblem[],
): FailedPage {
  return Object.freeze({
    state: "failed" as const,
    page,
    ...(route === undefined ? {} : { route }),
    problems: [...problems],
  });
}

function pageProblem(
  code: ReportExecutionProblem["code"],
  pageId: string,
  summary: string,
): ReportExecutionProblem {
  return Object.freeze({ category: "execution" as const, code, pageId, summary: safeSummary(summary) });
}

function collectDownloadAttempts(
  attempts: readonly PageAttempt[],
): Effect.Effect<readonly DownloadAttempt[], ReportLimitExceeded> {
  const byId = new Map<string, DownloadAttempt>();
  let observed = 0;
  for (const page of uniquePageAttempts(attempts)) {
    if (page.state !== "rendered") continue;
    for (const download of page.downloads) {
      observed += 1;
      if (observed > REPORT_DOWNLOAD_FILES_MAX) {
        return Effect.fail(reportLimit("download-files", REPORT_DOWNLOAD_FILES_MAX, observed));
      }
      const existing = byId.get(download.id);
      if (existing === undefined) {
        byId.set(download.id, {
          id: download.id,
          mediaType: download.mediaType,
          bytes: download.bytes,
          pages: [page],
          problems: [],
          conflicted: false,
        });
        continue;
      }
      existing.pages.push(page);
      markDownloadConflict(
        existing,
        `download ${JSON.stringify(download.id)} is declared more than once (exact)`,
      );
    }
  }
  return Effect.succeed(Object.freeze([...byId.values()].sort((left, right) => compareUtf8(left.id, right.id))));
}

function markOutputConflicts(
  attempts: readonly PageAttempt[],
  downloads: readonly DownloadAttempt[],
  target: ReportTargetSelection,
): void {
  const rendered = attempts.filter((attempt): attempt is RenderedPage => attempt.state === "rendered");
  const routeOwners = new Map<string, RenderedPage[]>();
  const downloadOwners = new Map<string, DownloadAttempt>();
  const paths: ReportStaticPath[] = [];

  for (const page of rendered) {
    const owners = routeOwners.get(page.route) ?? [];
    owners.push(page);
    routeOwners.set(page.route, owners);
    paths.push(staticPathForRoute(page.route));
  }
  for (const download of downloads) {
    downloadOwners.set(download.id, download);
    paths.push(staticPathForDownload(download.id));
  }

  if (target.kind === "static") {
    if (!routeOwners.has("/")) paths.push(hostStaticPath("index.html"));
    paths.push(
      hostStaticPath("_niceeval/execution.json"),
      hostStaticPath("_niceeval/manifest.json"),
      hostStaticPath("_niceeval/problems/index.html"),
      hostStaticPath("_niceeval/runtime.js"),
      hostStaticPath("_niceeval/complete"),
    );
  }

  for (const conflict of staticPathConflicts(paths)) {
    markStaticPathOwnerConflict(conflict.left, conflict.right, routeOwners, downloadOwners);
    markStaticPathOwnerConflict(conflict.right, conflict.left, routeOwners, downloadOwners);
  }
}

function markStaticPathOwnerConflict(
  owner: { readonly owner: "route" | "download" | "host"; readonly source: string },
  other: { readonly owner: "route" | "download" | "host"; readonly source: string },
  routeOwners: ReadonlyMap<string, readonly RenderedPage[]>,
  downloadOwners: ReadonlyMap<string, DownloadAttempt>,
): void {
  const summary = `${owner.owner} ${JSON.stringify(owner.source)} conflicts with ${other.owner} ${JSON.stringify(other.source)}`;
  if (owner.owner === "route") {
    for (const page of uniquePages(routeOwners.get(owner.source) ?? [])) {
      markPageConflict(page, "route-conflict", summary);
    }
    return;
  }
  if (owner.owner === "download") {
    const download = downloadOwners.get(owner.source);
    if (download !== undefined) markDownloadConflict(download, summary);
  }
}

function markDownloadConflict(download: DownloadAttempt, summary: string): void {
  download.conflicted = true;
  download.problems.push(Object.freeze({
    category: "execution" as const,
    code: "download-conflict" as const,
    summary: safeSummary(summary),
  }));
  for (const page of uniquePages(download.pages)) {
    markPageConflict(page, "download-conflict", summary);
  }
}

function markPageConflict(
  page: RenderedPage,
  code: Extract<ReportExecutionProblem["code"], "route-conflict" | "download-conflict">,
  summary: string,
): void {
  page.conflicted = true;
  page.problems.push(pageProblem(code, page.page.id, summary));
}

function uniquePages(pages: readonly RenderedPage[]): readonly RenderedPage[] {
  return [...new Set(pages)];
}

function materializePageResults(
  attempts: readonly PageAttempt[],
  table: ReportProblemTable,
): readonly ReportPageResult[] {
  const results = uniquePageAttempts(attempts).map((attempt): ReportPageResult => {
    const problemIds = idsFor(table, attempt.problems);
    if (attempt.state === "rendered" && !attempt.conflicted) {
      return Object.freeze({
        state: "rendered" as const,
        pageId: attempt.page.id,
        route: attempt.route,
        tree: Object.freeze({
          pageId: attempt.page.id,
          route: attempt.route,
          title: attempt.page.title,
          node: attempt.node,
          problemIds,
        }),
        problemIds,
      });
    }
    return Object.freeze({
      state: "execution-failed" as const,
      pageId: attempt.page.id,
      ...(attempt.route === undefined ? {} : { route: attempt.route }),
      problemIds: requireProblemIds(problemIds),
    });
  });
  return Object.freeze(results.sort((left, right) => {
    const id = compareUtf8(left.pageId, right.pageId);
    if (id !== 0) return id;
    return compareUtf8(left.route ?? "", right.route ?? "");
  }));
}

function materializeDownloadResults(
  attempts: readonly DownloadAttempt[],
  table: ReportProblemTable,
): readonly ReportDownloadResult[] {
  const results = attempts.map((attempt): ReportDownloadResult => {
    const problemIds = idsFor(table, attempt.problems);
    if (!attempt.conflicted) {
      return Object.freeze({
        state: "built" as const,
        download: Object.freeze({
          id: attempt.id,
          mediaType: attempt.mediaType,
          bytes: new Uint8Array(attempt.bytes),
        }),
      });
    }
    return Object.freeze({
      state: "execution-failed" as const,
      downloadId: attempt.id,
      problemIds: requireProblemIds(problemIds),
    });
  });
  return Object.freeze(results.sort((left, right) => compareUtf8(
    left.state === "built" ? left.download.id : left.downloadId,
    right.state === "built" ? right.download.id : right.downloadId,
  )));
}

function idsFor(table: ReportProblemTable, problems: readonly ReportProblem[]): readonly number[] {
  return Object.freeze([...new Set(problems.flatMap((problem) => {
    const id = reportProblemIdFor(table, problem);
    return id === undefined ? [] : [id];
  }))].sort((left, right) => left - right));
}

function requireProblemIds(value: readonly number[]): readonly [number, ...number[]] {
  const first = value[0];
  if (first === undefined) {
    throw new TypeError("a failed Report Page must have a registered problem");
  }
  return Object.freeze([first, ...value.slice(1)]);
}

function allProblems(
  pages: readonly PageAttempt[],
  downloads: readonly DownloadAttempt[],
  analysisIssues: readonly AnalysisIssue[],
): readonly ReportProblem[] {
  return Object.freeze([
    ...uniquePageAttempts(pages).flatMap((attempt) => attempt.problems),
    ...downloads.flatMap((attempt) => attempt.problems),
    ...analysisIssues.map((issue) => Object.freeze({ category: "analysis-issue" as const, issue })),
  ]);
}

function uniquePageAttempts(attempts: readonly PageAttempt[]): readonly PageAttempt[] {
  return [...new Set(attempts)];
}

function semanticLimit(
  nodeCount: number,
  issues: readonly { readonly code: string; readonly reason: string }[],
): ReportLimitExceeded | undefined {
  if (!issues.some((issue) => issue.code === "limit")) return undefined;
  const depth = issues.some((issue) => issue.reason.includes("deep"));
  return depth
    ? reportLimit("document-depth", 32, 33)
    : reportLimit("document-nodes", 20_000, Math.max(20_001, nodeCount));
}

function composeContext(resolver: NodeResolver): ComposeContext {
  return Object.freeze({ sample: resolver.sample, page: resolver.page });
}

function resolveContext(resolver: NodeResolver): ResolveContext {
  return Object.freeze({ sample: resolver.sample, page: resolver.page });
}

function assertPageLimit(count: number): Effect.Effect<void, ReportLimitExceeded> {
  return count > REPORT_PAGES_MAX
    ? Effect.fail(reportLimit("pages", REPORT_PAGES_MAX, count))
    : Effect.void;
}

function collectIterable(
  value: unknown,
  maximum: number,
):
  | { readonly state: "values"; readonly values: readonly unknown[] }
  | { readonly state: "invalid"; readonly reason: string }
  | { readonly state: "limit" } {
  let iterator: Iterator<unknown>;
  try {
    iterator = iteratorFrom(value);
  } catch {
    return Object.freeze({ state: "invalid" as const, reason: "params.enumerate() must return an Iterable" });
  }
  const values: unknown[] = [];
  try {
    while (true) {
      const next = iterator.next();
      if (next.done) return Object.freeze({ state: "values" as const, values: Object.freeze(values) });
      values.push(next.value);
      if (values.length > maximum) return Object.freeze({ state: "limit" as const });
    }
  } catch {
    return Object.freeze({ state: "invalid" as const, reason: "params.enumerate() iterator failed" });
  }
}

function iteratorFrom(value: unknown): Iterator<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError("an Iterable must be an object");
  }
  const method = Reflect.get(value, Symbol.iterator);
  if (typeof method !== "function") throw new TypeError("an Iterable must expose Symbol.iterator");
  const iterator = Reflect.apply(method, value, []);
  if (!isIterator(iterator)) throw new TypeError("Symbol.iterator must return an Iterator");
  return iterator;
}

function isIterator(value: unknown): value is Iterator<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof Reflect.get(value, "next") === "function";
}

function isJsonValue(value: unknown): value is JsonValue {
  const active = new Set<object>();
  const visit = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "string") return hasOnlyUnicodeScalars(candidate);
    if (Array.isArray(candidate)) {
      if (active.has(candidate)) return false;
      active.add(candidate);
      const valid = candidate.every(visit);
      active.delete(candidate);
      return valid;
    }
    if (!isPlainDataRecord(candidate) || active.has(candidate)) return false;
    active.add(candidate);
    const valid = Object.entries(candidate).every(([key, entry]) => hasOnlyUnicodeScalars(key) && visit(entry));
    active.delete(candidate);
    return valid;
  };
  return visit(value);
}

function isClosedCallbackValue(value: unknown): boolean {
  const active = new Set<object>();
  const visit = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "string") return hasOnlyUnicodeScalars(candidate);
    if (typeof candidate === "function" || typeof candidate === "symbol" || typeof candidate === "bigint" || candidate === undefined) {
      return false;
    }
    if (Array.isArray(candidate)) {
      if (active.has(candidate)) return false;
      active.add(candidate);
      const valid = candidate.every(visit);
      active.delete(candidate);
      return valid;
    }
    if (!isPlainDataRecord(candidate) || active.has(candidate)) return false;
    active.add(candidate);
    const valid = Object.entries(candidate).every(([key, entry]) => hasOnlyUnicodeScalars(key) && visit(entry));
    active.delete(candidate);
    return valid;
  };
  return visit(value);
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
  }
  return true;
}

function isDataArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || (key !== "length" && !isArrayIndex(key))) return false;
  }
  return true;
}

function isArrayIndex(value: string): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 && index < 2 ** 32 - 1;
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code >= 0xdc00 || index + 1 >= value.length) return false;
    const next = value.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) return false;
    index += 1;
  }
  return true;
}

function definitionInvalid(reason: string): ReportDefinitionInvalid {
  return Object.freeze({
    code: "report-definition-invalid" as const,
    issues: Object.freeze([Object.freeze({ path: Object.freeze(["report"]), reason })]),
  });
}

function reportExecutionId(pages: readonly HostPage[]): string {
  const encoded = JSON.stringify(pages.map((page) => [page.id, page.path]));
  if (encoded === undefined) throw new Error("Report execution identity input must be JSON-serializable");
  return `report-v1:${encoded}`;
}

function safeSummary(value: string): string {
  const normalized = hasOnlyUnicodeScalars(value) ? value : "Report callback failed";
  return normalized.length <= 1_024 ? normalized : `${normalized.slice(0, 1_021)}...`;
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const delta = leftBytes[index]! - rightBytes[index]!;
    if (delta !== 0) return delta;
  }
  return leftBytes.length - rightBytes.length;
}
