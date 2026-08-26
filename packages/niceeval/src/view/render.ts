import { posix } from "node:path";
import { Effect } from "effect";

import type { AttemptLocator } from "../attempt-locator.ts";
import type {
  InspectionDocument,
  InspectionOperation,
  OpenInspectionSource,
} from "../inspection/index.ts";
import { inspectionHost } from "../inspection/index.ts";
import type { RunId } from "../record/model/identifiers.ts";
import { makeViewRevision, type ViewFile, type ViewRevision } from "./revision.ts";

export type ViewTarget =
  | { readonly kind: "overview" }
  | { readonly kind: "runs"; readonly runIds: readonly RunId[] }
  | { readonly kind: "attempt"; readonly locator: AttemptLocator };

const VIEW_RUN_PAGE_LIMIT = 64;
const VIEW_ATTEMPT_PAGE_LIMIT = 128;
const OVERVIEW_PATH = "overview/index.html";
const COMPARE_PATH = "compare/index.html";

interface RunPage {
  readonly runId: string;
  readonly path: string;
  readonly core: InspectionDocument;
  readonly summary: InspectionDocument;
}

interface AttemptPage {
  readonly locator: string;
  readonly path: string;
  readonly detail: InspectionDocument;
  readonly trace: InspectionDocument;
  readonly diff: InspectionDocument;
  readonly sources: InspectionDocument;
  readonly artifacts: InspectionDocument;
}

interface ViewGraph {
  readonly overview: InspectionDocument;
  readonly runs: readonly RunPage[];
  readonly attempts: readonly AttemptPage[];
  readonly comparison?: InspectionDocument;
  readonly delivery: {
    readonly candidateRuns: number;
    readonly deliveredRuns: number;
    readonly discoveredAttempts: number;
    readonly deliveredAttempts: number;
  };
}

interface RenderContext {
  readonly currentPath: string;
  readonly graph: ViewGraph;
  readonly runPaths: ReadonlyMap<string, string>;
  readonly attemptPaths: ReadonlyMap<string, string>;
}

export function buildViewRevision(
  source: OpenInspectionSource,
  target: ViewTarget,
): Effect.Effect<ViewRevision, import("../inspection/index.ts").InspectionHostError> {
  return Effect.gen(function* () {
    const overview = yield* inspect(source, Object.freeze({ kind: "runs.list" as const }));
    const targetAttempt = target.kind === "attempt"
      ? yield* inspect(source, Object.freeze({ kind: "attempt.get" as const, locator: target.locator }))
      : undefined;
    const candidateRunIds = uniqueStrings(target.kind === "overview"
      ? runIdsFromOverview(overview)
      : target.kind === "runs"
        ? target.runIds
        : runIdsFromAttempt(targetAttempt));
    const deliveredRunIds = candidateRunIds.slice(0, VIEW_RUN_PAGE_LIMIT);
    const runs = yield* Effect.forEach(deliveredRunIds, (runId): Effect.Effect<RunPage, import("../inspection/index.ts").InspectionHostError> =>
      Effect.gen(function* () {
        const core = yield* inspect(source, Object.freeze({ kind: "run.get" as const, runId: runId as RunId }));
        const summary = yield* inspect(source, Object.freeze({ kind: "run.summary" as const, runId: runId as RunId }));
        return Object.freeze({ runId, path: runPath(runId), core, summary });
      }), { concurrency: 1 });
    const discoveredLocators = uniqueStrings([
      ...(target.kind === "attempt" ? [target.locator] : []),
      ...runs.flatMap(({ summary }) => attemptLocatorsFromSummary(summary)),
    ]);
    const deliveredLocators = discoveredLocators.slice(0, VIEW_ATTEMPT_PAGE_LIMIT);
    const attempts = yield* Effect.forEach(deliveredLocators, (locator): Effect.Effect<AttemptPage, import("../inspection/index.ts").InspectionHostError> =>
      Effect.gen(function* () {
        const detail = target.kind === "attempt" && locator === target.locator && targetAttempt !== undefined
          ? targetAttempt
          : yield* inspect(source, Object.freeze({ kind: "attempt.get" as const, locator }));
        const trace = yield* inspect(source, Object.freeze({ kind: "attempt.trace" as const, locator }));
        const diff = yield* inspect(source, Object.freeze({ kind: "attempt.diff" as const, locator }));
        const sources = yield* inspect(source, Object.freeze({ kind: "attempt.sources" as const, locator }));
        const artifacts = yield* inspect(source, Object.freeze({ kind: "attempt.artifacts" as const, locator }));
        return Object.freeze({ locator, path: attemptPath(locator), detail, trace, diff, sources, artifacts });
      }), { concurrency: 1 });
    const comparison = deliveredRunIds.length < 2
      ? undefined
      : yield* inspect(source, Object.freeze({
          kind: "runs.compare" as const,
          mode: "side-by-side" as const,
          leftRunIds: Object.freeze([deliveredRunIds[0] as RunId]),
          rightRunIds: Object.freeze([deliveredRunIds[1] as RunId]),
        }));
    const cutoff = source.facts.cutoff();
    const graph = Object.freeze({
      overview,
      runs: Object.freeze(runs),
      attempts: Object.freeze(attempts),
      ...(comparison === undefined ? {} : { comparison }),
      delivery: Object.freeze({
        candidateRuns: candidateRunIds.length,
        deliveredRuns: runs.length,
        discoveredAttempts: discoveredLocators.length,
        deliveredAttempts: attempts.length,
      }),
    });
    return makeViewRevision({
      sourceCutoffIdentity: cutoff.identity,
      sourceRunCount: cutoff.runCount,
      files: renderRevisionFiles(graph, target),
    });
  });
}

function inspect(source: OpenInspectionSource, operation: InspectionOperation) {
  return inspectionHost.run(source, Object.freeze({
    protocol: "niceeval.query/v1" as const,
    operation,
  }));
}

function runIdsFromOverview(document: InspectionDocument): readonly string[] {
  return arrayField(document, "runs").flatMap((candidate) => {
    const runId = objectValue(candidate)?.runId;
    return typeof runId === "string" ? [runId] : [];
  });
}

function runIdsFromAttempt(document: InspectionDocument | undefined): readonly string[] {
  const detail = objectField(document, "attempt");
  const originRunId = objectValue(detail?.originRun)?.runId;
  const targetRunIds = Array.isArray(detail?.targets)
    ? detail.targets.flatMap((candidate) => {
        const runId = objectValue(candidate)?.runId;
        return typeof runId === "string" ? [runId] : [];
      })
    : [];
  return uniqueStrings([...(typeof originRunId === "string" ? [originRunId] : []), ...targetRunIds]);
}

function attemptLocatorsFromSummary(document: InspectionDocument): readonly string[] {
  const summary = objectField(document, "summary");
  return Array.isArray(summary?.members)
    ? summary.members.flatMap((candidate) => {
        const locator = objectValue(candidate)?.locator;
        return typeof locator === "string" ? [locator] : [];
      })
    : [];
}

