import type {
  ClosedReportPage,
  ClosedReportTree,
} from "../execution/model.ts";
import {
  staticPathForDownload as staticOutputPathForDownload,
  staticPathForRoute as staticOutputPathForRoute,
  validateDownloadPath,
  validateReportRoute,
} from "../execution/paths.ts";
import type { ReportProblemTableEntry } from "../execution/problems.ts";
import type {
  AnalysisIssue,
  EvidenceRef,
  MetricValue,
} from "../semantic/value.ts";
import {
  closedDownloadPath,
  compareUtf8,
  evidenceRefText,
  localizedText,
  localizedUnknownText,
  metricValue,
  reportClosedValueText,
  reportMetricText,
} from "./presentation.ts";
import {
  basalt,
  themeStylesheet,
  type ThemeDefinition,
} from "./theme.ts";

/** Metadata comes from a fixed view revision, never a Report callback. */
export interface ReportHtmlHostMetadata {
  readonly revision?: number;
  readonly lastRebuildProblem?: string;
}

/**
 * HTML gets a closed tree and one already-selected page. It never receives a
 * Report module, a Sample, a reader, or browser-side data-fetching authority.
 */
export type RenderReportHtmlInput =
  | {
    readonly tree: ClosedReportTree;
    readonly page: ClosedReportPage;
    readonly theme?: ThemeDefinition;
    readonly hostMetadata?: ReportHtmlHostMetadata;
  }
  | {
    readonly tree: ClosedReportTree;
    readonly surface: "problems";
    readonly theme?: ThemeDefinition;
    readonly hostMetadata?: ReportHtmlHostMetadata;
  }
  | {
    readonly tree: ClosedReportTree;
    /** A host-owned index used only when no authored page owns `/`. */
    readonly surface: "index";
    readonly theme?: ThemeDefinition;
    readonly hostMetadata?: ReportHtmlHostMetadata;
  }
  | {
    /** Reserved host surfaces may use a fully escaped text projection. */
    readonly text: string;
    readonly theme?: ThemeDefinition;
    readonly hostMetadata?: ReportHtmlHostMetadata;
  };

/**
 * The sole HTML shell for fixed Report data. All author-controlled values are
 * escaped in their HTML context; there is no raw HTML, script, network, or
 * browser callback escape hatch.
 */
