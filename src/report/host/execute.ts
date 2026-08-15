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
import { hasCompleteReportLocaleMap } from "../classic/locale.ts";
import {
  closedLinkTarget,
  freezeClosedReportNode,
  validateClosedReportNode,
  type ClosedElementTag,
  type ClosedReportHead,
  type ClosedReportHeadMetadata,
  type ClosedReportNode,
  type ClosedReportStyle,
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
import {
  builtInShowResultProducer,
  type BuiltInShowResult,
} from "../execution/results.ts";
import {
  REPORT_CLASSIC_STYLESHEET_PATH,
  REPORT_REFRESH_RUNTIME_PATH,
} from "./site-assets.ts";

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
  readonly head: ClosedReportHead;
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
  /** Fully closed before Page callbacks start; no definition object reaches renderers. */
  readonly head: ClosedReportHead;
  readonly pages: readonly HostPage[];
}

interface HostPageBase {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation: boolean;
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
  readonly head: PageHeadCollector;
}

interface PageHeadCollector {
  readonly metadata: ClosedReportHeadMetadata[];
  readonly styles: ClosedReportStyle[];
}

/**
 * React's JSX runtime is an author-time representation only.  Keeping this
 * structural (rather than importing React) permits a trusted report module to
 * use the project's JSX runtime while ensuring the runtime object never makes
 * it past this execution boundary.
 */
interface ReactElementLike {
  readonly $$typeof: symbol;
  readonly type: unknown;
  readonly props: Readonly<Record<string, unknown>>;
}

const REACT_ELEMENT_MARKERS = new Set<symbol>([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
]);
const REACT_FRAGMENT_MARKER = Symbol.for("react.fragment");
const SAFE_HEAD_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const SAFE_META_ATTRIBUTES = new Set(["content", "itemprop", "name", "property"]);
const SAFE_LINK_ATTRIBUTES = new Set(["href", "hreflang", "rel", "title", "type"]);
const SAFE_STYLE_ATTRIBUTES = new Set(["media", "type"]);
const SAFE_HEAD_LINK_RELATIONS = new Set(["alternate", "author", "canonical", "license"]);
const REACT_HOST_TAGS = new Set<string>([
  "a",
  "article",
  "aside",
  "blockquote",
  "code",
  "details",
  "div",
  "em",
  "footer",
  "header",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "small",
  "span",
  "strong",
  "summary",
  "ul",
]);

/**
 * Closes the entire Report site while the caller-owned Sample Scope is live.
 * Product targets are projection hints only: no show, view, or JSON path may
 * skip parameter enumeration or author callbacks that static export would
 * need. It contains no runtime launch: interruption remains an Effect Cause,
 * while callback failures become isolated execution problems.
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
        const plan = yield* planPages({ report, sample: input.sample, capture });
        const attempts = yield* executePagePlan({
          sample: input.sample,
          work: plan.work,
          capture,
          head: report.head,
        });
        const downloads = yield* collectDownloadAttempts(attempts);
        markOutputConflicts(attempts, downloads);
        const builtInShow = yield* closeBuiltInShowResult({
          report: input.report,
          sample: input.sample,
          capture,
        });
        const problems = allProblems(attempts, downloads, capture.issues());
        const problemTable = reportProblemTable(problems);
        const results = materializePageResults(attempts, problemTable);
        const downloadResults = materializeDownloadResults(downloads, problemTable);
        return freezeReportExecution({
          report: Object.freeze({
            id: reportExecutionId(report),
            ...(report.title === undefined ? {} : { title: report.title }),
          }),
          sample: reportSampleSummary(input.sample.snapshot),
          ...(builtInShow === undefined ? {} : { builtInShow }),
          // All observable products project this same complete closure. The
          // target only selects a product projection after closure succeeds.
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

/**
 * The Host captures a built-in's requested machine result while the same
 * Sample and issue-capture scope that built the entire site are still live.
 * No terminal renderer or CLI path can invoke this producer after closure.
 */