function uniqueStrings(values: readonly (string | RunId | AttemptLocator)[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function portableSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function runPath(runId: string): string {
  return `runs/${portableSegment(runId)}/index.html`;
}

function attemptPath(locator: string): string {
  return `attempts/${portableSegment(locator)}/index.html`;
}

type ViewLocale = "en" | "zh-CN";

function renderRevisionFiles(graph: ViewGraph, target: ViewTarget): readonly ViewFile[] {
  const runPaths = new Map(graph.runs.map(({ runId, path }) => [runId, path] as const));
  const attemptPaths = new Map(graph.attempts.map(({ locator, path }) => [locator, path] as const));
  const output: ViewFile[] = [
    textFile("assets/view.css", "text/css; charset=utf-8", VIEW_STYLE),
    textFile("assets/view.js", "text/javascript; charset=utf-8", VIEW_SCRIPT),
  ];
  const context = (currentPath: string): RenderContext => Object.freeze({
    currentPath,
    graph,
    runPaths,
    attemptPaths,
  });
  const addPage = (path: string, english: string, chinese: string): void => {
    const dataPath = pageDataPath(path);
    output.push(textFile(path, "text/html; charset=utf-8", renderPage(context(path), dataPath)));
    output.push(textFile(dataPath, "application/json; charset=utf-8", `${JSON.stringify({
      format: "niceeval.view-page/v1",
      en: english,
      "zh-CN": chinese,
    })}\n`));
  };
  addPage(
    "index.html",
    renderTarget(graph, target, context("index.html"), "en"),
    renderTarget(graph, target, context("index.html"), "zh-CN"),
  );
  addPage(
    OVERVIEW_PATH,
    renderOverview(graph.overview, "en", context(OVERVIEW_PATH)),
    renderOverview(graph.overview, "zh-CN", context(OVERVIEW_PATH)),
  );
  for (const run of graph.runs) {
    addPage(
      run.path,
      renderRun(run, "en", context(run.path)),
      renderRun(run, "zh-CN", context(run.path)),
    );
  }
  for (const attempt of graph.attempts) {
    addPage(
      attempt.path,
      renderAttemptPage(attempt, "en", context(attempt.path)),
      renderAttemptPage(attempt, "zh-CN", context(attempt.path)),
    );
    for (const [leaf, document, render] of [
      ["sources", attempt.sources, renderSources],
      ["artifacts", attempt.artifacts, renderArtifacts],
    ] as const) {
      const path = attemptLeafPath(attempt.locator, leaf);
      addPage(
        path,
        render(document, attempt.locator, "en", context(path)),
        render(document, attempt.locator, "zh-CN", context(path)),
      );
    }
  }
  if (graph.comparison !== undefined) {
    addPage(
      COMPARE_PATH,
      renderComparison(graph.comparison, "en"),
      renderComparison(graph.comparison, "zh-CN"),
    );
  }
  return Object.freeze(output);
}

function renderTarget(graph: ViewGraph, target: ViewTarget, context: RenderContext, locale: ViewLocale): string {
  if (target.kind === "overview") return renderOverview(graph.overview, locale, context);
  if (target.kind === "attempt") {
    const attempt = graph.attempts.find(({ locator }) => locator === target.locator);
    return attempt === undefined
      ? `<section><h2>${text(locale, "attemptInsight")}</h2><p class="empty">${text(locale, "resultLimited")}</p></section>`
      : renderAttemptPage(attempt, locale, context);
  }
  const selected = target.runIds.flatMap((runId) => {
    const page = graph.runs.find((candidate) => candidate.runId === runId);
    return page === undefined ? [] : [page];
  });
  return selected.length === 0
    ? `<section><h2>${text(locale, "runs")}</h2><p class="empty">${text(locale, "noSelectedRuns")}</p></section>`
    : selected.map((run) => renderRun(run, locale, context)).join("");
}

function renderPage(context: RenderContext, dataPath: string): string {
  const styleHref = href(context.currentPath, "assets/view.css");
  const scriptHref = href(context.currentPath, "assets/view.js");
  const dataHref = href(context.currentPath, dataPath);
  const overviewHref = href(context.currentPath, OVERVIEW_PATH);
  const compareLink = context.graph.comparison === undefined
    ? ""
    : `<a href="${attribute(href(context.currentPath, COMPARE_PATH))}"><span data-copy-locale="en">Compare</span><span data-copy-locale="zh-CN" hidden>比较</span></a>`;
  const refresh = `<aside id="niceeval-update" role="status" aria-live="polite" hidden><span data-copy-locale="en">New run update available.</span><span data-copy-locale="zh-CN" hidden>有新的运行结果可用。</span> <button id="niceeval-refresh" type="button"><span data-copy-locale="en">Refresh</span><span data-copy-locale="zh-CN" hidden>刷新</span></button></aside>`;
  return `<!doctype html><html lang="en" data-view-page="${attribute(dataHref)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"><title>NiceEval View</title><link rel="stylesheet" href="${attribute(styleHref)}"></head><body><header><nav class="page-nav" aria-label="View pages"><a href="${attribute(overviewHref)}"><span data-copy-locale="en">Overview</span><span data-copy-locale="zh-CN" hidden>总览</span></a>${compareLink}</nav><nav class="language-nav"><label for="niceeval-language"><span data-copy-locale="en">Language</span><span data-copy-locale="zh-CN" hidden>语言</span></label><select id="niceeval-language"><option value="en">English</option><option value="zh-CN">中文</option></select></nav></header><h1>NiceEval View</h1><p class="lead"><span data-copy-locale="en">Fixed first-party inspection of sealed Record facts.</span><span data-copy-locale="zh-CN" hidden>对已封存 Record 事实的第一方固定检视。</span></p>${refresh}<main data-insight-locale="en" aria-busy="true"></main><main data-insight-locale="zh-CN" aria-busy="true" hidden></main><script src="${attribute(scriptHref)}" defer></script></body></html>`;
}

function renderOverview(document: InspectionDocument | undefined, locale: ViewLocale, context: RenderContext): string {
  const runs = arrayField(document, "runs");
  const selection = objectValue(document?.selection);
  const totalRunCount = numberValue(selection?.totalRunCount) ?? runs.length;
  const truncated = selection?.truncated === true;
  const rows = runs.map((run) => {
    const value = objectValue(run);
    const runId = typeof value?.runId === "string" ? value.runId : undefined;
    const path = runId === undefined ? undefined : context.runPaths.get(runId);
    const identity = path === undefined
      ? `<code>${html(runId)}</code>`
      : `<a href="${attribute(href(context.currentPath, path))}"><code>${html(runId)}</code></a>`;
    return `<tr><td>${identity}</td><td>${html(value?.startedAt)}</td><td>${html(value?.memberCount)}</td><td>${html(value?.attemptCount)}</td><td>${html(value?.attachmentCount)}</td><td>${html(value?.contentCount)}</td></tr>`;
  }).join("");
  const delivery = truncated
    ? `<p><strong>truncated</strong> — ${escapeHtml(text(locale, "runDelivery").replace("{shown}", String(runs.length)).replace("{total}", String(totalRunCount)))} ${locale === "en" ? "Continue through the fixed runs.list continuation with niceeval query." : "请通过 niceeval query 使用固定的 runs.list continuation 继续读取。"}</p>`
    : `<p>${escapeHtml(text(locale, "runTotal").replace("{total}", String(totalRunCount)))}</p>`;
  return `<section><h2>${text(locale, "overview")}</h2>${delivery}${renderRevisionDelivery(context.graph, locale)}${runs.length === 0 ? `<p class="empty">${text(locale, "noRuns")}</p>` : `<table><thead><tr><th>${text(locale, "run")}</th><th>${text(locale, "started")}</th><th>${text(locale, "members")}</th><th>${text(locale, "attempts")}</th><th>${text(locale, "attachments")}</th><th>${text(locale, "contents")}</th></tr></thead><tbody>${rows}</tbody></table>`}${renderIssuesEvidence(document, locale)}</section>`;
}

function renderRun(page: RunPage, locale: ViewLocale, context: RenderContext): string {
  const document = page.summary;
  const summary = objectField(document, "summary");
  if (summary?.state === "omitted") return limited(document, locale, "runInsight");
  const denominator = objectValue(summary?.denominator);
  const members = Array.isArray(summary?.members) ? summary.members : [];
  const run = Array.isArray(summary?.runs) ? objectValue(summary.runs[0]) : undefined;
  const rows = members.map((member) => {
    const value = objectValue(member);
    const usage = objectValue(value?.usage);
    const locator = typeof value?.locator === "string" ? value.locator : undefined;
    const path = locator === undefined ? undefined : context.attemptPaths.get(locator);
    const locatorCell = path === undefined
      ? `<code>${html(locator)}</code>`
      : `<a href="${attribute(href(context.currentPath, path))}"><code>${html(locator)}</code></a>`;
    const insight = insightFromDetail(value);
    const verdict = typeof value?.verdict === "string" ? value.verdict : insight.verdict;
    return `<tr><td>${html(value?.evalId)}</td><td>${locatorCell}</td><td>${html(value?.state)}</td><td>${html(value?.outcome)}</td><td class="${escapeHtml(verdict ?? "")}">${html(verdict)}</td><td>${html(formatScore(insight.score, locale))}</td><td>${html(coverageSummary(insight.coverage, locale))}</td><td>${html(limitationSummary(insight.limitations, locale))}</td><td>${html(usage?.inputTokens)}</td><td>${html(usage?.outputTokens)}</td></tr>`;
  }).join("");
  return `<section><h2>${text(locale, "run")} <code>${html(run?.runId)}</code></h2><div class="metrics"><div class="metric"><strong>${html(denominator?.observed)}</strong>${text(locale, "observed")}</div><div class="metric"><strong>${html(denominator?.expected)}</strong>${text(locale, "denominator")}</div></div>${members.length === 0 ? `<p class="empty">${text(locale, "noMembers")}</p>` : `<table><thead><tr><th>Eval</th><th>${text(locale, "attempt")}</th><th>${text(locale, "state")}</th><th>${text(locale, "outcome")}</th><th>${text(locale, "verdict")}</th><th>${text(locale, "score")}</th><th>${text(locale, "coverage")}</th><th>${text(locale, "limitations")}</th><th>${text(locale, "inputTokens")}</th><th>${text(locale, "outputTokens")}</th></tr></thead><tbody>${rows}</tbody></table>`}${renderRunFacts(page.core, locale)}${renderIssuesEvidence(document, locale)}</section>`;
}

function renderAttempt(document: InspectionDocument | undefined, locale: ViewLocale, context: RenderContext, locator: string): string {
  const detail = objectField(document, "attempt");
  if (detail?.state === "omitted") return limited(document, locale, "attemptInsight");
  const insight = attemptInsight(document);
  const core = objectValue(detail?.core);
  const origin = objectValue(detail?.originRun);
  const targets = Array.isArray(detail?.targets) ? detail.targets : [];
  const score = formatScore(insight.score, locale);
  const originRunId = typeof origin?.runId === "string" ? origin.runId : undefined;
  const originPath = originRunId === undefined ? undefined : context.runPaths.get(originRunId);
  const originIdentity = originPath === undefined
    ? html(originRunId)
    : `<a href="${attribute(href(context.currentPath, originPath))}">${html(originRunId)}</a>`;
  return `${renderAttemptNavigation(context, locator, locale)}<section><h2>${text(locale, "attempt")} <code>${html(detail?.locator)}</code></h2><div class="metrics"><div class="metric"><strong>${html(core?.outcome)}</strong>${text(locale, "outcome")}</div><div class="metric"><strong>${originIdentity}</strong>${text(locale, "originRun")}</div><div class="metric"><strong>${html(targets.length)}</strong>${text(locale, "targetRuns")}</div></div><h2>${text(locale, "verdict")}</h2><p class="${escapeHtml(insight.verdict ?? "")}">${html(insight.verdict)}</p><h2>${text(locale, "score")}</h2><p><strong>${html(insight.score.state)}</strong> · ${html(score)}</p>${renderAssertions(insight.assertions, locale)}<h2>${text(locale, "evidenceCoverage")}</h2>${renderCoverage(insight.coverage, locale)}<h2>${text(locale, "limitations")}</h2>${renderLimitations(insight.limitations, locale)}${renderIssuesEvidence(document, locale)}</section>`;
}

function renderAttemptPage(attempt: AttemptPage, locale: ViewLocale, context: RenderContext): string {
  return `${renderAttempt(attempt.detail, locale, context, attempt.locator)}${renderSourceAssertions(attempt.sources, locale)}${renderTrace(attempt.trace, attempt.locator, locale)}${renderExecution(attempt.trace, locale)}${renderUsage(attempt.trace, locale)}${renderCommands(attempt.trace, locale)}${renderDiagnostics(attempt.trace, locale)}${renderDiff(attempt.diff, attempt.locator, locale)}`;
}

function renderRevisionDelivery(graph: ViewGraph, locale: ViewLocale): string {
  const { candidateRuns, deliveredRuns, discoveredAttempts, deliveredAttempts } = graph.delivery;
  const truncated = deliveredRuns < candidateRuns || deliveredAttempts < discoveredAttempts;
  const followUp = truncated
    ? locale === "en"
      ? " <strong>truncated</strong> at the stated boundary; continue with <code>niceeval view --run &lt;run-id&gt;</code> and navigate to the Attempt in the page, or use <code>niceeval query</code> for the fixed machine continuation."
      : " 已在所示边界标记为 <strong>truncated</strong>；请使用可见身份通过 <code>niceeval view --run &lt;run-id&gt;</code> 后在页内导航到 Attempt，或通过 <code>niceeval query</code> 继续固定的机器读取。"
    : "";
  return locale === "en"
    ? `<p class="delivery-limit">This immutable revision delivers ${deliveredRuns} of ${candidateRuns} selected Run pages and ${deliveredAttempts} of ${discoveredAttempts} discovered Attempt page sets. Delivery is bounded at ${VIEW_RUN_PAGE_LIMIT} Runs and ${VIEW_ATTEMPT_PAGE_LIMIT} Attempts; it does not enumerate beyond the fixed Inspection selection.${followUp}</p>`
    : `<p class="delivery-limit">此不可变 revision 交付 ${candidateRuns} 个已选运行中的 ${deliveredRuns} 个页面，以及 ${discoveredAttempts} 个已发现尝试中的 ${deliveredAttempts} 组页面。交付固定上限为 ${VIEW_RUN_PAGE_LIMIT} 个运行与 ${VIEW_ATTEMPT_PAGE_LIMIT} 个尝试，不会越过固定 Inspection 选择进行枚举。${followUp}</p>`;
}

function renderRunFacts(document: InspectionDocument, locale: ViewLocale): string {
  const result = objectField(document, "run");
  if (result?.state === "omitted") {
    return `<h2>${locale === "en" ? "Run facts" : "运行事实"}</h2><p>${text(locale, "resultLimited")}</p>`;
  }
  const run = objectValue(result?.value);
  const expectedSlots = Array.isArray(run?.expectedSlots) ? run.expectedSlots.length : undefined;
  return `<h2>${locale === "en" ? "Run facts" : "运行事实"}</h2><dl class="facts"><dt>${locale === "en" ? "Experiment" : "实验"}</dt><dd>${html(run?.experimentId)}</dd><dt>${locale === "en" ? "Expected slots" : "预期槽位"}</dt><dd>${html(expectedSlots)}</dd><dt>${locale === "en" ? "Started" : "开始时间"}</dt><dd>${html(run?.startedAt)}</dd></dl>`;
}

function renderAttemptNavigation(context: RenderContext, locator: string, locale: ViewLocale): string {
  const links = [
    ["Attempt", "尝试", attemptPath(locator)],
    ["Sources", "来源", attemptLeafPath(locator, "sources")],
    ["Artifacts", "产物", attemptLeafPath(locator, "artifacts")],
  ] as const;
  return `<nav class="section-nav" aria-label="${locale === "en" ? "Attempt pages" : "尝试页面"}">${links.map(([english, chinese, path]) => `<a href="${attribute(href(context.currentPath, path))}">${locale === "en" ? english : chinese}</a>`).join("")}</nav>`;
}

function renderSourceAssertions(document: InspectionDocument, locale: ViewLocale): string {
  const sources = objectField(document, "sources");
  const items = Array.isArray(sources?.items) ? sources.items : [];
  const assertions = objectValue(sources?.assertions);
  const sites = Array.isArray(assertions?.sourceSites) ? assertions.sourceSites : [];
  const sitesBySource = new Map<string, readonly unknown[]>();
  for (const site of sites) {
    const source = objectValue(objectValue(site)?.source);
    const sourceItemId = stringField(source, "sourceItemId");
    if (source?.state !== "mapped" || sourceItemId === undefined) continue;
    sitesBySource.set(sourceItemId, Object.freeze([...(sitesBySource.get(sourceItemId) ?? []), site]));
  }
  const files = items.map((candidate) => {
    const source = objectValue(candidate);
    const itemId = stringField(source, "sourceItemId");
    const content = objectValue(source?.content);
    const sourceSites = itemId === undefined ? [] : sitesBySource.get(itemId) ?? [];
    return renderSourceFile(source, content, sourceSites, locale);
  }).join("");
  const assertionLocations = sites.map((site) => renderAssertionLocation(objectValue(site), locale)).join("");
  const sourceLimit = sources === undefined ? "" : renderProjectionState(sources, locale, "attempt.sources", locale === "en" ? "source item" : "来源项");
  const assertionLimit = assertions === undefined ? "" : renderProjectionState(assertions, locale, "attempt.sources", locale === "en" ? "assertion location" : "断言位置");
  return `<section class="debug-section source-assertions"><header class="debug-heading"><div><p class="eyebrow">${locale === "en" ? "Sealed origin" : "封存来源"}</p><h2>${locale === "en" ? "Source & assertions" : "源码与断言"}</h2></div></header>${sourceLimit}${files.length === 0 ? `<p class="empty">${locale === "en" ? "No source files were delivered for this Attempt." : "此 Attempt 未交付来源文件。"}</p>` : `<div class="source-files">${files}</div>`}<section class="assertion-locations"><h3>${locale === "en" ? "Assertion locations" : "断言位置"}</h3>${assertionLimit}${assertionLocations.length === 0 ? `<p class="empty">${locale === "en" ? "No assertion source locations were delivered." : "未交付断言源码位置。"}</p>` : `<ol>${assertionLocations}</ol>`}</section>${renderIssuesEvidence(document, locale, locale === "en" ? "Sources" : "来源")}</section>`;
}

function renderSourceFile(
  source: Readonly<Record<string, unknown>> | undefined,
  content: Readonly<Record<string, unknown>> | undefined,
  sites: readonly unknown[],
  locale: ViewLocale,
): string {
  const path = stringField(source, "path") ?? (locale === "en" ? "Unnamed source" : "未命名来源");
  const contentState = stringField(content, "state") ?? "unavailable";
  const textValue = stringField(content, "text");
  const lineSites = new Map<number, readonly unknown[]>();
  for (const site of sites) {
    const start = objectValue(objectValue(site)?.start);
    const line = numberValue(start?.line);
    if (line === undefined) continue;
    lineSites.set(line, Object.freeze([...(lineSites.get(line) ?? []), site]));
  }
  const code = textValue === undefined
    ? `<p class="empty">${locale === "en" ? "Source text is" : "来源文本为"} <strong>${html(contentState)}</strong>${content?.reason === undefined ? "" : ` — ${html(content.reason)}`}. ${renderFixedFollowUp(locale, "attempt.sources")}</p>`
    : `<ol class="source-code" aria-label="${attribute(locale === "en" ? `${path} source code` : `${path} 源码`)}">${textValue.split("\n").map((line, index) => {
      const lineNumber = index + 1;
      const badges = (lineSites.get(lineNumber) ?? []).map((site) => {
        const entry = objectValue(site);
        return `<span class="source-anchor" title="${attribute(sourcePosition(entry))}">${escapeHtml(stringField(entry, "role") ?? (locale === "en" ? "assertion" : "断言"))}</span>`;
      }).join("");
      return `<li data-line="${lineNumber}"><code>${escapeHtml(line)}</code>${badges}</li>`;
    }).join("")}</ol>`;
  return `<article class="source-file"><header><h3><code>${escapeHtml(path)}</code></h3><span class="status-chip">${html(contentState)}</span></header><p class="source-meta">${locale === "en" ? "Sealed source" : "封存来源"} · ${html(source?.byteLength)} ${locale === "en" ? "bytes" : "字节"} · <code>${html(source?.sha256)}</code></p>${code}</article>`;
}

function renderAssertionLocation(site: Readonly<Record<string, unknown>> | undefined, locale: ViewLocale): string {
  const source = objectValue(site?.source);
  const mapped = source?.state === "mapped";
  const position = sourcePosition(site);
  const role = stringField(site, "role") ?? (locale === "en" ? "assertion" : "断言");
  return `<li><strong>${escapeHtml(role)}</strong> · ${mapped ? `<code>${html(source?.sourceItemId)}</code>` : `<span class="state-warning">${html(source?.state ?? "unmapped")}</span>`} · ${escapeHtml(position)}${mapped ? "" : source?.reason === undefined ? "" : ` — ${html(source.reason)}`}</li>`;
}

function sourcePosition(site: Readonly<Record<string, unknown>> | undefined): string {
  const start = objectValue(site?.start);
  const end = objectValue(site?.end);
  const startText = `${numberValue(start?.line) ?? "?"}:${numberValue(start?.column) ?? "?"}`;
  const endText = `${numberValue(end?.line) ?? "?"}:${numberValue(end?.column) ?? "?"}`;
  return `${startText}–${endText}`;
}

function renderTrace(document: InspectionDocument, locator: string, locale: ViewLocale): string {
  const trace = objectField(document, "trace");
  const conversation = objectValue(trace?.conversation);
  const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
  const items = Array.isArray(conversation?.items) ? conversation.items : [];
  const turnItems = new Map<string | undefined, readonly unknown[]>();
  for (const item of items) {
    const turnId = stringField(objectValue(item), "turnId");
    turnItems.set(turnId, Object.freeze([...(turnItems.get(turnId) ?? []), item]));
  }
  const renderedTurnIds = new Set<string>();
  const renderedTurns = turns.map((turn, index) => {
    const value = objectValue(turn);
    const turnId = stringField(value, "turnId");
    if (turnId !== undefined) renderedTurnIds.add(turnId);
    return renderTrajectoryTurn(value, turnId === undefined ? [] : turnItems.get(turnId) ?? [], index, locale);
  }).join("");
  const boundedTurns = [...turnItems.entries()].flatMap(([turnId, rawItems]) => {
    if (turnId !== undefined && renderedTurnIds.has(turnId)) return [];
    const events = rawItems.map(objectValue).filter((item): item is Readonly<Record<string, unknown>> => item !== undefined);
    const eventMarkup = renderTrajectoryItems(events, locale);
    const identity = turnId === undefined
      ? locale === "en" ? "unassigned" : "未归属"
      : turnId;
    const explanation = turnId === undefined
      ? locale === "en" ? "These events have no recorded Turn identity." : "这些事件未记录所属 Turn 身份。"
      : locale === "en" ? "Turn metadata is not present in this bounded delivery." : "此有界交付中未包含该 Turn 元数据。";
    return [`<details class="trajectory-turn trajectory-turn-bounded" data-trajectory-turn open><summary><span>${locale === "en" ? "Bounded Turn events" : "有界 Turn 事件"}</span><span class="turn-summary"><code>${html(identity)}</code></span></summary><p class="source-meta">${explanation}</p><div class="trajectory-events">${eventMarkup || `<p class="empty">${locale === "en" ? "No displayable events were delivered." : "未交付可显示事件。"}</p>`}</div></details>`];
  }).join("");
  const content = `${renderedTurns}${boundedTurns}` || `<p class="empty">${locale === "en" ? "No bounded session events were delivered." : "未交付有界会话事件。"}</p>`;
  return `<section class="debug-section session-log" data-trajectory><header class="debug-heading"><div><p class="eyebrow">${locale === "en" ? "Turn ledger" : "回合账本"}</p><h2>${locale === "en" ? "Session log" : "会话日志"}</h2><p class="source-meta"><code>${html(locator)}</code></p></div><div class="trajectory-controls"><label>${locale === "en" ? "Search trajectory" : "搜索轨迹"}<input type="search" data-trajectory-search placeholder="${attribute(locale === "en" ? "Search messages, tools, and results" : "搜索消息、工具和结果")}"></label><button type="button" data-trajectory-action="turns">${locale === "en" ? "Collapse turns" : "折叠回合"}</button><button type="button" data-trajectory-action="tools">${locale === "en" ? "Collapse tool calls" : "折叠工具调用"}</button></div></header>${conversation === undefined ? "" : renderProjectionState(conversation, locale, "attempt.trace", locale === "en" ? "session event" : "会话事件")}<section class="trajectory-timeline" role="region" aria-label="${attribute(locale === "en" ? "Trajectory timeline" : "轨迹时间线")}">${renderTrajectoryPlot(items, locale)}${content}</section>${renderIssuesEvidence(document, locale, locale === "en" ? "Trace" : "轨迹")}</section>`;
}

function renderTrajectoryPlot(items: readonly unknown[], locale: ViewLocale): string {
  const entries = items.map(objectValue).filter((item): item is Readonly<Record<string, unknown>> => item !== undefined);
  if (entries.length === 0) return "";
  const lanes = locale === "en"
    ? Object.freeze(["Input / User", "Model / Assistant", "Tools / Tool"])
    : Object.freeze(["输入 / 用户", "模型 / 助手", "工具 / 调用"]);
  const steps = entries.map((item, index) => {
    const lane = trajectoryLane(item);
    const label = trajectoryPlotLabel(item, locale);
    return `<li class="trajectory-plot-step"><span class="plot-order">${String(index + 1).padStart(2, "0")}</span>${(["input", "model", "tools"] as const).map((candidate) => candidate === lane
      ? `<span class="plot-cell plot-${candidate}">${escapeHtml(label)}</span>`
      : `<span class="plot-cell" aria-hidden="true"></span>`).join("")}</li>`;
  }).join("");
  return `<div class="trajectory-plot" aria-label="${attribute(locale === "en" ? "Sequence plot ordered by recorded event order" : "按已记录事件顺序排列的序列图")}"><div class="trajectory-plot-caption"><strong>${locale === "en" ? "Sequence plot" : "序列图"}</strong><span>${locale === "en" ? "Event order only — no event timestamps were recorded." : "仅表示事件顺序；未记录逐事件时间戳。"}</span></div><div class="trajectory-plot-labels"><span></span>${lanes.map((lane) => `<span>${escapeHtml(lane)}</span>`).join("")}</div><ol class="trajectory-plot-steps">${steps}</ol></div>`;
}

function trajectoryLane(item: Readonly<Record<string, unknown>>): "input" | "model" | "tools" {
  const kind = stringField(item, "kind");
  if (kind === "tool-call" || kind === "tool-result") return "tools";
  if (item.role === "user" || kind === "input-request" || kind === "context-injection") return "input";
  return "model";
}

function trajectoryPlotLabel(item: Readonly<Record<string, unknown>>, locale: ViewLocale): string {
  const kind = stringField(item, "kind") ?? "event";
  const role = stringField(item, "role");
  const tool = stringField(item, "tool");
  const label = stringField(item, "label");
  const summary = stringField(item, "text") ?? stringField(item, "summary") ?? stringField(item, "output") ?? stringField(item, "prompt");
  const identity = tool ?? label ?? role ?? kind;
  const compact = summary === undefined ? undefined : compactPlotText(summary);
  return compact === undefined ? identity : `${identity} · ${compact}`;
}

function compactPlotText(value: string): string {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  return normalized.length <= 42 ? normalized : `${normalized.slice(0, 41)}…`;
}

function renderTrajectoryTurn(
  turn: Readonly<Record<string, unknown>> | undefined,
  rawItems: readonly unknown[],
  index: number,
  locale: ViewLocale,
): string {
  const turnId = stringField(turn, "turnId") ?? `turn-${index + 1}`;
  const sequence = numberValue(turn?.sequence) ?? index + 1;
  const outcome = stringField(turn, "outcome") ?? stringField(objectValue(turn?.terminal), "status") ?? "recorded";
  const context = objectValue(turn?.context);
  const items = rawItems.map(objectValue).filter((item): item is Readonly<Record<string, unknown>> => item !== undefined);
  const eventMarkup = renderTrajectoryItems(items, locale);
  return `<details class="trajectory-turn" data-trajectory-turn open><summary><span>Turn ${html(sequence)}</span><span class="turn-summary"><code>${html(turnId)}</code> · ${html(outcome)}</span></summary>${renderTurnContext(context, locale)}<div class="trajectory-events">${eventMarkup || `<p class="empty">${locale === "en" ? "No events for this Turn." : "此回合没有事件。"}</p>`}</div></details>`;
}

function renderTurnContext(context: Readonly<Record<string, unknown>> | undefined, locale: ViewLocale): string {
  if (context === undefined) return "";
  const state = stringField(context, "state");
  const label = locale === "en" ? "Context" : "上下文";
  const sourceItemId = stringField(context, "sourceItemId");
  const summary = stringField(context, "summary") ?? stringField(context, "text") ?? stringField(context, "reason");
  const location = sourceItemId === undefined
    ? undefined
    : `${sourceItemId} · ${sourcePosition(context)}`;
  return `<details class="turn-context"><summary>${label}${state === undefined ? "" : ` · ${html(state)}`}</summary>${summary !== undefined ? `<pre>${escapeHtml(summary)}</pre>` : location !== undefined ? `<p>${locale === "en" ? "Recorded source location" : "已记录来源位置"}: <code>${escapeHtml(location)}</code></p>` : `<p>${locale === "en" ? "Context metadata was not recorded." : "未记录上下文元数据。"}</p>`}</details>`;
}

function renderTrajectoryItems(items: readonly Readonly<Record<string, unknown>>[], locale: ViewLocale): string {
  const consumed = new Set<number>();
  return items.map((item, index) => {
    if (consumed.has(index)) return "";
    if (item.kind === "tool-call") {
      const occurrence = objectValue(item.occurrence);
      const occurrenceId = occurrence?.state === "exact" ? stringField(occurrence, "toolOccurrenceId") : undefined;
      const resultIndex = occurrenceId === undefined ? -1 : items.findIndex((candidate, candidateIndex) =>
        candidateIndex > index && candidate.kind === "tool-result" && stringField(objectValue(candidate.occurrence), "toolOccurrenceId") === occurrenceId);
      if (resultIndex >= 0) consumed.add(resultIndex);
      return renderToolOccurrence(item, resultIndex >= 0 ? items[resultIndex] : undefined, locale);
    }
    return renderTrajectoryItem(item, locale);
  }).join("");
}

function renderToolOccurrence(
  call: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>> | undefined,
  locale: ViewLocale,
): string {
  const tool = stringField(call, "tool") ?? (locale === "en" ? "unrecorded tool" : "未记录工具");
  const input = stringField(call, "input");
  const output = stringField(result, "output");
  const outcome = stringField(result, "outcome") ?? "pending";
  const occurrence = objectValue(call.occurrence);
  const identity = (occurrence?.state === "exact"
    ? stringField(occurrence, "toolOccurrenceId")
    : stringField(occurrence, "reason")) ?? "unavailable";
  const search = [tool, input, output, outcome, identity].filter((value): value is string => value !== undefined).join(" ");
  return `<article class="trajectory-event trajectory-tool" data-trajectory-item data-search="${attribute(search)}"><button type="button" class="trajectory-tool-toggle" aria-expanded="false" data-tool-toggle>${locale === "en" ? "Tool" : "工具"} ${escapeHtml(tool)} <span class="event-id">${escapeHtml(identity)}</span></button><div class="tool-detail" data-tool-detail hidden><h4>${locale === "en" ? "Input" : "输入"}</h4>${input === undefined ? `<p class="empty">${locale === "en" ? "Input was not recorded." : "未记录输入。"}</p>` : `<pre>${escapeHtml(input)}${call.inputTruncated === true ? "\n… truncated" : ""}</pre>`}<h4>${locale === "en" ? "Result" : "结果"} <span class="status-chip">${html(outcome)}</span></h4>${output === undefined ? `<p class="empty">${locale === "en" ? "Result was not recorded." : "未记录结果。"}</p>` : `<pre>${escapeHtml(output)}${result?.outputTruncated === true ? "\n… truncated" : ""}</pre>`}</div></article>`;
}

function renderTrajectoryItem(item: Readonly<Record<string, unknown>>, locale: ViewLocale): string {
  const kind = stringField(item, "kind") ?? "event";
  const role = stringField(item, "role");
  const label = stringField(item, "label");
  const code = stringField(item, "code");
  const state = stringField(item, "state") ?? stringField(item, "outcome");
  const prompt = stringField(item, "prompt");
  const response = stringField(item, "response");
  const body = stringField(item, "text") ?? stringField(item, "summary") ?? stringField(item, "output") ?? (prompt === undefined ? undefined : `${locale === "en" ? "Prompt" : "请求"}: ${prompt}${response === undefined ? "" : `\n${locale === "en" ? "Response" : "回复"}: ${response}`}`) ?? (locale === "en" ? "No displayable event text was recorded." : "未记录可显示事件文本。");
  const search = [kind, role, label, code, state, body].filter((value): value is string => value !== undefined).join(" ");
  return `<article class="trajectory-event kind-${attribute(kind)}" data-trajectory-item data-search="${attribute(search)}"><header><span class="event-kind">${html(kind)}</span>${role === undefined ? "" : `<strong>${escapeHtml(role)}</strong>`}${label === undefined ? "" : `<strong>${escapeHtml(label)}</strong>`}${state === undefined ? "" : `<span class="status-chip">${html(state)}</span>`}${code === undefined ? "" : `<code>${html(code)}</code>`}</header><pre>${escapeHtml(body)}${item.textTruncated === true || item.summaryTruncated === true || item.outputTruncated === true || item.promptTruncated === true || item.responseTruncated === true ? "\n… truncated" : ""}</pre></article>`;
}

function renderExecution(document: InspectionDocument, locale: ViewLocale): string {
  const trace = objectField(document, "trace");
  const timing = objectValue(trace?.timing);
  const activities = Array.isArray(timing?.activities) ? timing.activities : [];
  const timed = activities.map(objectValue).filter((activity): activity is Readonly<Record<string, unknown>> => activity !== undefined);
  const endOffset = Math.max(1, ...timed.map((activity) =>
    (numberValue(activity.startOffsetMs) ?? 0) + (numberValue(activity.durationMs) ?? 0)));
  const rows = timed.map((activity) => {
    const startOffset = numberValue(activity.startOffsetMs) ?? 0;
    const duration = numberValue(activity.durationMs) ?? 0;
    const geometry = waterfallGeometry(startOffset, duration, endOffset);
    return `<li class="execution-waterfall-row"><div class="waterfall-label"><strong>${html(activity.label ?? activity.phase)}</strong><p>${html(activity.phase)} · ${locale === "en" ? "start" : "开始"} ${formatMilliseconds(startOffset)} · ${locale === "en" ? "duration" : "耗时"} ${formatMilliseconds(duration)}${activity.outcome === undefined ? "" : ` · ${html(activity.outcome)}`}</p></div><div class="waterfall-track" aria-hidden="true"><span class="waterfall-bar waterfall-start-${geometry.start} waterfall-width-${geometry.width}"></span></div></li>`;
  }).join("");
  return `<section class="debug-section execution"><header class="debug-heading"><div><p class="eyebrow">${locale === "en" ? "Runner activities" : "运行活动"}</p><h2>${locale === "en" ? "Execution timeline" : "执行时间线"}</h2></div></header>${timing === undefined ? "" : renderProjectionState(timing, locale, "attempt.trace", locale === "en" ? "activity" : "活动")}${rows === "" ? `<p class="empty">${locale === "en" ? "No execution activities were delivered." : "未交付执行活动。"}</p>` : `<p class="timeline-scale">${locale === "en" ? "Relative to Attempt start" : "相对于 Attempt 开始"} · ${formatMilliseconds(endOffset)}</p><ol class="execution-timeline">${rows}</ol>`}</section>`;
}

function waterfallGeometry(startOffset: number, duration: number, total: number): { readonly start: number; readonly width: number } {
  const slots = 16;
  const start = Math.max(0, Math.min(slots - 1, Math.floor(startOffset / total * slots)));
  const intendedWidth = Math.max(1, Math.ceil(duration / total * slots));
  return Object.freeze({ start, width: Math.max(1, Math.min(slots - start, intendedWidth)) });
}

function renderUsage(document: InspectionDocument, locale: ViewLocale): string {
  const trace = objectField(document, "trace");
  const usage = objectValue(trace?.usage);
  const observations = Array.isArray(usage?.observations) ? usage.observations : [];
  const cards = observations.map((candidate) => renderUsageObservation(objectValue(candidate), locale)).join("");
  return `<section class="debug-section usage"><header class="debug-heading"><div><p class="eyebrow">${locale === "en" ? "Observed consumption" : "已观察用量"}</p><h2>${locale === "en" ? "Usage" : "用量"}</h2></div></header>${usage === undefined ? "" : renderProjectionState(usage, locale, "attempt.trace", locale === "en" ? "usage observation" : "用量观察")}<div class="usage-observations">${cards || `<p class="empty">${locale === "en" ? "No usage observations were delivered." : "未交付用量观察。"}</p>`}</div></section>`;
}

function renderUsageObservation(observation: Readonly<Record<string, unknown>> | undefined, locale: ViewLocale): string {
  const kind = stringField(observation, "kind") ?? "usage";
  const provider = stringField(observation, "provider") ?? (locale === "en" ? "unrecorded provider" : "未记录提供方");
  const detail = kind === "token-bucket"
    ? `${html(observation?.tokens)} ${html(observation?.bucket)} ${locale === "en" ? "tokens" : "tokens"}`
    : kind === "request"
      ? `${html(observation?.requestKind)} ${locale === "en" ? "request" : "请求"}`
      : kind === "provider-cost"
        ? `${html(observation?.amount)} ${html(observation?.currency)}`
        : html(kind);
  return `<article class="usage-observation"><strong>${escapeHtml(provider)}</strong><span>${detail}</span><small><code>${html(observation?.turnId)}</code> · ${html(kind)}</small></article>`;
}

function renderCommands(document: InspectionDocument, locale: ViewLocale): string {
  const trace = objectField(document, "trace");
  const commands = objectValue(trace?.commands);
  const items = Array.isArray(commands?.items) ? commands.items : [];
  const cards = items.map((candidate) => renderCommand(objectValue(candidate), locale)).join("");
  return `<section class="debug-section command-log"><h2>${locale === "en" ? "Commands" : "命令"}</h2>${commands === undefined ? "" : renderProjectionState(commands, locale, "attempt.trace", locale === "en" ? "command" : "命令")}${cards || `<p class="empty">${locale === "en" ? "No sandbox commands were delivered." : "未交付沙箱命令。"}</p>`}</section>`;
}

function renderCommand(command: Readonly<Record<string, unknown>> | undefined, locale: ViewLocale): string {
  const invocation = objectValue(command?.invocation);
  const commandText = stringField(invocation, "command") ?? [stringField(invocation, "executable"), ...arrayValue(invocation?.arguments).map(String)].filter((part): part is string => part !== undefined).join(" ");
  const stdout = objectValue(command?.stdout);
  const stderr = objectValue(command?.stderr);
  return `<details class="command"><summary><code>${escapeHtml(commandText || (locale === "en" ? "unrecorded command" : "未记录命令"))}</code><span class="status-chip">${escapeHtml(commandOutcome(objectValue(command?.outcome)))}</span></summary><p>${locale === "en" ? "Working directory" : "工作目录"}: <code>${escapeHtml(workingDirectory(objectValue(command?.workingDirectory), locale))}</code></p>${renderCommandStream(stdout, locale === "en" ? "stdout" : "标准输出", locale)}${renderCommandStream(stderr, locale === "en" ? "stderr" : "标准错误", locale)}</details>`;
}

function commandOutcome(outcome: Readonly<Record<string, unknown>> | undefined): string {
  const kind = stringField(outcome, "kind") ?? "unavailable";
  if (kind === "exited") return `exited (${numberValue(outcome?.exitCode) ?? "?"})`;
  return `${kind}${stringField(outcome, "reason") === undefined ? "" : ` (${stringField(outcome, "reason")})`}`;
}

function workingDirectory(value: Readonly<Record<string, unknown>> | undefined, locale: ViewLocale): string {
  const kind = stringField(value, "kind");
  if (kind === "project-relative") return stringField(value, "path") ?? "?";
  if (kind === "sandbox-default") return locale === "en" ? "sandbox default" : "沙箱默认目录";
  if (kind === "redacted") return locale === "en" ? "redacted" : "已脱敏";
  return "—";
}

function renderCommandStream(stream: Readonly<Record<string, unknown>> | undefined, label: string, locale: ViewLocale): string {
  if (stream === undefined) return "";
  const textValue = stringField(stream, "text");
  return `<section class="command-stream"><h3>${escapeHtml(label)} <span class="status-chip">${html(stream.state)}</span></h3>${textValue === undefined ? `<p class="empty">${locale === "en" ? "No displayable stream text." : "没有可显示的流文本。"}</p>` : `<pre>${escapeHtml(textValue)}${stream.textTruncated === true ? "\n… truncated" : ""}</pre>`}</section>`;
}

function renderDiagnostics(document: InspectionDocument, locale: ViewLocale): string {
  const trace = objectField(document, "trace");
  const diagnostics = objectValue(trace?.diagnostics);
  const items = Array.isArray(diagnostics?.items) ? diagnostics.items : [];
  const cards = items.map((candidate) => {
    const diagnostic = objectValue(candidate);
    const causes = Array.isArray(diagnostic?.causes) ? diagnostic.causes : [];
    const redaction = objectValue(diagnostic?.redaction);
    const redactionText = redaction?.state === "applied"
      ? `${locale === "en" ? "redacted" : "已脱敏"} (${html(redaction.replacements)})`
      : locale === "en" ? "not redacted" : "未脱敏";
    return `<article class="diagnostic"><header><strong>${html(diagnostic?.kind)}</strong><code>${html(diagnostic?.code)}</code><span class="status-chip">${redactionText}</span></header><p>${html(diagnostic?.summary)}</p>${causes.length === 0 ? "" : `<ul>${causes.map((cause) => `<li><code>${html(objectValue(cause)?.code)}</code> — ${html(objectValue(cause)?.summary)}</li>`).join("")}</ul>`}</article>`;
  }).join("");
  return `<section class="debug-section diagnostics"><h2>${locale === "en" ? "Diagnostics" : "诊断"}</h2>${diagnostics === undefined ? "" : renderProjectionState(diagnostics, locale, "attempt.trace", locale === "en" ? "diagnostic" : "诊断")}${cards || `<p class="empty">${locale === "en" ? "No diagnostics were delivered." : "未交付诊断。"}</p>`}</section>`;
}

function renderDiff(document: InspectionDocument, locator: string, locale: ViewLocale): string {
  const diff = objectField(document, "diff");
  const collection = objectValue(diff?.collection);
  const windows = Array.isArray(diff?.windows) ? diff.windows : [];
  const changes = windows.flatMap((window) => Array.isArray(objectValue(window)?.changes) ? objectValue(window)!.changes : []);
  const changeItems = changes.map((candidate) => {
    const change = objectValue(candidate);
    return `<li><span class="status-chip">${html(change?.kind)}</span> <code>${html(change?.path)}</code></li>`;
  }).join("");
  const stateValue = collection ?? diff;
  return `<section class="debug-section diff"><h2>${locale === "en" ? "Diff" : "差异"} <code>${html(locator)}</code></h2>${stateValue === undefined ? "" : renderProjectionState(stateValue, locale, "attempt.diff", locale === "en" ? "file change" : "文件变更")}${changeItems === "" ? `<p class="empty">${locale === "en" ? "No bounded file changes were delivered." : "未交付有界文件变更。"}</p>` : `<ul class="file-changes">${changeItems}</ul>`}${renderIssuesEvidence(document, locale, locale === "en" ? "Diff" : "差异")}</section>`;
}

function renderProjectionState(
  projection: Readonly<Record<string, unknown>>,
  locale: ViewLocale,
  operation: "attempt.trace" | "attempt.diff" | "attempt.sources",
  itemName: string,
): string {
  const state = stringField(projection, "state") ?? "unavailable";
  const truncated = Object.entries(projection).some(([key, value]) =>
    value === true && (key === "hasMore" || key.endsWith("Truncated")));
  const omittedCount = Object.entries(projection)
    .filter(([key, value]) => key.startsWith("omitted") && key.endsWith("Count") && typeof value === "number")
    .reduce((sum, [, value]) => sum + (value as number), 0);
  const needsFollowUp = state !== "complete" && state !== "available" || truncated;
  const boundary = truncated
    ? ` <strong>truncated</strong>${omittedCount > 0 ? ` — ${html(omittedCount)} ${escapeHtml(itemName)}${locale === "en" ? " remain outside this bounded delivery." : " 位于此有界交付之外。"}` : locale === "en" ? " — this fixed delivery is bounded." : " — 此固定交付有边界。"}`
    : "";
  const limitations = arrayValue(projection.limitations);
  const issues = arrayValue(projection.issues);
  const details = [...limitations, ...issues].map((value) => renderProjectionDetail(objectValue(value))).join("");
  return `<div class="projection-state"><p><span class="status-chip state-${attribute(state)}">${escapeHtml(state)}</span>${boundary}${needsFollowUp ? ` ${renderFixedFollowUp(locale, operation)}` : ""}</p>${details === "" ? "" : `<ul class="projection-details">${details}</ul>`}</div>`;
}

function renderProjectionDetail(value: Readonly<Record<string, unknown>> | undefined): string {
  if (value === undefined) return "";
  const source = stringField(value, "source");
  const channel = stringField(value, "channel");
  const code = stringField(value, "code");
  const state = stringField(value, "state");
  const reason = stringField(value, "reason");
  const target = stringField(value, "target");
  const label = [source, channel, code, target].filter((part): part is string => part !== undefined).join(" · ") || "limitation";
  return `<li><code>${escapeHtml(label)}</code>${state === undefined ? "" : ` — ${html(state)}`}${reason === undefined ? "" : `: ${escapeHtml(reason)}`}</li>`;
}

function renderFixedFollowUp(locale: ViewLocale, operation: "attempt.trace" | "attempt.diff" | "attempt.sources"): string {
  return locale === "en"
    ? `Continue with the fixed <code>${operation}</code> machine operation through <code>niceeval query</code>.`
    : `请通过 <code>niceeval query</code> 继续读取固定的 <code>${operation}</code> machine operation。`;
}

function formatMilliseconds(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1_000) return `${round(value)} ms`;
  return `${round(value / 1_000)} s`;
}

function renderSources(document: InspectionDocument, locator: string, locale: ViewLocale, context: RenderContext): string {
  const sources = objectField(document, "sources");
  const items = Array.isArray(sources?.items) ? sources.items : [];
  const rows = items.map((candidate) => {
    const source = objectValue(candidate);
    const content = objectValue(source?.content);
    const textValue = typeof content?.text === "string" ? content.text : undefined;
    return `<tr><td>${html(source?.path)}</td><td>${html(content?.state)}</td><td>${html(source?.sha256)}</td><td>${textValue === undefined ? "—" : `<details><summary>${locale === "en" ? "View text" : "查看文本"}</summary><pre>${escapeHtml(textValue)}</pre></details>`}</td></tr>`;
  }).join("");
  return `${renderAttemptNavigation(context, locator, locale)}<section><h2>${locale === "en" ? "Sources" : "来源"} <code>${html(locator)}</code></h2><p><strong>${html(sources?.state)}</strong></p>${items.length === 0 ? `<p class="empty">${locale === "en" ? "No source items were delivered." : "未交付来源条目。"}</p>` : `<table><thead><tr><th>${locale === "en" ? "Path" : "路径"}</th><th>${text(locale, "state")}</th><th>SHA-256</th><th>${locale === "en" ? "Content" : "内容"}</th></tr></thead><tbody>${rows}</tbody></table>`}${renderIssuesEvidence(document, locale)}</section>`;
}

function renderArtifacts(document: InspectionDocument, locator: string, locale: ViewLocale, context: RenderContext): string {
  const artifacts = objectField(document, "artifacts");
  const contents = Array.isArray(artifacts?.contents) ? artifacts.contents : [];
  const rows = contents.map((candidate) => {
    const content = objectValue(candidate);
    return `<tr><td><code>${html(content?.logicalHandle)}</code></td><td>${html(content?.byteLength)}</td><td>${html(content?.digest)}</td></tr>`;
  }).join("");
  const truncated = artifacts?.contentsTruncated === true
    ? `<p><strong>truncated</strong> — ${locale === "en" ? "Additional content metadata is outside this fixed 64-item Inspection boundary; continue with the fixed attempt.artifacts machine operation and retain its declared limit." : "其它内容元数据不在 Inspection 的固定 64 项边界内；请继续使用固定的 attempt.artifacts machine operation，并保留其声明的限制。"}</p>`
    : "";
  return `${renderAttemptNavigation(context, locator, locale)}<section><h2>${locale === "en" ? "Artifacts" : "产物"} <code>${html(locator)}</code></h2><p><strong>${html(artifacts?.state)}</strong></p>${contents.length === 0 ? `<p class="empty">${locale === "en" ? "No artifact content metadata was recorded." : "未记录产物内容元数据。"}</p>` : `<table><thead><tr><th>${locale === "en" ? "Handle" : "句柄"}</th><th>${locale === "en" ? "Bytes" : "字节"}</th><th>${locale === "en" ? "Digest" : "摘要"}</th></tr></thead><tbody>${rows}</tbody></table>`}${truncated}${renderIssuesEvidence(document, locale)}</section>`;
}

function renderComparison(document: InspectionDocument, locale: ViewLocale): string {
  const comparison = objectField(document, "comparison");
  const sides = (["left", "right"] as const).map((side) => {
    const value = objectValue(comparison?.[side]);
    const runs = Array.isArray(value?.runs) ? value.runs : [];
    const members = Array.isArray(value?.members) ? value.members : [];
    return `<section class="comparison-side"><h3>${side === "left" ? (locale === "en" ? "Left" : "左侧") : (locale === "en" ? "Right" : "右侧")}</h3><p>${locale === "en" ? "Runs" : "运行"}: ${runs.map((run) => `<code>${html(objectValue(run)?.runId)}</code>`).join(", ") || "—"}</p><p>${locale === "en" ? "Members" : "成员"}: ${members.length}</p></section>`;
  }).join("");
  return `<section><h2>${locale === "en" ? "Compare Runs" : "比较运行"}</h2><p>${locale === "en" ? "Mode" : "模式"}: <strong>${html(comparison?.mode)}</strong></p><div class="comparison">${sides}</div>${renderIssuesEvidence(document, locale)}</section>`;
}

function limited(document: InspectionDocument | undefined, locale: ViewLocale, heading: "runInsight" | "attemptInsight"): string {
  return `<section><h2>${text(locale, heading)}</h2><p><strong>truncated</strong> — ${text(locale, "resultLimited")} ${locale === "en" ? "Continue with niceeval query for this same fixed operation." : "请使用 niceeval query 对同一个固定 operation 继续读取。"}</p>${renderIssuesEvidence(document, locale)}</section>`;
}

interface AssertionInsight {
  readonly label: string;
  readonly state?: string;
  readonly points?: number;
  readonly earned?: number;
  readonly observed?: string;
  readonly threshold?: number;
}

interface CoverageInsight {
  readonly channel: string;
  readonly status: string;
  readonly reason?: string;
}

interface LimitationInsight {
  readonly owner: string;
  readonly state: string;
  readonly reason?: string;
}

interface ScoreInsight {
  readonly state: "complete" | "unavailable" | "not-scored";
  readonly earned: number;
  readonly possible: number;
}

function attemptInsight(document: InspectionDocument | undefined): {
  readonly assertions: readonly AssertionInsight[];
  readonly coverage: readonly CoverageInsight[];
  readonly limitations: readonly LimitationInsight[];
  readonly score: ScoreInsight;
  readonly verdict?: string;
} {
  const detail = objectField(document, "attempt");
  return insightFromDetail(detail);
}

function insightFromDetail(detail: Readonly<Record<string, unknown>> | undefined): {
  readonly assertions: readonly AssertionInsight[];
  readonly coverage: readonly CoverageInsight[];
  readonly limitations: readonly LimitationInsight[];
  readonly score: ScoreInsight;
  readonly verdict?: string;
} {
  const assertions = assertionInsights(detail);
  const scoreContributions = assertions.filter(({ points }) => points !== undefined);
  const score = Object.freeze({
    state: scoreContributions.length === 0 ? "not-scored" as const : "complete" as const,
    earned: scoreContributions.reduce((total, entry) => total + (entry.earned ?? 0), 0),
    possible: scoreContributions.reduce((total, entry) => total + (entry.points ?? 0), 0),
  });
  const declared = objectValue(detail?.score);
  const closedScore: ScoreInsight = declared !== undefined && typeof declared.state === "string"
    ? Object.freeze({
        state: declared.state === "complete" ? "complete" : declared.state === "not-scored" ? "not-scored" : "unavailable",
        earned: numberValue(declared.earned) ?? score.earned,
        possible: numberValue(declared.possible) ?? score.possible,
      })
    : score;
  const declaredVerdict = typeof detail?.verdict === "string" ? detail.verdict : undefined;
  return Object.freeze({
    assertions,
    coverage: coverageInsights(detail),
    limitations: limitationInsights(detail),
    score: closedScore,
    verdict: declaredVerdict ?? inferVerdict(detail, assertions),
  });
}

function limitationInsights(detail: Readonly<Record<string, unknown>> | undefined): readonly LimitationInsight[] {
  const found = new Map<string, LimitationInsight>();
  const visit = (value: unknown, inheritedOwner = "limitation"): void => {
    if (Array.isArray(value)) { value.forEach((entry) => visit(entry, inheritedOwner)); return; }
    const record = objectValue(value);
    if (record === undefined) return;
    const owner = typeof record.owner === "string"
      ? record.owner
      : typeof record.channel === "string"
        ? record.channel
        : typeof record.code === "string"
          ? record.code
          : inheritedOwner;
    const state = typeof record.state === "string"
      ? record.state
      : typeof record.status === "string"
        ? record.status
        : typeof record.code === "string"
          ? record.code
          : undefined;
    const reason = typeof record.reason === "string" ? record.reason : undefined;
    if (state !== undefined && state !== "complete") {
      found.set(`${owner}\u0000${state}\u0000${reason ?? ""}`, Object.freeze({
        owner,
        state,
        ...(reason === undefined ? {} : { reason }),
      }));
    }
    if (Array.isArray(record.limitations)) visit(record.limitations, owner);
  };
  visit(detail?.limitations);
  return Object.freeze([...found.values()]);
}

function assertionInsights(detail: Readonly<Record<string, unknown>> | undefined): readonly AssertionInsight[] {
  const evidence = objectValue(detail?.evidence);
  const value = objectValue(evidence?.value);
  const entries = Array.isArray(value?.entries) ? value.entries : Array.isArray(value?.["entries-data"]) ? value["entries-data"] : [];
  return Object.freeze(entries.flatMap((candidate) => {
    const entry = objectValue(candidate);
    if (entry === undefined) return [];
    const display = objectValue(entry.display);
    const contribution = objectValue(entry.contribution);
    const evaluation = objectValue(entry.evaluation);
    const policy = objectValue(entry.policy);
    const condition = objectValue(objectValue(policy?.condition)?.value);
    const observed = objectValue(evaluation?.observed);
    const observedDisplay = observed === undefined ? undefined : observedFactValue(observed);
    return [Object.freeze({
      label: typeof display?.label === "string" ? display.label : typeof display?.key === "string" ? display.key : "Assertion",
      ...(typeof objectValue(entry.decision)?.result === "string" ? { state: objectValue(entry.decision)!.result as string } : {}),
      ...(typeof contribution?.points === "number" ? { points: contribution.points } : {}),
      ...(typeof contribution?.earned === "number" ? { earned: contribution.earned } : {}),
      ...(observedDisplay === undefined ? {} : { observed: observedDisplay }),
      ...(typeof condition?.threshold === "number" ? { threshold: condition.threshold } : {}),
    })];
  }));
}

function observedFactValue(value: Readonly<Record<string, unknown>>): string | undefined {
  if (value.kind !== "fields") return factValue(value);
  const kind = factFieldValue(value, "kind");
  if (kind === "boolean") return undefined;
  if (kind === "measurement" || kind === "direct-score") {
    const state = factFieldValue(value, "state");
    if (state !== "available") return state ?? "unavailable";
    return factFieldValue(value, "value") ?? "unavailable";
  }
  return factValue(value);
}

function factFieldValue(value: Readonly<Record<string, unknown>>, label: string): string | undefined {
  const fields = Array.isArray(value.fields) ? value.fields : [];
  const field = fields.find((candidate) => objectValue(candidate)?.label === label);
  const fact = objectValue(objectValue(field)?.value);
  return fact === undefined ? undefined : factValue(fact);
}

function factValue(value: Readonly<Record<string, unknown>>): string {
  if (value.kind === "value") return String(value.value);
  if (value.kind === "text") return String(value.text);
  if (value.kind === "list") return `Array(${Array.isArray(value.items) ? value.items.length : 0})`;
  if (value.kind === "fields") return `Object(${Array.isArray(value.fields) ? value.fields.length : 0})`;
  return String(value.reason ?? "unavailable");
}

function coverageInsights(detail: Readonly<Record<string, unknown>> | undefined): readonly CoverageInsight[] {
  const found = new Map<string, CoverageInsight>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = objectValue(value);
    if (record === undefined) return;
    const coverageValue = record.evidenceCoverage;
    const coverageItems = Array.isArray(coverageValue) ? coverageValue : [];
    for (const raw of coverageItems) {
      const entry = objectValue(raw);
      if (typeof entry?.channel !== "string" || typeof entry.status !== "string") continue;
      const reason = typeof entry.reason === "string" ? entry.reason : undefined;
      found.set(`${entry.channel}\u0000${entry.status}\u0000${reason ?? ""}`, Object.freeze({
        channel: entry.channel,
        status: entry.status,
        ...(reason === undefined ? {} : { reason }),
      }));
    }
    const coverage = objectValue(coverageValue);
    if (coverage !== undefined) {
      for (const [channel, raw] of Object.entries(coverage)) {
        const entry = objectValue(raw);
        const status = typeof raw === "string" ? raw : typeof entry?.status === "string" ? entry.status : typeof entry?.state === "string" ? entry.state : undefined;
        if (status === undefined) continue;
        const reason = typeof entry?.reason === "string" ? entry.reason : undefined;
        found.set(`${channel}\u0000${status}\u0000${reason ?? ""}`, Object.freeze({ channel, status, ...(reason === undefined ? {} : { reason }) }));
      }
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(detail);
  return Object.freeze([...found.values()]);
}

function inferVerdict(detail: Readonly<Record<string, unknown>> | undefined, assertions: readonly AssertionInsight[]): string | undefined {
  const outcome = objectValue(detail?.core)?.outcome;
  if (outcome === "errored" || outcome === "interrupted") return "errored";
  if (outcome === "cancelled") return "skipped";
  return assertions.some(({ state }) => state === "mismatched" || state === "errored" || state === "unavailable") ? "failed" : "passed";
}

function renderAssertions(assertions: readonly AssertionInsight[], locale: ViewLocale): string {
  if (assertions.length === 0) return `<p class="empty">${text(locale, "noAssertions")}</p>`;
  return assertions.map((entry) => `<article class="assertion"><h3>${escapeHtml(entry.label)}</h3><dl><dt>${text(locale, "state")}</dt><dd>${html(entry.state)}</dd>${entry.points === undefined ? "" : `<dt>${text(locale, "weight")}</dt><dd>${html(round(entry.points))} pts</dd><dt>${text(locale, "earned")}</dt><dd>${html(round(entry.earned ?? 0))} pts</dd>`}${entry.observed === undefined ? "" : `<dt>${text(locale, "observedValue")}</dt><dd>${escapeHtml(entry.observed)}</dd>`}${entry.threshold === undefined ? "" : `<dt>${text(locale, "threshold")}</dt><dd>≥ ${html(round(entry.threshold))}</dd>`}</dl></article>`).join("");
}

function renderCoverage(coverage: readonly CoverageInsight[], locale: ViewLocale): string {
  if (coverage.length === 0) return `<p class="empty">${text(locale, "noCoverage")}</p>`;
  return `<ul>${coverage.map((entry) => `<li><strong>${escapeHtml(entry.channel)}</strong> ${escapeHtml(entry.status)}${entry.reason === undefined ? "" : ` — ${escapeHtml(entry.reason)}`}</li>`).join("")}</ul>`;
}

function coverageSummary(coverage: readonly CoverageInsight[], locale: ViewLocale): string {
  const partial = coverage.find(({ status }) => status === "partial") ?? coverage.find(({ status }) => status !== "complete");
  if (partial !== undefined) return `${partial.channel} ${partial.status}${partial.reason === undefined ? "" : ` — ${partial.reason}`}`;
  return coverage.length === 0 ? text(locale, "noCoverage") : text(locale, "complete");
}

function renderLimitations(limitations: readonly LimitationInsight[], locale: ViewLocale): string {
  if (limitations.length === 0) return `<p class="empty">${text(locale, "noLimitations")}</p>`;
  return `<ul>${limitations.map((entry) => `<li><strong>${escapeHtml(entry.owner)}</strong> ${escapeHtml(entry.state)}${entry.reason === undefined ? "" : ` — ${escapeHtml(entry.reason)}`}</li>`).join("")}</ul>`;
}

function limitationSummary(limitations: readonly LimitationInsight[], locale: ViewLocale): string {
  const entry = limitations[0];
  return entry === undefined
    ? text(locale, "noLimitations")
    : `${entry.owner} ${entry.state}${entry.reason === undefined ? "" : ` — ${entry.reason}`}`;
}

function formatScore(score: ScoreInsight, locale: ViewLocale): string {
  if (score.state === "not-scored") return text(locale, "notScored");
  if (score.state === "unavailable") return text(locale, "unavailable");
  return `${round(score.earned)} pts`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}

function renderIssuesEvidence(document: InspectionDocument | undefined, locale: ViewLocale, owner?: string): string {
  if (document === undefined) return "";
  const issues = Array.isArray(document.issues) ? document.issues : [];
  const refs = Array.isArray(objectValue(document.evidence)?.refs) ? objectValue(document.evidence)!.refs as readonly unknown[] : [];
  const prefix = owner === undefined ? "" : `${escapeHtml(owner)} `;
  return `<h2>${prefix}${text(locale, "issues")}</h2>${issues.length === 0 ? `<p class="empty">${text(locale, "noIssues")}</p>` : `<ul>${issues.map((issue) => `<li>${html(objectValue(issue)?.code ?? issue)}</li>`).join("")}</ul>`}<h2>${prefix}${text(locale, "evidence")}</h2>${refs.length === 0 ? `<p class="empty">${text(locale, "noEvidence")}</p>` : `<ul>${refs.map((ref) => `<li><code>${html(ref)}</code></li>`).join("")}</ul>`}`;
}

const TEXT = Object.freeze({
  en: Object.freeze({ overview: "Overview", runs: "Runs", noRuns: "No sealed Runs.", runTotal: "{total} sealed Runs.", runDelivery: "Showing the first {shown} of {total} sealed Runs at this fixed delivery limit.", noSelectedRuns: "No sealed Runs selected.", run: "Run", started: "Started", members: "Members", attempts: "Attempts", attachments: "Attachments", contents: "Contents", runInsight: "Run insight", resultLimited: "Result exceeds the fixed Inspection delivery limit.", observed: "Observed", denominator: "Expected denominator", noMembers: "No expected members.", attempt: "Attempt", state: "State", outcome: "Outcome", verdict: "Verdict", score: "Score", coverage: "Evidence coverage", limitations: "Limitations", inputTokens: "Input tokens", outputTokens: "Output tokens", attemptInsight: "Attempt insight", originRun: "Origin Run", targetRuns: "Target Runs", evidenceCoverage: "Evidence coverage", issues: "Issues", noIssues: "No Inspection issues.", evidence: "Evidence", noEvidence: "No Attempt evidence references.", weight: "Weight", earned: "Earned", observedValue: "Observed", threshold: "Threshold", noAssertions: "No assertion details.", noCoverage: "No evidence coverage facts.", noLimitations: "No partial limitations.", complete: "complete", notScored: "not scored", unavailable: "unavailable" }),
  "zh-CN": Object.freeze({ overview: "总览", runs: "运行", noRuns: "没有已封存的运行。", runTotal: "共有 {total} 个已封存运行。", runDelivery: "固定交付上限内显示前 {shown} 个，共 {total} 个已封存运行。", noSelectedRuns: "未选择已封存的运行。", run: "运行", started: "开始时间", members: "成员", attempts: "尝试", attachments: "附件", contents: "内容", runInsight: "运行检视", resultLimited: "结果超过固定 Inspection 交付上限。", observed: "已观察", denominator: "预期分母", noMembers: "没有预期成员。", attempt: "尝试", state: "状态", outcome: "结果", verdict: "裁决", score: "分数", coverage: "证据覆盖", limitations: "局限", inputTokens: "输入 token", outputTokens: "输出 token", attemptInsight: "尝试检视", originRun: "来源运行", targetRuns: "目标运行", evidenceCoverage: "证据覆盖", issues: "问题", noIssues: "没有 Inspection 问题。", evidence: "证据", noEvidence: "没有尝试证据引用。", weight: "权重", earned: "获得", observedValue: "观察值", threshold: "阈值", noAssertions: "没有断言详情。", noCoverage: "没有证据覆盖事实。", noLimitations: "没有部分局限。", complete: "完整", notScored: "未计分", unavailable: "不可用" }),
});

function text(locale: ViewLocale, key: keyof typeof TEXT.en): string { return TEXT[locale][key]; }
function objectField(document: InspectionDocument | undefined, key: string) { return document === undefined ? undefined : objectValue(Reflect.get(document, key)); }
function arrayField(document: InspectionDocument | undefined, key: string): readonly unknown[] { const value = document === undefined ? undefined : Reflect.get(document, key); return Array.isArray(value) ? value : []; }
function arrayValue(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined; }
function stringField(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined { const field = value?.[key]; return typeof field === "string" ? field : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function html(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") return `Object(${Object.keys(value).length})`;
  return escapeHtml(String(value));
}
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

function attribute(value: string): string { return escapeHtml(value); }

function href(fromPath: string, toPath: string): string {
  const relative = posix.relative(posix.dirname(fromPath), toPath);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function attemptLeafPath(locator: string, leaf: "sources" | "artifacts"): string {
  return `attempts/${portableSegment(locator)}/${leaf}/index.html`;
}

function pageDataPath(pagePath: string): string {
  const directory = posix.dirname(pagePath);
  return directory === "." ? "index.view.json" : `${directory}/page.view.json`;
}

function textFile(path: string, mediaType: string, value: string): ViewFile {
  return Object.freeze({ path, mediaType, bytes: new TextEncoder().encode(value) });
}

const VIEW_STYLE = `
:root{color-scheme:dark;--page:#080a0f;--shell:#0e1118;--panel:#141923;--panel-raised:#1a202c;--line:#293140;--line-strong:#445166;--text:#e7ebf2;--muted:#a3adbd;--soft:#6e788a;--accent:#c5d2e3;--good:#5bd6a5;--bad:#ff7c82;--warn:#efc66a;--radius:6px;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC",sans-serif}
*{box-sizing:border-box}body{margin:0 auto;max-width:108rem;padding:1.5rem 2rem 4rem;color:var(--text);background:radial-gradient(circle at top right,#172133 0,transparent 32rem),var(--page)}header,.page-nav,.language-nav,.section-nav,.debug-heading,.source-file>header,.diagnostic header{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}body>header{position:sticky;top:0;z-index:5;justify-content:space-between;margin:0 -2rem;padding:1rem 2rem;background:color-mix(in srgb,var(--page) 93%,transparent);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.page-nav,.language-nav{justify-content:flex-end}.section-nav{margin:1rem 0;padding:.6rem .75rem;background:var(--shell);border:1px solid var(--line)}a{color:var(--accent)}a:hover{color:#fff}h1{font-size:1.65rem;margin:1.4rem 0 .15rem}h2{font-size:1.18rem;margin:0}h3{font-size:1rem;margin:0}h4{font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:1rem 0 .35rem}.lead,.source-meta,.execution p,.command p{color:var(--muted);margin:.25rem 0}.eyebrow{margin:0 0 .15rem;color:var(--soft);font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase}.delivery-limit{border-left:3px solid var(--line-strong);padding-left:.75rem;color:var(--muted)}.metrics,.comparison,.usage-observations{display:flex;gap:.75rem;flex-wrap:wrap}.metric,.comparison-side,.usage-observation{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:.7rem .9rem}.metric strong{display:block;font-size:1.25rem}table{border-collapse:separate;border-spacing:0;width:100%;display:block;overflow:auto;border:1px solid var(--line);background:var(--panel)}th,td{border-bottom:1px solid var(--line);padding:.6rem;text-align:left;vertical-align:top}th{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em}tr:last-child td{border-bottom:0}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:.35rem 0;max-height:26rem;overflow:auto}.passed{color:var(--good);font-weight:700}.failed,.errored{color:var(--bad);font-weight:700}.assertion{border-left:3px solid var(--line-strong);padding:.15rem 0 .7rem 1rem;margin:1rem 0}.assertion dl,.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.25rem .75rem}.assertion dt,.facts dt{color:var(--muted)}.assertion dd,.facts dd{margin:0}aside{position:sticky;top:4rem;background:#332b17;border:1px solid var(--warn);border-radius:var(--radius);padding:.75rem;margin:1rem 0}button,select,input{font:inherit;color:var(--text);background:var(--panel-raised);border:1px solid var(--line-strong);border-radius:4px;padding:.38rem .58rem}button{cursor:pointer}button:hover,button:focus-visible,input:focus,select:focus{border-color:var(--accent);outline:1px solid var(--accent);outline-offset:1px}.empty{color:var(--muted);font-style:italic}.debug-section{margin-top:1.35rem;padding:1rem;border:1px solid var(--line);background:color-mix(in srgb,var(--shell) 88%,transparent)}.debug-heading{justify-content:space-between;align-items:flex-start}.status-chip{display:inline-flex;align-items:center;gap:.25rem;max-width:100%;padding:.12rem .42rem;border:1px solid var(--line-strong);border-radius:999px;color:var(--muted);font-size:.78rem;font-weight:650;overflow-wrap:anywhere}.state-complete,.state-available{color:var(--good);border-color:color-mix(in srgb,var(--good) 45%,var(--line))}.state-partial,.state-omitted,.state-invalid,.state-not-recorded{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,var(--line))}.projection-state{margin:.75rem 0;color:var(--muted)}.projection-state p{margin:.35rem 0}.projection-details{margin:.4rem 0;padding-left:1.25rem;color:var(--muted)}.source-files{display:grid;gap:.85rem}.source-file{border:1px solid var(--line);background:var(--panel)}.source-file>header{justify-content:space-between;padding:.7rem .85rem;border-bottom:1px solid var(--line);background:var(--panel-raised)}.source-meta{padding:0 .85rem;font-size:.82rem}.source-code{counter-reset:source-line;margin:0;padding:0 0 .6rem;list-style:none;background:#0a0d13}.source-code li{display:grid;grid-template-columns:3.5rem minmax(0,1fr) auto;gap:.75rem;min-height:1.45rem;padding:0 .75rem}.source-code li::before{counter-increment:source-line;content:counter(source-line);color:var(--soft);text-align:right;user-select:none}.source-code li:hover{background:#151c28}.source-code li code{white-space:pre-wrap;overflow-wrap:anywhere}.source-anchor{align-self:center;color:var(--warn);font-size:.72rem}.assertion-locations{margin-top:1rem}.assertion-locations ol{padding-left:1.25rem}.state-warning{color:var(--warn)}.trajectory-controls{display:flex;gap:.5rem;align-items:end;flex-wrap:wrap}.trajectory-controls label{display:grid;gap:.2rem;color:var(--muted);font-size:.8rem}.trajectory-controls input{min-width:17rem}.trajectory-timeline{position:relative;margin-top:1rem;padding-left:1.15rem;border-left:1px solid var(--line-strong)}.trajectory-turn{margin:0 0 .65rem}.trajectory-turn>summary,.command>summary{display:flex;justify-content:space-between;gap:.75rem;cursor:pointer;padding:.55rem .65rem;background:var(--panel-raised);border:1px solid var(--line)}.turn-summary{color:var(--muted);overflow-wrap:anywhere}.turn-context{margin:.5rem 0 0;padding:.35rem .6rem;border-left:2px solid var(--line-strong);color:var(--muted)}.turn-context summary{cursor:pointer}.trajectory-events{display:grid;gap:.5rem;margin:.5rem 0 .25rem}.trajectory-event{position:relative;padding:.65rem .75rem;background:var(--panel);border:1px solid var(--line)}.trajectory-event::before{content:"";position:absolute;left:-1.5rem;top:1rem;width:.5rem;height:.5rem;border-radius:50%;background:var(--line-strong);border:2px solid var(--shell)}.trajectory-event header,.diagnostic header{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.event-kind{color:var(--accent);font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.event-id{color:var(--soft);font-size:.78rem}.trajectory-tool-toggle{display:flex;width:100%;justify-content:space-between;text-align:left;border:0;border-radius:0;background:transparent;padding:0;color:var(--accent)}.tool-detail{margin-top:.7rem;padding-top:.65rem;border-top:1px solid var(--line)}.execution-timeline{display:grid;gap:.25rem;list-style:none;margin:.85rem 0 0;padding:0}.execution-timeline li{display:grid;grid-template-columns:1.25rem minmax(0,1fr);gap:.5rem;padding:.35rem 0;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}.timeline-dot{width:.55rem;height:.55rem;margin-top:.35rem;border-radius:50%;background:var(--accent)}.usage-observations{margin-top:.75rem}.usage-observation{display:grid;gap:.2rem;min-width:10rem}.usage-observation small{color:var(--soft)}.command-log .command,.diagnostics .diagnostic{display:block;margin-top:.65rem;border:1px solid var(--line);background:var(--panel)}.command>summary{align-items:center}.command>p,.command-stream{padding:0 .75rem}.command-stream{border-top:1px solid var(--line);padding-bottom:.55rem}.diagnostic{padding:.7rem .8rem}.diagnostic p{margin:.45rem 0}.file-changes{display:grid;gap:.4rem;list-style:none;padding:0}.file-changes li{padding:.5rem .65rem;background:var(--panel);border:1px solid var(--line)}[data-trajectory-item][hidden]{display:none}@media(max-width:720px){body{padding:1rem}body>header{position:static;margin:0 -1rem;padding:1rem}.debug-heading{display:grid}.trajectory-controls input{min-width:0;width:100%}.source-code li{grid-template-columns:2.5rem minmax(0,1fr)}.source-anchor{display:none}}

/* Fixed first-party density: compact enough to keep the debugging path in one view. */
:root{font-size:13px}body{max-width:1120px;padding:1rem 1.25rem 2.5rem}body>header{margin:0 -1.25rem;padding:.7rem 1.25rem}.section-nav{margin:.65rem 0;padding:.45rem .6rem;gap:.55rem}h1{margin:.9rem 0 .1rem;font-size:1.5rem}h2{font-size:1.1rem}.lead{margin:.15rem 0}.metrics,.comparison,.usage-observations{gap:.5rem}.metric,.comparison-side,.usage-observation{padding:.5rem .65rem}.metric strong{font-size:1.12rem}.assertion{margin:.65rem 0;padding-bottom:.45rem}.debug-section{margin-top:.8rem;padding:.7rem}.source-files{gap:.55rem}.source-file>header{padding:.5rem .65rem}.source-meta{margin:.2rem 0;padding:0 .65rem}.projection-state{margin:.5rem 0}.trajectory-controls{gap:.35rem}.trajectory-controls input{min-width:14rem}.trajectory-timeline{margin-top:.65rem}.trajectory-turn{margin-bottom:.4rem}.trajectory-turn>summary,.command>summary{padding:.42rem .5rem}.trajectory-events{gap:.35rem;margin:.35rem 0 .15rem}.trajectory-event{padding:.48rem .6rem}.tool-detail{margin-top:.45rem;padding-top:.45rem}.execution-timeline{gap:.2rem;margin-top:.5rem}.command-log .command,.diagnostics .diagnostic{margin-top:.45rem}.diagnostic{padding:.55rem .65rem}

.trajectory-plot{margin:.65rem 0 .75rem;padding:.55rem .6rem;border:1px solid var(--line);background:#0a0d13;overflow-x:auto}.trajectory-plot-caption{display:flex;justify-content:space-between;gap:.65rem;margin-bottom:.4rem;color:var(--muted);font-size:.78rem}.trajectory-plot-caption strong{color:var(--text)}.trajectory-plot-labels,.trajectory-plot-step{display:grid;grid-template-columns:2.25rem repeat(3,minmax(7.5rem,1fr));min-width:28rem}.trajectory-plot-labels{color:var(--soft);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.055em}.trajectory-plot-labels span{padding:.18rem .35rem}.trajectory-plot-steps{display:grid;gap:2px;margin:0;padding:0;list-style:none}.trajectory-plot-step{min-height:1.75rem}.plot-order{display:flex;align-items:center;justify-content:flex-end;padding-right:.45rem;color:var(--soft);font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.plot-cell{display:flex;align-items:center;min-width:0;padding:.2rem .35rem;border-left:1px solid var(--line);color:var(--soft);font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plot-input{color:#b8d7ff;background:#142237}.plot-model{color:#bff0d6;background:#13271f}.plot-tools{color:#f5d990;background:#2a2314}

.timeline-scale{margin:.45rem 0 0;color:var(--soft);font-size:.78rem}.execution-timeline{display:grid;gap:.25rem}.execution-waterfall-row{display:grid;grid-template-columns:minmax(11rem,1fr) minmax(10rem,1.4fr);gap:.65rem;align-items:center;padding:.35rem 0;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}.execution-waterfall-row .waterfall-label p{margin:.08rem 0;color:var(--muted);font-size:.78rem}.waterfall-track{display:grid;grid-template-columns:repeat(16,minmax(4px,1fr));min-height:.72rem;border:1px solid var(--line);background:repeating-linear-gradient(90deg,transparent 0,transparent calc(6.25% - 1px),var(--line) calc(6.25% - 1px),var(--line) 6.25%)}.waterfall-bar{grid-row:1;height:.58rem;align-self:center;background:linear-gradient(90deg,#6b93c4,#bdd4ef);border-radius:2px}.waterfall-start-0{grid-column-start:1}.waterfall-start-1{grid-column-start:2}.waterfall-start-2{grid-column-start:3}.waterfall-start-3{grid-column-start:4}.waterfall-start-4{grid-column-start:5}.waterfall-start-5{grid-column-start:6}.waterfall-start-6{grid-column-start:7}.waterfall-start-7{grid-column-start:8}.waterfall-start-8{grid-column-start:9}.waterfall-start-9{grid-column-start:10}.waterfall-start-10{grid-column-start:11}.waterfall-start-11{grid-column-start:12}.waterfall-start-12{grid-column-start:13}.waterfall-start-13{grid-column-start:14}.waterfall-start-14{grid-column-start:15}.waterfall-start-15{grid-column-start:16}.waterfall-width-1{grid-column-end:span 1}.waterfall-width-2{grid-column-end:span 2}.waterfall-width-3{grid-column-end:span 3}.waterfall-width-4{grid-column-end:span 4}.waterfall-width-5{grid-column-end:span 5}.waterfall-width-6{grid-column-end:span 6}.waterfall-width-7{grid-column-end:span 7}.waterfall-width-8{grid-column-end:span 8}.waterfall-width-9{grid-column-end:span 9}.waterfall-width-10{grid-column-end:span 10}.waterfall-width-11{grid-column-end:span 11}.waterfall-width-12{grid-column-end:span 12}.waterfall-width-13{grid-column-end:span 13}.waterfall-width-14{grid-column-end:span 14}.waterfall-width-15{grid-column-end:span 15}.waterfall-width-16{grid-column-end:span 16}@media(max-width:720px){body{padding:.75rem}body>header{margin:0 -.75rem;padding:.65rem .75rem}.trajectory-plot-caption{display:grid}.execution-waterfall-row{grid-template-columns:1fr}.waterfall-track{min-height:.85rem}}
.execution-timeline .execution-waterfall-row{grid-template-columns:minmax(11rem,1fr) minmax(10rem,1.4fr)}
`;

const VIEW_SCRIPT = `(()=>{const root=document.documentElement;const pageUrl=root.dataset.viewPage;const english=document.querySelector('[data-insight-locale="en"]');const chinese=document.querySelector('[data-insight-locale="zh-CN"]');const select=document.getElementById("niceeval-language");const setLanguage=language=>{const locale=language==="zh-CN"?"zh-CN":"en";root.lang=locale;select.value=locale;document.querySelectorAll("[data-insight-locale]").forEach(node=>{node.hidden=node.getAttribute("data-insight-locale")!==locale});document.querySelectorAll("[data-copy-locale]").forEach(node=>{node.hidden=node.getAttribute("data-copy-locale")!==locale});try{localStorage.setItem("niceeval-view-language",locale)}catch{}};const startTrajectory=scope=>{const search=scope.querySelector("[data-trajectory-search]");const events=[...scope.querySelectorAll("[data-trajectory-item]")];const filter=()=>{const query=(search.value||"").trim().toLocaleLowerCase();events.forEach(event=>{event.hidden=query!==""&&!(event.dataset.search||"").toLocaleLowerCase().includes(query)});scope.querySelectorAll("[data-trajectory-turn]").forEach(turn=>{const turnEvents=[...turn.querySelectorAll("[data-trajectory-item]")];turn.hidden=query!==""&&turnEvents.length>0&&turnEvents.every(event=>event.hidden)})};search?.addEventListener("input",filter);scope.querySelector("[data-trajectory-action=turns]")?.addEventListener("click",()=>scope.querySelectorAll("[data-trajectory-turn]").forEach(turn=>{turn.open=false}));scope.querySelector("[data-trajectory-action=tools]")?.addEventListener("click",()=>scope.querySelectorAll("[data-tool-detail]").forEach(detail=>{detail.hidden=true;detail.previousElementSibling?.setAttribute("aria-expanded","false")}));scope.querySelectorAll("[data-tool-toggle]").forEach(button=>button.addEventListener("click",()=>{const detail=button.parentElement?.querySelector("[data-tool-detail]");if(!detail)return;detail.hidden=!detail.hidden;button.setAttribute("aria-expanded",String(!detail.hidden))}))};const startRefresh=initial=>{if(initial.headers.get("x-niceeval-view-refresh")!=="supported")return;const status=document.getElementById("niceeval-update");const button=document.getElementById("niceeval-refresh");let stopped=false;const probe=async()=>{if(stopped)return;try{const response=await fetch(pageUrl,{cache:"no-store",credentials:"same-origin"});if(response.ok&&response.headers.get("x-niceeval-view-stale")==="1"){status.hidden=false;return}}catch{stopped=true;return}setTimeout(probe,500)};button.addEventListener("click",async()=>{button.disabled=true;try{const response=await fetch(pageUrl,{method:"POST",credentials:"same-origin",headers:{"x-niceeval-view-action":"refresh"}});if(!response.ok)throw new Error("refresh failed");location.reload()}catch{button.disabled=false}});setTimeout(probe,500)};fetch(pageUrl,{cache:"no-store",credentials:"same-origin"}).then(async response=>{if(!response.ok)throw new Error("page failed");return {response,page:await response.json()}}).then(({response,page})=>{if(page.format!=="niceeval.view-page/v1"||typeof page.en!=="string"||typeof page["zh-CN"]!=="string")throw new Error("page invalid");english.innerHTML=page.en;chinese.innerHTML=page["zh-CN"];english.removeAttribute("aria-busy");chinese.removeAttribute("aria-busy");document.querySelectorAll("[data-trajectory]").forEach(startTrajectory);select.addEventListener("change",()=>setLanguage(select.value));let preferred;try{preferred=localStorage.getItem("niceeval-view-language")}catch{}setLanguage(preferred??(navigator.language.toLowerCase().startsWith("zh")?"zh-CN":"en"));startRefresh(response)}).catch(()=>{english.removeAttribute("aria-busy");english.textContent="NiceEval view page failed to load"})})()`;