export function renderReportHtml(input: RenderReportHtmlInput): string {
  const theme = input.theme ?? basalt;
  const metadata = renderHostMetadata(input.hostMetadata);
  const page = "page" in input ? input.page : undefined;
  const surface = "surface" in input ? input.surface : undefined;
  const title = "text" in input
    ? "NiceEval report"
    : page === undefined
      ? surface === "problems" ? "NiceEval report problems" : "NiceEval report"
      : localizedText(page.title);
  const content = "text" in input
    ? `<pre class="niceeval-report__text">${escapeHtmlText(input.text)}</pre>`
    : page === undefined
      ? surface === "problems" ? renderProblemsSurface(input.tree) : renderIndexSurface(input.tree)
      : renderPageSurface(input.tree, page);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtmlText(title)}</title>${metadata}<style>${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}</style></head><body><main class="niceeval-report">${content}</main></body></html>`;
}

function renderHostMetadata(metadata: ReportHtmlHostMetadata | undefined): string {
  if (metadata === undefined) return "";
  const revision = typeof metadata.revision === "number" &&
      Number.isSafeInteger(metadata.revision) && metadata.revision >= 0
    ? `<meta name="niceeval-report-revision" content="${metadata.revision}">`
    : "";
  const problem = typeof metadata.lastRebuildProblem === "string"
    ? `<meta name="niceeval-last-rebuild-problem" content="${escapeHtmlAttribute(metadata.lastRebuildProblem)}">`
    : "";
  return `${revision}${problem}`;
}

function renderPageSurface(tree: ClosedReportTree, page: ClosedReportPage): string {
  const route = page.route;
  return `<article class="niceeval-report__document"><nav class="niceeval-report__navigation" aria-label="Report pages">${renderNavigation(tree, route)}</nav><header class="niceeval-report__document-header"><p class="niceeval-report__route">${escapeHtmlText(route)}</p><h1>${escapeHtmlText(localizedText(page.title))}</h1></header>${renderNodeHtml(page.node, tree, route, "web", 2)}${renderPageProblems(tree, page, route)}${renderDownloads(tree, route)}</article>`;
}

function renderProblemsSurface(tree: ClosedReportTree): string {
  const route = "/_niceeval/problems";
  return `<article class="niceeval-report__document"><nav class="niceeval-report__navigation" aria-label="Report pages">${renderNavigation(tree, route)}</nav><header class="niceeval-report__document-header"><h1>Report problems</h1><p>Analysis issues remain visible. Execution problems are shown here and prevent a complete static export.</p></header>${renderProblemList(tree.problemTable, tree, route)}${renderDownloads(tree, route)}</article>`;
}

function renderIndexSurface(tree: ClosedReportTree): string {
  return `<article class="niceeval-report__document"><nav class="niceeval-report__navigation" aria-label="Report pages">${renderNavigation(tree, "/")}</nav><header class="niceeval-report__document-header"><h1>NiceEval report</h1><p>Choose a closed report page. This site remains readable without JavaScript or network access.</p></header>${renderProblemList(tree.problemTable, tree, "/")}${renderDownloads(tree, "/")}</article>`;
}

function renderNavigation(tree: ClosedReportTree, sourceRoute: string): string {
  const pages = [...tree.pages].sort(comparePages);
  const links = pages.map((page) => {
    const label = localizedText(page.title);
    const current = page.route === sourceRoute ? " aria-current=\"page\"" : "";
    return `<li><a href="${escapeHtmlAttribute(reportHref(sourceRoute, { kind: "route", route: page.route }))}"${current}>${escapeHtmlText(label)}</a></li>`;
  });
  const problems = reportHref(sourceRoute, { kind: "problems" });
  return `<ul>${links.join("")}<li><a href="${escapeHtmlAttribute(problems)}">Problems</a></li></ul>`;
}

type RenderFace = "text" | "web";

/** Renders a validated node recursively; unknown nodes become explicit text. */
export function renderNodeHtml(
  value: unknown,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace = "web",
  headingLevel = 2,
): string {
  const node = dataRecord(value);
  if (node === undefined || typeof node.type !== "string") {
    return unsupportedNodeHtml("unsupported Report node");
  }
  switch (node.type) {
    case "text":
      return `<p class="niceeval-report__paragraph">${escapeHtmlText(stringValue(node.value))}</p>`;
    case "stack":
      return `<section class="niceeval-report__stack">${renderChildrenHtml(node.children, tree, route, face, headingLevel)}</section>`;
    case "grid":
      return `<section class="niceeval-report__grid">${renderChildrenHtml(node.children, tree, route, face, headingLevel)}</section>`;
    case "callout":
      return renderCalloutHtml(node, tree, route, face, headingLevel);
    case "table":
      return renderTableHtml(node, tree, route);
    case "bars":
    case "line":
    case "scatter":
      return renderChartHtml(node, tree, route);
    case "stat":
      return renderStatHtml(node, tree, route);
    case "download":
      return renderDownloadHtml(node, tree, route, face, headingLevel);
    case "primitive":
      return renderNodeHtml(face === "text" ? node.text : node.web, tree, route, face, headingLevel);
    default:
      return unsupportedNodeHtml(`unsupported Report node: ${node.type}`);
  }
}

function renderChildrenHtml(
  value: unknown,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
): string {
  if (!Array.isArray(value)) return unsupportedNodeHtml("unsupported Report children");
  return value.map((child) => renderNodeHtml(child, tree, route, face, headingLevel + 1)).join("");
}

function renderCalloutHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
): string {
  const tone = knownTone(node.tone);
  const title = node.title === undefined ? "" : `<h${Math.min(headingLevel, 6)}>${escapeHtmlText(localizedUnknownText(node.title))}</h${Math.min(headingLevel, 6)}>`;
  return `<section class="niceeval-report__callout niceeval-report__callout--${tone}" data-tone="${tone}" role="status">${title}${renderChildrenHtml(node.children, tree, route, face, headingLevel + 1)}</section>`;
}

function renderTableHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
): string {
  const columns = tableColumns(node.columns);
  const caption = node.caption === undefined ? "" : `<caption>${escapeHtmlText(localizedUnknownText(node.caption))}</caption>`;
  if (columns.length === 0 || !Array.isArray(node.rows)) {
    return `${unsupportedNodeHtml("unsupported table shape")}${renderRowsIssuesHtml(node.issues, tree, route)}`;
  }
  const header = columns.map((column) =>
    `<th scope="col" class="niceeval-report__align-${column.align}">${escapeHtmlText(column.label)}</th>`
  ).join("");
  const body = node.rows.map((row) => {
    const record = dataRecord(row);
    if (record === undefined) {
      return `<tr><td colspan="${columns.length}">Unsupported table row</td></tr>`;
    }
    return `<tr>${columns.map((column) =>
      `<td class="niceeval-report__align-${column.align}">${renderCellHtml(record[column.key], tree, route)}</td>`
    ).join("")}</tr>`;
  }).join("");
  return `<section class="niceeval-report__table-section"><div class="niceeval-report__table-wrap"><table class="niceeval-report__table">${caption}<thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>${renderRowsIssuesHtml(node.issues, tree, route)}</section>`;
}

function renderChartHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
): string {
  const kind = node.type === "bars" ? "Bars" : node.type === "line" ? "Line" : "Scatter";
  const title = node.title === undefined ? kind : localizedUnknownText(node.title);
  const points = Array.isArray(node.points) ? node.points : [];
  const channels = [node.x, node.y, node.color, node.series]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const fields = orderedPointFields(points, channels);
  if (fields.length === 0) {
    return `<figure class="niceeval-report__chart" data-chart="${kind.toLowerCase()}"><figcaption>${escapeHtmlText(title)} (${kind})</figcaption>${unsupportedNodeHtml("chart has no text-equivalent points")}${renderRowsIssuesHtml(node.issues, tree, route)}</figure>`;
  }
  const header = fields.map((field) => `<th scope="col">${escapeHtmlText(field)}</th>`).join("");
  const body = points.map((point) => {
    const record = dataRecord(point);
    if (record === undefined) return `<tr><td colspan="${fields.length}">Unsupported chart point</td></tr>`;
    return `<tr>${fields.map((field) => `<td>${renderCellHtml(record[field], tree, route)}</td>`).join("")}</tr>`;
  }).join("");
  return `<figure class="niceeval-report__chart niceeval-report__chart--${kind.toLowerCase()}" data-chart="${kind.toLowerCase()}"><figcaption>${escapeHtmlText(title)} <span class="niceeval-report__chart-kind">${kind} text equivalent</span></figcaption><div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>${renderRowsIssuesHtml(node.issues, tree, route)}</figure>`;
}

function renderStatHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
): string {
  const label = localizedUnknownText(node.label);
  const metric = metricValue(node.value);
  if (metric === undefined) return unsupportedNodeHtml(`${label}: unsupported metric`);
  const value = metric.value === null ? "—" : String(metric.value);
  const unit = metric.unit === undefined ? "" : ` <span class="niceeval-report__metric-unit">${escapeHtmlText(metric.unit)}</span>`;
  return `<dl class="niceeval-report__metric"><div><dt>${escapeHtmlText(label)}</dt><dd><data value="${escapeHtmlAttribute(value)}">${escapeHtmlText(value)}</data>${unit}</dd><dd class="niceeval-report__metric-details">${escapeHtmlText(reportMetricText(metric))}${renderMetricDetailsHtml(metric, tree, route)}</dd></div></dl>`;
}

function renderDownloadHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
): string {
  const id = typeof node.id === "string" ? node.id : undefined;
  const download = id === undefined ? undefined : tree.downloads.find((candidate) => candidate.id === id);
  if (download === undefined) return unsupportedNodeHtml("closed Download target is unavailable");
  const path = closedDownloadPath(download);
  const href = reportHref(route, { kind: "download", path });
  const label = `Download ${path} (${download.mediaType}, ${download.bytes.byteLength} bytes)`;
  return `<section class="niceeval-report__download"><a href="${escapeHtmlAttribute(href)}" download>${escapeHtmlText(label)}</a>${renderChildrenHtml(node.children, tree, route, face, headingLevel + 1)}</section>`;
}

function renderCellHtml(value: unknown, tree: ClosedReportTree, route: string): string {
  const metric = metricValue(value);
  if (metric === undefined) return `<span class="niceeval-report__scalar">${escapeHtmlText(reportClosedValueText(value))}</span>`;
  const numeric = metric.value === null ? "—" : String(metric.value);
  const unit = metric.unit === undefined ? "" : ` <span class="niceeval-report__metric-unit">${escapeHtmlText(metric.unit)}</span>`;
  return `<span class="niceeval-report__metric-value"><data value="${escapeHtmlAttribute(numeric)}">${escapeHtmlText(numeric)}</data>${unit}<span class="niceeval-report__metric-meta">${escapeHtmlText(`${metric.samples} / ${metric.total} ${metric.basis} · ${metric.state}`)}</span>${renderMetricDetailsHtml(metric, tree, route)}</span>`;
}

function renderMetricDetailsHtml(metric: MetricValue, tree: ClosedReportTree, route: string): string {
  const issues = metric.issues.length === 0
    ? ""
    : `<ul class="niceeval-report__issues" aria-label="Metric issues">${metric.issues.map((issue) => `<li>${renderIssueHtml(issue, tree, route)}</li>`).join("")}</ul>`;
  const refs = metric.refs.length === 0
    ? ""
    : `<ul class="niceeval-report__evidence" aria-label="Evidence">${metric.refs.map((reference) => `<li>${renderEvidenceRefHtml(reference, tree, route)}</li>`).join("")}</ul>`;
  return `${issues}${refs}`;
}

function renderRowsIssuesHtml(value: unknown, tree: ClosedReportTree, route: string): string {
  const issues = rowsIssues(value);
  if (issues.length === 0) return "";
  return `<aside class="niceeval-report__row-issues" aria-label="Rows issues"><h2>Rows issues</h2><ul>${issues.map((issue) => `<li>${renderIssueHtml(issue, tree, route)}</li>`).join("")}</ul></aside>`;
}

function renderIssueHtml(issue: AnalysisIssue, tree: ClosedReportTree, route: string): string {
  const refs = issue.refs.length === 0
    ? ""
    : ` <span class="niceeval-report__issue-refs">${issue.refs.map((reference) => renderEvidenceRefHtml(reference, tree, route)).join(", ")}</span>`;
  return `<strong>${escapeHtmlText(issue.code)}</strong>: ${escapeHtmlText(issue.message)}${refs}`;
}

/** Evidence can navigate only to an already closed page; no renderer opens it. */
function renderEvidenceRefHtml(reference: EvidenceRef, tree: ClosedReportTree, sourceRoute: string): string {
  const label = evidenceRefText(reference);
  const target = evidencePageRoute(reference, tree);
  if (target === undefined) return `<code class="niceeval-report__evidence-id">${escapeHtmlText(label)}</code>`;
  return `<a class="niceeval-report__evidence-link" href="${escapeHtmlAttribute(reportHref(sourceRoute, { kind: "route", route: target }))}">Evidence ${escapeHtmlText(label)}</a>`;
}

function evidencePageRoute(reference: EvidenceRef, tree: ClosedReportTree): string | undefined {
  const identity = dataRecord(reference.identity);
  const direct = typeof reference.identity === "string" ? reference.identity : identity?.route;
  if (typeof direct === "string" && tree.pages.some((page) => page.route === direct)) return direct;
  const id = identity?.id;
  if (typeof id !== "string" || id.length === 0) return undefined;
  const encoded = encodeURIComponent(id);
  return tree.pages.find((page) => page.route.endsWith(`/${encoded}`) || page.route.endsWith(`/${id}`))?.route;
}

function renderPageProblems(tree: ClosedReportTree, page: ClosedReportPage, route: string): string {
  const ids = new Set(page.problemIds.map(Number));
  const entries = tree.problemTable.filter((entry) => ids.has(Number(entry.id)));
  if (entries.length === 0) return "";
  return `<aside class="niceeval-report__page-problems" aria-label="Page problems"><h2>Page problems</h2>${renderProblemList(entries, tree, route)}</aside>`;
}

function renderDownloads(tree: ClosedReportTree, sourceRoute: string): string {
  if (tree.downloads.length === 0) return "";
  const downloads = [...tree.downloads]
    .sort((left, right) => compareUtf8(closedDownloadPath(left), closedDownloadPath(right)) || compareUtf8(left.id, right.id))
    .map((download) => {
      const path = closedDownloadPath(download);
      const href = reportHref(sourceRoute, { kind: "download", path });
      const label = `${path} (${download.mediaType}, ${download.bytes.byteLength} bytes)`;
      return `<li><a href="${escapeHtmlAttribute(href)}" download>${escapeHtmlText(label)}</a></li>`;
    })
    .join("");
  return `<aside class="niceeval-report__downloads" aria-label="Downloads"><h2>Downloads</h2><ul>${downloads}</ul></aside>`;
}

function renderProblemList(
  entries: readonly ReportProblemTableEntry[],
  tree: ClosedReportTree,
  route: string,
): string {
  if (entries.length === 0) return `<p class="niceeval-report__no-problems">No problems.</p>`;
  return `<ol class="niceeval-report__problems">${[...entries]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((entry) => `<li id="problem-${Number(entry.id)}"><code>#${Number(entry.id)}</code> ${renderProblemHtml(entry)}</li>`)
    .join("")}</ol>`;
}

function renderProblemHtml(entry: ReportProblemTableEntry): string {
  return `<strong>${escapeHtmlText(entry.code)}</strong>: ${escapeHtmlText(entry.summary)}`;
}

type LinkTarget =
  | { readonly kind: "route"; readonly route: string }
  | { readonly kind: "download"; readonly path: string }
  | { readonly kind: "problems" };

/** Uses the static output codec for both file:// exports and the live server. */
export function reportHref(sourceRoute: string, target: LinkTarget): string {
  const source = staticPathForRoute(sourceRoute);
  if (source === undefined) return "#";
  const fromDirectory = source.slice(0, -1);
  const targetPath = target.kind === "route"
    ? staticPathForRoute(target.route)
    : target.kind === "download"
      ? staticPathForDownload(target.path)
      : ["_niceeval", "problems", "index.html"];
  if (targetPath === undefined) return "#";
  return relativePath(fromDirectory, targetPath);
}

/** The static exporter also uses this mapping during its complete preflight. */
export function staticPathForRoute(route: string): readonly string[] | undefined {
  if (validateReportRoute(route) !== undefined) return undefined;
  return staticOutputPathForRoute(route).segments;
}

/** Download paths share the output collision set but always live below downloads/. */
export function staticPathForDownload(path: string): readonly string[] | undefined {
  if (validateDownloadPath(path) !== undefined) return undefined;
  return staticOutputPathForDownload(path).segments;
}

function relativePath(fromDirectory: readonly string[], target: readonly string[]): string {
  let shared = 0;
  while (shared < fromDirectory.length && shared < target.length && fromDirectory[shared] === target[shared]) {
    shared += 1;
  }
  return [
    ...fromDirectory.slice(shared).map(() => ".."),
    ...target.slice(shared),
  ].join("/");
}

function tableColumns(value: unknown): readonly { readonly key: string; readonly label: string; readonly align: "start" | "end" }[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const columns: Array<{ readonly key: string; readonly label: string; readonly align: "start" | "end" }> = [];
  for (const candidate of value) {
    const record = dataRecord(candidate);
    if (record === undefined || typeof record.key !== "string" || record.key.length === 0) continue;
    columns.push(Object.freeze({
      key: record.key,
      label: localizedUnknownText(record.label),
      align: record.align === "end" ? "end" : "start",
    }));
  }
  return Object.freeze(columns);
}

function orderedPointFields(points: readonly unknown[], preferred: readonly string[]): readonly string[] {
  const fields = new Set<string>(preferred);
  for (const point of points) {
    const record = dataRecord(point);
    if (record === undefined) continue;
    for (const key of Object.keys(record)) fields.add(key);
  }
  return Object.freeze([
    ...preferred,
    ...[...fields].filter((field) => !preferred.includes(field)).sort(compareUtf8),
  ]);
}

function rowsIssues(value: unknown): readonly AnalysisIssue[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter(isAnalysisIssue));
}

function isAnalysisIssue(value: unknown): value is AnalysisIssue {
  const record = dataRecord(value);
  return record !== undefined && typeof record.code === "string" && typeof record.message === "string" && Array.isArray(record.refs);
}

function comparePages(left: ClosedReportPage, right: ClosedReportPage): number {
  return compareUtf8(left.route, right.route) || compareUtf8(left.pageId, right.pageId);
}

function knownTone(value: unknown): string {
  return value === "positive" || value === "warning" || value === "negative" ? value : "neutral";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "[unsupported text]";
}

function unsupportedNodeHtml(message: string): string {
  return `<aside class="niceeval-report__unsupported" role="note">${escapeHtmlText(message)}</aside>`;
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Uint8Array) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Text-node escaping. */
export function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Attribute escaping additionally closes every quoted-attribute delimiter. */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;");
}

const REPORT_HTML_STYLESHEET = `
html { min-height: 100%; background: var(--niceeval-color-page, #050505); }
body { min-height: 100vh; margin: 0; background: var(--niceeval-color-page, #050505); color: var(--niceeval-color-text, #ededed); }
.niceeval-report, .niceeval-report * { box-sizing: border-box; }
.niceeval-report { min-height: 100vh; padding: clamp(2rem, 6vw, 6rem) clamp(1rem, 5vw, 5rem); color: var(--niceeval-color-text, #ededed); font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif); font-size: var(--niceeval-font-size, 13px); line-height: 1.6; overflow-wrap: anywhere; }
.niceeval-report__document, .niceeval-report__text { display: block; width: min(100%, 72rem); margin: 0 auto; }
.niceeval-report__text { max-width: 96ch; white-space: pre-wrap; font-family: var(--niceeval-font-mono, ui-monospace, monospace); }
.niceeval-report__navigation { margin-bottom: 2rem; }
.niceeval-report__navigation ul { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin: 0; padding: 0; list-style: none; }
.niceeval-report__navigation a { color: var(--niceeval-color-accent, #cbd6dc); text-underline-offset: .16em; }
.niceeval-report__document-header { max-width: 72ch; padding-bottom: clamp(2rem, 6vw, 4rem); }
.niceeval-report__route { margin: 0 0 .5rem; color: var(--niceeval-color-text-secondary, #a1a1aa); font-family: var(--niceeval-font-mono, ui-monospace, monospace); }
.niceeval-report h1, .niceeval-report h2, .niceeval-report h3, .niceeval-report h4, .niceeval-report h5, .niceeval-report h6 { margin: 0; color: var(--niceeval-color-text, #ededed); line-height: 1.15; }
.niceeval-report h1 { font-size: clamp(2rem, 5vw, 3.5rem); }
.niceeval-report h2 { margin-top: 2rem; font-size: 1.25rem; }
.niceeval-report__paragraph { max-width: 72ch; margin: 1rem 0; white-space: pre-wrap; }
.niceeval-report__stack > * + * { margin-top: 1rem; }
.niceeval-report__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 1.5rem; align-items: start; }
.niceeval-report__callout { margin: 1.5rem 0; padding: 1rem; border-left: 3px solid var(--niceeval-color-border-strong, #343434); background: var(--niceeval-color-surface-subtle, #111); }
.niceeval-report__callout--positive { border-left-color: var(--niceeval-color-positive, #3ddc97); }
.niceeval-report__callout--warning { border-left-color: var(--niceeval-color-warning, #e8b84a); }
.niceeval-report__callout--negative { border-left-color: var(--niceeval-color-negative, #ff6b6b); }
.niceeval-report__table-wrap { width: 100%; overflow-x: auto; }
.niceeval-report__table { width: 100%; min-width: 32rem; border-collapse: collapse; border-top: 1px solid var(--niceeval-color-border-strong, #343434); }
.niceeval-report__table caption { padding-bottom: .75rem; color: var(--niceeval-color-text-secondary, #a1a1aa); font-weight: 600; text-align: left; }
.niceeval-report__table th, .niceeval-report__table td { padding: .8rem .75rem; border-bottom: 1px solid var(--niceeval-color-border, #262626); vertical-align: top; text-align: start; }
.niceeval-report__table th { font-weight: 600; }
.niceeval-report__align-end { text-align: end !important; font-variant-numeric: tabular-nums; }
.niceeval-report__metric { margin: 0 0 1.5rem; }
.niceeval-report__metric dt { color: var(--niceeval-color-text-secondary, #a1a1aa); }
.niceeval-report__metric dd { margin: .35rem 0 0; font-variant-numeric: tabular-nums; }
.niceeval-report__metric-value { display: grid; gap: .25rem; }
.niceeval-report__metric-meta, .niceeval-report__metric-details, .niceeval-report__metric-unit, .niceeval-report__chart-kind { color: var(--niceeval-color-text-secondary, #a1a1aa); font-size: .88em; }
.niceeval-report__download { margin: 1.5rem 0; padding: .75rem 1rem; border-left: 3px solid var(--niceeval-color-accent, #cbd6dc); background: var(--niceeval-color-surface-subtle, #111); }
.niceeval-report__download > a { color: var(--niceeval-color-accent, #cbd6dc); font-weight: 600; }
.niceeval-report__issues, .niceeval-report__evidence { margin: .5rem 0 0; padding-inline-start: 1.25rem; }
.niceeval-report__issues { color: var(--niceeval-color-warning, #e8b84a); }
.niceeval-report__evidence-id { font-family: var(--niceeval-font-mono, ui-monospace, monospace); }
.niceeval-report__chart { margin: 1.5rem 0 2.5rem; }
.niceeval-report__chart figcaption { margin-bottom: .75rem; font-weight: 600; }
.niceeval-report__row-issues, .niceeval-report__page-problems, .niceeval-report__downloads, .niceeval-report__unsupported { margin: 1rem 0; padding: .75rem 1rem; border: 1px solid var(--niceeval-color-border, #262626); }
.niceeval-report__unsupported { color: var(--niceeval-color-warning, #e8b84a); }
.niceeval-report__problems { padding-inline-start: 1.5rem; }
.niceeval-report__problems li + li { margin-top: .75rem; }
@media (max-width: 44rem) { .niceeval-report { padding: 2rem 1rem 4rem; } .niceeval-report__table { min-width: 28rem; } }
`;
