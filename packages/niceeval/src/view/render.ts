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
  return `${renderAttempt(attempt.detail, locale, context, attempt.locator)}${renderTrace(attempt.trace, attempt.locator, locale)}${renderDiff(attempt.diff, attempt.locator, locale)}`;
}

function renderRevisionDelivery(graph: ViewGraph, locale: ViewLocale): string {
  const { candidateRuns, deliveredRuns, discoveredAttempts, deliveredAttempts } = graph.delivery;
  const truncated = deliveredRuns < candidateRuns || deliveredAttempts < discoveredAttempts;
  const followUp = truncated
    ? locale === "en"
      ? " <strong>truncated</strong> at the stated boundary; continue with <code>niceeval view --run &lt;run-id&gt;</code> or <code>niceeval view @&lt;attempt-locator&gt;</code> using the visible identity."
      : " 已在所示边界标记为 <strong>truncated</strong>；请使用可见身份通过 <code>niceeval view --run &lt;run-id&gt;</code> 或 <code>niceeval view @&lt;attempt-locator&gt;</code> 继续。"
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

function renderTrace(document: InspectionDocument, locator: string, locale: ViewLocale): string {
  const trace = objectField(document, "trace");
  const conversation = objectValue(trace?.conversation);
  const items = Array.isArray(conversation?.items) ? conversation.items : [];
  const rows = items.map((candidate) => {
    const item = objectValue(candidate);
    return `<tr><td>${html(item?.kind)}</td><td>${html(item?.role ?? item?.tool)}</td><td>${html(item?.outcome ?? item?.text ?? item?.output)}</td></tr>`;
  }).join("");
  return `<section><h2>${locale === "en" ? "Trace" : "轨迹"} <code>${html(locator)}</code></h2>${items.length === 0 ? `<p class="empty">${locale === "en" ? "No bounded trace items were delivered." : "未交付有界轨迹条目。"}</p>` : `<table><thead><tr><th>${locale === "en" ? "Kind" : "类型"}</th><th>${locale === "en" ? "Actor / tool" : "角色 / 工具"}</th><th>${locale === "en" ? "Result" : "结果"}</th></tr></thead><tbody>${rows}</tbody></table>`}${renderIssuesEvidence(document, locale, locale === "en" ? "Trace" : "轨迹")}</section>`;
}

function renderDiff(document: InspectionDocument, locator: string, locale: ViewLocale): string {
  const diff = objectField(document, "diff");
  const state = typeof diff?.state === "string" ? diff.state : "unavailable";
  const collection = objectValue(diff?.collection);
  const items = Array.isArray(collection?.items) ? collection.items : [];
  const boundary = collection?.hasMore === true
    ? ` · <strong>truncated</strong> — ${locale === "en" ? "more remain outside the fixed Inspection page; continue with the fixed attempt.diff machine operation and retain hasMore." : "固定 Inspection 页面之外仍有条目；请继续使用固定的 attempt.diff machine operation，并保留 hasMore。"}`
    : "";
  return `<section><h2>${locale === "en" ? "Diff" : "差异"} <code>${html(locator)}</code></h2><p><strong>${html(state)}</strong></p><p>${locale === "en" ? "Bounded file-change items" : "有界文件变更条目"}: ${items.length}${boundary}</p>${renderIssuesEvidence(document, locale, locale === "en" ? "Diff" : "差异")}</section>`;
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
function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined; }
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

const VIEW_STYLE = `body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:90rem;padding:2rem;color:#172033;background:#fff}header,.page-nav,.language-nav,.section-nav{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}header{justify-content:space-between}.page-nav,.language-nav{justify-content:flex-end}.section-nav{margin:1rem 0}h1{font-size:1.7rem;margin-bottom:.25rem}h2{font-size:1.2rem;margin-top:2rem}h3{font-size:1rem;margin:1.25rem 0 .4rem}p.lead{color:#526078;margin-top:0}.delivery-limit{border-left:3px solid #98a2b3;padding-left:.75rem;color:#526078}.metrics,.comparison{display:flex;gap:1rem;flex-wrap:wrap}.metric,.comparison-side{background:#f4f6fa;border:1px solid #d9deea;border-radius:.5rem;padding:.7rem 1rem}.metric strong{display:block;font-size:1.25rem}table{border-collapse:collapse;width:100%;display:block;overflow:auto}th,td{border-bottom:1px solid #d9deea;padding:.6rem;text-align:left;vertical-align:top}th{color:#526078;font-size:.85rem}code{font-size:.9em}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto}.passed{color:#067647;font-weight:700}.failed,.errored{color:#b42318;font-weight:700}.assertion{border-left:3px solid #d9deea;padding:.1rem 0 .5rem 1rem;margin:1rem 0}.assertion dl,.facts{display:grid;grid-template-columns:max-content 1fr;gap:.25rem .75rem}.assertion dt,.facts dt{color:#526078}.assertion dd,.facts dd{margin:0}aside{position:sticky;top:1rem;background:#fff8d8;border:1px solid #e0bd42;border-radius:.5rem;padding:.75rem;margin-bottom:1rem}button,select{font:inherit}.empty{color:#667085;font-style:italic}`;

const VIEW_SCRIPT = `(()=>{const root=document.documentElement;const pageUrl=root.dataset.viewPage;const english=document.querySelector('[data-insight-locale="en"]');const chinese=document.querySelector('[data-insight-locale="zh-CN"]');const select=document.getElementById("niceeval-language");const setLanguage=language=>{const locale=language==="zh-CN"?"zh-CN":"en";root.lang=locale;select.value=locale;document.querySelectorAll("[data-insight-locale]").forEach(node=>{node.hidden=node.getAttribute("data-insight-locale")!==locale});document.querySelectorAll("[data-copy-locale]").forEach(node=>{node.hidden=node.getAttribute("data-copy-locale")!==locale});try{localStorage.setItem("niceeval-view-language",locale)}catch{}};const startRefresh=initial=>{if(initial.headers.get("x-niceeval-view-refresh")!=="supported")return;const status=document.getElementById("niceeval-update");const button=document.getElementById("niceeval-refresh");let stopped=false;const probe=async()=>{if(stopped)return;try{const response=await fetch(pageUrl,{cache:"no-store",credentials:"same-origin"});if(response.ok&&response.headers.get("x-niceeval-view-stale")==="1"){status.hidden=false;return}}catch{stopped=true;return}setTimeout(probe,500)};button.addEventListener("click",async()=>{button.disabled=true;try{const response=await fetch(pageUrl,{method:"POST",credentials:"same-origin",headers:{"x-niceeval-view-action":"refresh"}});if(!response.ok)throw new Error("refresh failed");location.reload()}catch{button.disabled=false}});setTimeout(probe,500)};fetch(pageUrl,{cache:"no-store",credentials:"same-origin"}).then(async response=>{if(!response.ok)throw new Error("page failed");return {response,page:await response.json()}}).then(({response,page})=>{if(page.format!=="niceeval.view-page/v1"||typeof page.en!=="string"||typeof page["zh-CN"]!=="string")throw new Error("page invalid");english.innerHTML=page.en;chinese.innerHTML=page["zh-CN"];english.removeAttribute("aria-busy");chinese.removeAttribute("aria-busy");select.addEventListener("change",()=>setLanguage(select.value));let preferred;try{preferred=localStorage.getItem("niceeval-view-language")}catch{}setLanguage(preferred??(navigator.language.toLowerCase().startsWith("zh")?"zh-CN":"en"));startRefresh(response)}).catch(()=>{english.removeAttribute("aria-busy");english.textContent="NiceEval view page failed to load"})})()`;