function closeBuiltInShowResult(input: {
  readonly report: Report;
  readonly sample: Sample;
  readonly capture: AnalysisIssueCapture;
}): Effect.Effect<BuiltInShowResult | undefined, AnalysisExecutionError> {
  const producer = builtInShowResultProducer(input.report);
  if (producer === undefined) return Effect.succeed(undefined);
  return Effect.tryPromise({
    try: () => input.capture.run(() => producer.produce(input.sample)),
    catch: closedShowResultError,
  });
}

function closedShowResultError(cause: unknown): AnalysisExecutionError {
  if (isPlainDataRecord(cause) && cause.code === "analysis-sample-closed") {
    const sample = cause.sample;
    if (isPlainDataRecord(sample) && sample.kind === "analysis-sample" && typeof sample.id === "string") {
      return Object.freeze({
        code: "analysis-sample-closed" as const,
        sample: Object.freeze({ kind: "analysis-sample" as const, id: sample.id }),
      });
    }
  }
  if (isPlainDataRecord(cause) && cause.code === "analysis-request-invalid" && typeof cause.reason === "string") {
    return Object.freeze({
      code: "analysis-request-invalid" as const,
      reason: cause.reason,
    });
  }
  return Object.freeze({
    code: "analysis-request-invalid" as const,
    reason: "the built-in Report could not close its show result",
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
    if (key !== "title" && key !== "theme" && key !== "dimensionPins" && key !== "head" && key !== "pages") {
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
  // `theme` and `dimensionPins` are validated by defineReport and remain a
  // caller-selected Host presentation concern. Reading their direct fields
  // here protects this boundary without letting either capability reach the
  // closed execution tree.
  optionalDataField(value, "theme");
  optionalDataField(value, "dimensionPins");
  const head = closeReportHead(requiredDataField(value, "head", "a Report definition"));
  const normalizedPages = Object.freeze(pages.map((page) => hostPage(page)));
  assertKnownDefinitionPaths(normalizedPages);
  return Object.freeze({
    ...(title === undefined ? {} : { title }),
    head,
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

/**
 * A missing route is an author convenience, not a renderer concern. The Host
 * assigns it before any Page callback runs. The conventional `report` Page
 * owns `/`; every other Page derives `/${id}`. Explicit routes remain exact.
 */
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
  const path = Object.hasOwn(value, "path")
    ? requiredString(value.path, "a Report Page path")
    : derivedPageRoute(id);
  if (!isLocalizedText(value.title)) {
    throw new TypeError("a Report Page title must be closed localized text");
  }
  const render = requiredCallback(value.render, "a Report Page render callback");
  if (!Object.hasOwn(value, "params")) {
    const navigation = Object.hasOwn(value, "navigation") ? value.navigation : true;
    if (typeof navigation !== "boolean") {
      throw new TypeError("a plain Report Page navigation field must be boolean");
    }
    const load = optionalCallback(value.load, "a plain Report Page load callback");
    return Object.freeze({
      kind: "plain" as const,
      id,
      path,
      title: value.title,
      navigation,
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
    navigation: false,
    params: Object.freeze({
      encode: requiredCallback(params.encode, "a Page params encode callback"),
      decode: requiredCallback(params.decode, "a Page params decode callback"),
      enumerate: requiredCallback(params.enumerate, "a Page params enumerate callback"),
    }),
    load: requiredCallback(value.load, "a parameterized Report Page load callback"),
    render,
  });
}

function derivedPageRoute(id: string): string {
  return id === "report" ? "/" : `/${id}`;
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

/**
 * Definition head declarations are valid author data, but they are not yet a
 * renderer input: CSS still needs Host scoping and every attribute needs a
 * second, capability-focused check. This closes the whole shell before a
 * Page's Sample callbacks begin.
 */
function closeReportHead(value: unknown): ClosedReportHead {
  if (!isDataArray(value)) throw new TypeError("a Report head must be a direct array");
  const collector: PageHeadCollector = { metadata: [], styles: [] };
  for (const entry of value) {
    if (!isPlainDataRecord(entry) || typeof entry.tag !== "string") {
      throw new TypeError("a Report head entry must be direct safe metadata or style data");
    }
    switch (entry.tag) {
      case "meta":
      case "link": {
        if (!hasExactFields(entry, ["tag", "attrs"])) {
          throw new TypeError("a Report metadata entry has an invalid shape");
        }
        const attrs = closeHeadAttributes(entry.attrs, entry.tag);
        if (attrs === undefined) throw new TypeError("a Report metadata entry is not safe to close");
        collector.metadata.push(Object.freeze({ tag: entry.tag, attrs }));
        break;
      }
      case "style": {
        const fields = Object.keys(entry);
        if (!Object.hasOwn(entry, "children") || typeof entry.children !== "string" ||
          fields.some((key) => key !== "tag" && key !== "attrs" && key !== "children")) {
          throw new TypeError("a Report style entry has an invalid shape");
        }
        const attrs = entry.attrs === undefined ? undefined : closeHeadAttributes(entry.attrs, "style");
        if (entry.attrs !== undefined && attrs === undefined) {
          throw new TypeError("a Report style entry has unsafe attributes");
        }
        const css = closeScopedCss(entry.children);
        if (css === undefined) {
          throw new TypeError("Report CSS must be local, author-scoped, and unable to cover Host surfaces");
        }
        collector.styles.push(Object.freeze({ ...(attrs === undefined ? {} : { attrs }), css }));
        break;
      }
      default:
        throw new TypeError("a Report head cannot contain executable or resource-loading tags");
    }
  }
  return closePageHead(collector);
}

function closeHeadAttributes(
  value: unknown,
  tag: "meta" | "link" | "style",
): Readonly<Record<string, string | true>> | undefined {
  if (!isPlainDataRecord(value)) return undefined;
  const allowed = tag === "meta" ? SAFE_META_ATTRIBUTES : tag === "link" ? SAFE_LINK_ATTRIBUTES : SAFE_STYLE_ATTRIBUTES;
  const attrs: Record<string, string | true> = Object.create(null) as Record<string, string | true>;
  for (const [name, attribute] of Object.entries(value)) {
    if (!SAFE_HEAD_ATTRIBUTE_NAME.test(name) || name.toLowerCase().startsWith("on") || !allowed.has(name) ||
      (attribute !== true && (typeof attribute !== "string" || !hasOnlyUnicodeScalars(attribute)))) {
      return undefined;
    }
    attrs[name] = attribute;
  }
  if (tag === "link") {
    if (typeof attrs.rel !== "string" || !SAFE_HEAD_LINK_RELATIONS.has(attrs.rel.toLowerCase()) ||
      typeof attrs.href !== "string" || !isLocalHeadReference(attrs.href)) {
      return undefined;
    }
  }
  if (tag === "style" && attrs.type !== undefined && attrs.type !== "text/css") return undefined;
  return Object.freeze(attrs);
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
  ) && hasCompleteReportLocaleMap(value);
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
  readonly capture: AnalysisIssueCapture;
}): Effect.Effect<PagePlan, ReportRouteInvalid | ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  return planStaticPages(input.report.pages, input.sample, input.capture);
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
      const routes = new Set<string>();
      for (const value of values.values) {
        const normalized = yield* normalizeEnumeratedParameter(page, value, capture);
        if (normalized.state === "invalid") {
          work.push(Object.freeze({
            page,
            problems: Object.freeze([pageProblem("page-params-invalid", page.id, normalized.reason)]),
          }));
        } else if (routes.has(normalized.route)) {
          // Keep the collision as a distinct failed work item rather than
          // allowing executePagePlan's instance cache to conceal it.
          work.push(Object.freeze({
            page,
            problems: Object.freeze([pageProblem(
              "page-params-invalid",
              page.id,
              `params.enumerate() produced duplicate route ${JSON.stringify(normalized.route)}`,
            )]),
          }));
        } else {
          routes.add(normalized.route);
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
  readonly head: ClosedReportHead;
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
      const result = yield* executePage({
        sample: input.sample,
        work,
        capture: input.capture,
        head: input.head,
      });
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
  readonly head: ClosedReportHead;
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
      head: mutablePageHead(input.head),
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
      head: closePageHead(resolver.head),
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
  // JSX children can be an array, Fragment result, scalar, or empty. Normalize
  // every author-time form here so none of those values reach validation or a
  // renderer as a React/runtime object.
  if (Array.isArray(value)) return resolveReactChildren(value, resolver);
  if (value === null || value === undefined || typeof value === "boolean") return Effect.succeed(emptyClosedStack());
  if (typeof value === "string") {
    return Effect.succeed(Object.freeze({
      state: "resolved" as const,
      value: Object.freeze({ type: "text" as const, value }),
    }));
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? Effect.succeed(Object.freeze({
        state: "resolved" as const,
        value: Object.freeze({ type: "text" as const, value: String(value) }),
      }))
      : Effect.succeed(reactNodeFailure(resolver, "numeric author output must be finite"));
  }
  if (isReactElement(value)) return resolveReactElement(value, resolver);
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
      if (type === "head") {
        const result = yield* resolveHeadNode(value, resolver);
        resolver.results.set(value, result);
        return result;
      }
      if (type === "style") {
        const result = resolveStyleNode(value, resolver);
        resolver.results.set(value, result);
        return result;
      }
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

/**
 * Executes JSX function components while the Sample Scope is still live and
 * lowers every supported intrinsic/Fragment into ordinary semantic children.
 * React elements, function components, and props are intentionally discarded
 * before `freezeClosedReportNode()` runs.
 */
function resolveReactElement(
  element: ReactElementLike,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const key = element as unknown as object;
  const cached = resolver.results.get(key);
  if (cached !== undefined) return Effect.succeed(cached);
  if (resolver.active.has(key)) {
    return Effect.succeed(Object.freeze({
      state: "failed" as const,
      problem: pageProblem("semantic-tree-invalid", resolver.page.id, "a React element tree cannot contain a cycle"),
    }));
  }
  resolver.active.add(key);
  return Effect.gen(function* () {
    let result: NodeResult;
    if (element.type === REACT_FRAGMENT_MARKER) {
      result = yield* resolveReactChildren(element.props.children, resolver);
    } else if (typeof element.type === "function") {
      if (isReactClassComponent(element.type)) {
        result = reactNodeFailure(resolver, "React class components are not a Report closure boundary");
      } else {
        const rendered = yield* invokeCallback(
          () => (element.type as (props: Readonly<Record<string, unknown>>) => unknown)(element.props),
          resolver.capture,
        );
        result = rendered.state === "failed"
          ? reactNodeFailure(resolver, "a React function component failed")
          : yield* resolveNode(rendered.value, resolver);
      }
    } else if (typeof element.type === "string") {
      result = yield* resolveReactHostElement(element, resolver);
    } else {
      result = reactNodeFailure(resolver, "an unsupported React element type was returned");
    }
    resolver.results.set(key, result);
    return result;
  }).pipe(Effect.ensuring(Effect.sync(() => resolver.active.delete(key))));
}

function resolveReactHostElement(
  element: ReactElementLike,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const type = element.type;
  if (type === "head") return collectReactHead(element.props.children, resolver);
  if (type === "style") return collectReactStyle(element.props, resolver);
  if (typeof type !== "string" || !REACT_HOST_TAGS.has(type)) {
    return Effect.succeed(reactNodeFailure(resolver, `unsupported React host element: ${String(type)}`));
  }
  let href: string | undefined;
  let classes: readonly string[] | undefined;
  for (const [key, value] of Object.entries(element.props)) {
    if (key === "children") continue;
    if (key === "className" && typeof value === "string") {
      const closed = closeClassNames(value);
      if (closed === undefined) {
        return Effect.succeed(reactNodeFailure(resolver, `unsafe React ${type} className`));
      }
      classes = closed;
      continue;
    }
    if (type === "a" && key === "href" && typeof value === "string" && closedLinkTarget(value) !== undefined) {
      href = value;
      continue;
    }
    return Effect.succeed(reactNodeFailure(resolver, `unsupported React ${type} prop: ${key}`));
  }
  if (type === "a" && href === undefined) {
    return Effect.succeed(reactNodeFailure(resolver, "a React link needs a local route, fragment, or explicit HTTPS URL"));
  }
  return Effect.map(resolveReactChildren(element.props.children, resolver), (children): NodeResult => {
    if (children.state === "failed") return children;
    const nodes = childNodes(children.value);
    if (nodes === undefined) return reactNodeFailure(resolver, "React children did not close to semantic nodes");
    return Object.freeze({
      state: "resolved" as const,
      value: type === "a"
        ? Object.freeze({ type: "link" as const, href: href!, children: nodes })
        : Object.freeze({
          type: "element" as const,
          tag: type as ClosedElementTag,
          ...(classes === undefined ? {} : { classes }),
          children: nodes,
        }),
    });
  });
}

function resolveReactChildren(
  value: unknown,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const children = flattenReactChildren(value);
  if (children === undefined) {
    return Effect.succeed(reactNodeFailure(resolver, "React children must be semantic nodes or scalar text"));
  }
  return Effect.gen(function* () {
    const resolved: unknown[] = [];
    for (const child of children) {
      if (child === null || child === undefined || typeof child === "boolean") continue;
      if (typeof child === "string" || typeof child === "number") {
        if (typeof child === "number" && !Number.isFinite(child)) {
          return reactNodeFailure(resolver, "React text children must be finite");
        }
        resolved.push(Object.freeze({ type: "text" as const, value: String(child) }));
        continue;
      }
      const next = yield* resolveNode(child, resolver);
      if (next.state === "failed") return next;
      resolved.push(next.value);
    }
    return Object.freeze({
      state: "resolved" as const,
      value: Object.freeze({ type: "stack" as const, children: Object.freeze(resolved) }),
    });
  });
}

function flattenReactChildren(value: unknown): readonly unknown[] | undefined {
  const result: unknown[] = [];
  const visit = (child: unknown): boolean => {
    if (Array.isArray(child)) return child.every(visit);
    result.push(child);
    return true;
  };
  return visit(value) ? Object.freeze(result) : undefined;
}

function reactNodeFailure(resolver: NodeResolver, summary: string): NodeResult {
  return Object.freeze({
    state: "failed" as const,
    problem: pageProblem("component-compose-failed", resolver.page.id, summary),
  });
}

function isReactElement(value: unknown): value is ReactElementLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  // React 19 development elements intentionally carry hidden debug fields.
  // Do not demand a plain object (that would reject jsx=react-jsx); instead
  // read only the three direct data fields we consume and never invoke a
  // getter or retain the element after closure.
  const marker = directDataField(value, "$$typeof");
  const type = directDataField(value, "type");
  const props = directDataField(value, "props");
  return typeof marker === "symbol" && REACT_ELEMENT_MARKERS.has(marker) &&
    (typeof type === "string" || typeof type === "function" || typeof type === "symbol") &&
    isDirectAuthorProps(props);
}

function directDataField(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function isDirectAuthorProps(value: unknown): value is Readonly<Record<string, unknown>> {
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

function isReactClassComponent(value: Function): boolean {
  const prototype = (value as { readonly prototype?: unknown }).prototype;
  return typeof prototype === "object" && prototype !== null &&
    "isReactComponent" in prototype;
}

/** React <head> is execution-only metadata, never a renderer subtree. */
function collectReactHead(
  value: unknown,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const children = flattenReactChildren(value);
  if (children === undefined) return Effect.succeed(reactNodeFailure(resolver, "React head children are invalid"));
  return Effect.gen(function* () {
    for (const child of children) {
      const collected = yield* collectReactHeadChild(child, resolver);
      if (collected.state === "failed") return collected;
    }
    return emptyClosedStack();
  });
}

function collectReactHeadChild(
  value: unknown,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  if (value === null || value === undefined || typeof value === "boolean") return Effect.succeed(emptyClosedStack());
  if (Array.isArray(value)) return collectReactHead(value, resolver);
  if (!isReactElement(value)) {
    return Effect.succeed(reactNodeFailure(resolver, "Report head accepts only meta, style, Fragment, or function components"));
  }
  if (value.type === REACT_FRAGMENT_MARKER || value.type === "head") {
    return collectReactHead(value.props.children, resolver);
  }
  if (value.type === "meta" || value.type === "link") {
    return Effect.succeed(collectReactHeadMetadata(value.type, value.props, resolver));
  }
  if (value.type === "style") return collectReactStyle(value.props, resolver);
  if (typeof value.type === "function" && !isReactClassComponent(value.type)) {
    return Effect.flatMap(
      invokeCallback(() => (value.type as (props: Readonly<Record<string, unknown>>) => unknown)(value.props), resolver.capture),
      (result) => result.state === "failed"
        ? Effect.succeed(reactNodeFailure(resolver, "a React head function component failed"))
        : collectReactHeadChild(result.value, resolver),
    );
  }
  return Effect.succeed(reactNodeFailure(resolver, "Report head contains an unsupported React element"));
}

function collectReactHeadMetadata(
  tag: "meta" | "link",
  props: Readonly<Record<string, unknown>>,
  resolver: NodeResolver,
): NodeResult {
  if (Object.hasOwn(props, "children")) {
    return reactNodeFailure(resolver, "a Report head metadata element cannot contain children");
  }
  const attrs = closeHeadAttributes(props, tag);
  if (attrs === undefined) return reactNodeFailure(resolver, "a Report head metadata element is not safe to close");
  resolver.head.metadata.push(Object.freeze({ tag, attrs }));
  return emptyClosedStack();
}

function collectReactStyle(
  props: Readonly<Record<string, unknown>>,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, never> {
  const keys = Object.keys(props);
  if (keys.some((key) => key !== "children" && key !== "asset" && key !== "media" && key !== "type")) {
    return Effect.succeed(reactNodeFailure(resolver, "a Report style can only contain CSS text or a closed local asset"));
  }
  const attrsSource: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (Object.hasOwn(props, "media")) attrsSource.media = props.media;
  if (Object.hasOwn(props, "type")) attrsSource.type = props.type;
  const attrs = Object.keys(attrsSource).length === 0 ? undefined : closeHeadAttributes(attrsSource, "style");
  if (attrs === undefined && Object.keys(attrsSource).length > 0) {
    return Effect.succeed(reactNodeFailure(resolver, "a Report style has unsafe attributes"));
  }
  const source = Object.hasOwn(props, "asset") ? cssFromAsset(props.asset) : cssFromChildren(props.children);
  const css = source === undefined ? undefined : closeScopedCss(source);
  if (css === undefined) {
    return Effect.succeed(reactNodeFailure(resolver, "Report CSS must be local, scoped, and free of host-covering rules"));
  }
  resolver.head.styles.push(Object.freeze({ ...(attrs === undefined ? {} : { attrs }), css }));
  return Effect.succeed(emptyClosedStack());
}

/** Supports an author-side data node while future DSL work lands independently. */
function resolveHeadNode(
  value: Record<string, unknown>,
  resolver: NodeResolver,
): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
  const metadataEntries = value.metadata;
  const styleEntries = value.styles;
  if (!hasExactFields(value, ["type", "metadata", "styles"]) || !Array.isArray(metadataEntries) || !Array.isArray(styleEntries)) {
    return Effect.succeed(reactNodeFailure(resolver, "a Report head node must contain metadata and styles arrays"));
  }
  return Effect.gen(function* () {
    for (const metadata of metadataEntries) {
      if (!isPlainDataRecord(metadata) || (metadata.tag !== "meta" && metadata.tag !== "link") ||
        !isPlainDataRecord(metadata.attrs) || !hasExactFields(metadata, ["tag", "attrs"])) {
        return reactNodeFailure(resolver, "a Report head metadata entry is invalid");
      }
      const collected = collectReactHeadMetadata(metadata.tag, metadata.attrs, resolver);
      if (collected.state === "failed") return collected;
    }
    for (const style of styleEntries) {
      const collected = resolveStyleNode(style, resolver);
      if (collected.state === "failed") return collected;
    }
    return emptyClosedStack();
  });
}

function resolveStyleNode(value: unknown, resolver: NodeResolver): NodeResult {
  if (!isPlainDataRecord(value) || typeof value.css !== "string" || !Object.hasOwn(value, "type") ||
    Object.keys(value).some((key) => key !== "type" && key !== "attrs" && key !== "css")) {
    return reactNodeFailure(resolver, "a Report style node must contain CSS text");
  }
  const attrs = value.attrs === undefined ? undefined : closeHeadAttributes(value.attrs, "style");
  if (value.attrs !== undefined && attrs === undefined) {
    return reactNodeFailure(resolver, "a Report style node has unsafe attributes");
  }
  const css = closeScopedCss(value.css);
  if (css === undefined) return reactNodeFailure(resolver, "Report CSS must be local, scoped, and free of host-covering rules");
  resolver.head.styles.push(Object.freeze({ ...(attrs === undefined ? {} : { attrs }), css }));
  return emptyClosedStack();
}

function emptyClosedStack(): NodeResult {
  return Object.freeze({
    state: "resolved" as const,
    value: Object.freeze({ type: "stack" as const, children: Object.freeze([]) }),
  });
}

function childNodes(value: unknown): readonly ClosedReportNode[] | undefined {
  if (!isPlainDataRecord(value) || value.type !== "stack" || !Array.isArray(value.children)) return undefined;
  return value.children as readonly ClosedReportNode[];
}

function closeClassNames(value: string): readonly string[] | undefined {
  if (!hasOnlyUnicodeScalars(value)) return undefined;
  const classes = value.split(/\s+/u).filter(Boolean);
  if (classes.length === 0 || classes.length > 32 || classes.some((entry) =>
    !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(entry) || entry.startsWith("niceeval-report")
  )) return undefined;
  return Object.freeze(classes);
}

function isLocalHeadReference(value: string): boolean {
  return value.length > 0 && hasOnlyUnicodeScalars(value) && !value.startsWith("//") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function cssFromChildren(value: unknown): string | undefined {
  const values = flattenReactChildren(value);
  if (values === undefined || values.some((entry) => typeof entry !== "string")) return undefined;
  return values.join("");
}

function cssFromAsset(value: unknown): string | undefined {
  if (value instanceof Uint8Array) return decodeCssBytes(value);
  if (!isPlainDataRecord(value) || !hasExactFields(value, ["bytes"]) || !(value.bytes instanceof Uint8Array)) return undefined;
  return decodeCssBytes(value.bytes);
}

function decodeCssBytes(value: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return undefined;
  }
}

/**
 * This is intentionally a tiny CSS grammar. Every accepted selector is
 * prefixed by the host and declarations cannot position or hide a host-owned
 * problem surface, import a network resource, or smuggle executable syntax.
 */
function closeScopedCss(value: string): string | undefined {
  if (!hasOnlyUnicodeScalars(value) || value.length === 0 || value.length > 65_536 ||
    /[@\\<>]|url\s*\(|expression\s*\(|!important|\b(?:position|z-index|inset|top|right|bottom|left|transform|filter|animation|transition|pointer-events|content)\s*:/i.test(value)) {
    return undefined;
  }
  const rules: string[] = [];
  for (const raw of value.split("}")) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split("{");
    if (parts.length !== 2) return undefined;
    const [selectorRaw, declarationsRaw] = parts;
    const selector = selectorRaw!.trim();
    const declarations = declarationsRaw!.trim();
    if (selector.length === 0 || declarations.length === 0 ||
      !/^[A-Za-z0-9._#\-\s,\[\]="']+$/.test(selector) ||
      !/^[A-Za-z0-9#(),.%\-\s/:]+$/.test(declarations)) {
      return undefined;
    }
    const selectors = selector.split(",").map((entry) => entry.trim());
    if (selectors.some((entry) => entry.length === 0 || entry.startsWith(".") === false && entry.startsWith("#") === false && /^[A-Za-z]/.test(entry) === false)) {
      return undefined;
    }
    rules.push(`${selectors.map((entry) => `.niceeval-report__author ${entry}`).join(",")}{${declarations}}`);
  }
  return rules.length === 0 ? undefined : rules.join("");
}

function closePageHead(value: PageHeadCollector): ClosedReportHead {
  return Object.freeze({
    metadata: Object.freeze(value.metadata.map((entry) => Object.freeze({
      tag: entry.tag,
      attrs: Object.freeze({ ...entry.attrs }),
    }))),
    styles: Object.freeze(value.styles.map((entry) => Object.freeze({
      ...(entry.attrs === undefined ? {} : { attrs: Object.freeze({ ...entry.attrs }) }),
      css: entry.css,
    }))),
  });
}

function mutablePageHead(value: ClosedReportHead): PageHeadCollector {
  return {
    metadata: value.metadata.map((entry) => Object.freeze({
      tag: entry.tag,
      attrs: Object.freeze({ ...entry.attrs }),
    })),
    styles: value.styles.map((entry) => Object.freeze({
      ...(entry.attrs === undefined ? {} : { attrs: Object.freeze({ ...entry.attrs }) }),
      css: entry.css,
    })),
  };
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
}): Effect.Effect<NodeResult, ReportLimitExceeded | AnalysisExecutionError, Scope.Scope> {
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
    // Face callbacks are author code too. Resolve their returned JSX,
    // fragments, function components, and Report components now, while the
    // Sample Scope remains open; a renderer receives only closed node data.
    const closedText = yield* resolveNode(text.value, input.resolver);
    if (closedText.state === "failed") return closedText;
    const closedWeb = yield* resolveNode(web.value, input.resolver);
    if (closedWeb.state === "failed") return closedWeb;
    return Object.freeze({
      state: "resolved" as const,
      value: Object.freeze({
        type: "primitive" as const,
        text: closedText.value,
        web: closedWeb.value,
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
    navigation: page.navigation,
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

  if (!routeOwners.has("/")) paths.push(hostStaticPath("index.html"));
  paths.push(
    hostStaticPath("_niceeval/execution.json"),
    hostStaticPath("_niceeval/manifest.json"),
    hostStaticPath("_niceeval/problems/index.html"),
    hostStaticPath(REPORT_CLASSIC_STYLESHEET_PATH),
    hostStaticPath(REPORT_REFRESH_RUNTIME_PATH),
    hostStaticPath("_niceeval/complete"),
  );

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
          navigation: attempt.page.navigation,
          head: attempt.head,
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
  return Object.freeze({ sample: resolver.sample, scope: resolver.sample, page: resolver.page });
}

function resolveContext(resolver: NodeResolver): ResolveContext {
  return Object.freeze({ sample: resolver.sample, scope: resolver.sample, page: resolver.page });
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

function reportExecutionId(report: HostReport): string {
  const encoded = JSON.stringify({
    title: report.title ?? null,
    pages: report.pages.map((page) => ({
      id: page.id,
      path: page.path,
      title: page.title,
      navigation: page.navigation,
      kind: page.kind,
    })),
  });
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
