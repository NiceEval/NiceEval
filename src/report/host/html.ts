import {
  isReportDownloadPath,
  isReportRoute,
  staticPathForReportDownload,
  staticPathForReportRoute,
  type ReportRoute,
} from "../author/identity.ts";
import type {
  ReportBlock,
  ReportDocument,
  ReportInline,
  ReportScalar,
} from "../semantic/document.ts";
import {
  basalt,
  themeStylesheet,
  type ThemeDefinition,
} from "./theme.ts";

export type RenderReportHtmlInput =
  | {
    readonly document: ReportDocument;
    /** The rendered document's semantic route, used for package-owned links. */
    readonly route: ReportRoute;
    /** Fixed host facts are metadata, never author-page body content. */
    readonly hostMetadata?: ReportHtmlHostMetadata;
    /** Omission deliberately means the host's closed Basalt default. */
    readonly theme?: ThemeDefinition;
  }
  | {
    /** Reserved host surfaces may use a safe text projection. */
    readonly text: string;
    /** Omission deliberately means the host's closed Basalt default. */
    readonly theme?: ThemeDefinition;
  };

export interface ReportHtmlHostMetadata {
  readonly revision?: number;
  readonly lastRebuildProblem?: string;
}

type ReportLinkTarget = Extract<ReportInline, { readonly type: "link" }>["target"];

/**
 * The sole HTML shell for a fixed Report projection. Author pages render the
 * validated closed semantic tree; reserved host surfaces retain a text-only
 * escape hatch. The stylesheet structure and every emitted element are
 * package-owned, while a Theme contributes only validated token values.
 */
export function renderReportHtml(input: RenderReportHtmlInput): string {
  const theme = input.theme ?? basalt;
  const semantic = "document" in input;
  const title = semantic ? input.document.title : "NiceEval report";
  const metadata = semantic ? renderHostMetadata(input.hostMetadata) : "";
  const content = semantic
    ? renderDocument(input.document, input.route)
    : `<pre class="niceeval-report__text">${escapeHtml(input.text)}</pre>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${metadata}<style>${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}</style></head><body><main class="niceeval-report">${content}</main></body></html>`;
}

function renderHostMetadata(metadata: ReportHtmlHostMetadata | undefined): string {
  if (metadata === undefined) return "";
  const revisionValue = metadata.revision;
  const revision = typeof revisionValue === "number" &&
      Number.isSafeInteger(revisionValue) &&
      revisionValue >= 0
    ? `<meta name="niceeval-report-revision" content="${revisionValue}">`
    : "";
  const problem = typeof metadata.lastRebuildProblem === "string"
    ? `<meta name="niceeval-last-rebuild-problem" content="${escapeHtml(metadata.lastRebuildProblem)}">`
    : "";
  return `${revision}${problem}`;
}

function renderDocument(document: ReportDocument, route: ReportRoute): string {
  return `<article class="niceeval-report__document"><header class="niceeval-report__document-header"><h1>${escapeHtml(document.title)}</h1></header>${document.children.map((block) => renderBlock(block, route, 2)).join("")}</article>`;
}

function renderBlock(block: ReportBlock, route: ReportRoute, headingLevel: number): string {
  switch (block.type) {
    case "section": {
      const level = Math.min(headingLevel, 6);
      return `<section class="niceeval-report__section"><h${level}>${escapeHtml(block.heading)}</h${level}>${block.children.map((child) => renderBlock(child, route, level + 1)).join("")}</section>`;
    }
    case "paragraph":
      return `<p class="niceeval-report__paragraph">${renderInlines(block.children, route)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag} class="niceeval-report__list">${block.items.map((item) => `<li>${item.map((child) => renderBlock(child, route, headingLevel)).join("")}</li>`).join("")}</${tag}>`;
    }
    case "table":
      return `<div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><caption>${escapeHtml(block.caption)}</caption><thead><tr>${block.columns.map((column) => `<th scope="col" class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${block.columns.map((column) => `<td class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(scalarText(row[column.key]!))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "metric": {
      const value = scalarText(block.value);
      return `<dl class="niceeval-report__metric"><div><dt>${escapeHtml(block.label)}</dt><dd><data value="${escapeHtml(value)}">${escapeHtml(value)}</data>${block.unit === undefined ? "" : ` <span class="niceeval-report__metric-unit">${escapeHtml(block.unit)}</span>`}</dd></div></dl>`;
    }
    case "status": {
      const tone = statusTone(block.tone);
      return `<p class="niceeval-report__status niceeval-report__status--${tone}" data-tone="${tone}" role="status"><strong>${escapeHtml(block.label)}</strong>${block.detail === undefined ? "" : ` <span class="niceeval-report__status-detail">${renderInlines(block.detail, route)}</span>`}</p>`;
    }
    case "code-block":
      return `<pre class="niceeval-report__code-block"><code${block.language === undefined ? "" : ` data-language="${escapeHtml(block.language)}"`}>${escapeHtml(block.value)}</code></pre>`;
    case "chart":
      return renderChart(block);
  }
}

function renderChart(block: Extract<ReportBlock, { readonly type: "chart" }>): string {
  const chart = block.chart === "line" ? "line" : "bar";
  return `<figure class="niceeval-report__chart niceeval-report__chart--${chart}" data-chart="${chart}"><figcaption>${escapeHtml(block.title)}<span class="niceeval-report__chart-category">${escapeHtml(block.categoryLabel)}</span></figcaption><div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><thead><tr><th scope="col">${escapeHtml(block.categoryLabel)}</th>${block.series.map((series) => `<th scope="col" class="niceeval-report__align-end">${escapeHtml(series.label)}</th>`).join("")}</tr></thead><tbody>${block.categories.map((category, categoryIndex) => `<tr><th scope="row">${escapeHtml(category)}</th>${block.series.map((series) => `<td class="niceeval-report__align-end">${escapeHtml(scalarText(series.values[categoryIndex] ?? null))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></figure>`;
}

function renderInlines(children: readonly ReportInline[], route: ReportRoute): string {
  return children.map((child) => {
    switch (child.type) {
      case "text":
        return escapeHtml(child.value);
      case "code":
        return `<code class="niceeval-report__inline-code">${escapeHtml(child.value)}</code>`;
      case "emphasis":
        return `<em>${renderInlines(child.children, route)}</em>`;
      case "link":
        return `<a href="${escapeHtml(reportHref(route, child.target))}">${renderInlines(child.label, route)}</a>`;
    }
  }).join("");
}

/**
 * Link targets always use the static site's output-file codec. A live server
 * serves the same explicit `index.html` paths, so a nested document has one
 * relative href that works identically over HTTP and from a `file://` export.
 */
function reportHref(sourceRoute: ReportRoute, target: ReportLinkTarget): string {
  if (!isReportRoute(sourceRoute)) return "#";
  const sourceDirectory = staticPathForReportRoute(sourceRoute).segments.slice(0, -1);
  if (target.kind === "route") {
    if (!isReportRoute(target.route)) return "#";
    return relativePath(sourceDirectory, staticPathForReportRoute(target.route).segments);
  }
  if (!isReportDownloadPath(target.path)) return "#";
  return relativePath(sourceDirectory, staticPathForReportDownload(target.path).segments);
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

function scalarText(value: ReportScalar): string {
  return value === null ? "—" : String(value);
}

function statusTone(value: string): "neutral" | "positive" | "warning" | "negative" {
  switch (value) {
    case "positive":
    case "warning":
    case "negative":
      return value;
    default:
      return "neutral";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const REPORT_HTML_STYLESHEET = `
html {
  min-height: 100%;
  background: var(--niceeval-color-page, #050505);
}

body {
  min-height: 100vh;
  margin: 0;
  background: var(--niceeval-color-page, #050505);
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report,
.niceeval-report * {
  box-sizing: border-box;
}

.niceeval-report {
  min-height: 100vh;
  padding: clamp(2rem, 6vw, 6rem) clamp(1rem, 5vw, 5rem);
  background: var(--niceeval-color-page, #050505);
  color: var(--niceeval-color-text, #ededed);
  font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: var(--niceeval-font-size, 13px);
  line-height: 1.6;
}

.niceeval-report__document,
.niceeval-report__text {
  display: block;
  width: min(100%, 72rem);
  margin: 0 auto;
  overflow-wrap: anywhere;
}

.niceeval-report__text {
  max-width: 96ch;
  padding-block: 1rem;
  white-space: pre-wrap;
  font-family: var(--niceeval-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.niceeval-report__document-header {
  max-width: 72ch;
  padding: 0 0 clamp(2.5rem, 6vw, 5rem);
}

.niceeval-report h1,
.niceeval-report h2,
.niceeval-report h3,
.niceeval-report h4,
.niceeval-report h5,
.niceeval-report h6 {
  margin: 0;
  color: var(--niceeval-color-text, #ededed);
  font-weight: 600;
  line-height: 1.1;
}

.niceeval-report h1 {
  max-width: 18ch;
  font-size: clamp(2rem, 5vw, 3.5rem);
  letter-spacing: -0.02em;
}

.niceeval-report h2 {
  max-width: 30ch;
  font-size: clamp(1.5rem, 3vw, 2rem);
}

.niceeval-report h3 {
  font-size: 1.25rem;
}

.niceeval-report h4,
.niceeval-report h5,
.niceeval-report h6 {
  font-size: 1rem;
}

.niceeval-report__section {
  margin-top: clamp(3.5rem, 8vw, 6.5rem);
}

.niceeval-report__section .niceeval-report__section {
  margin-top: clamp(2rem, 5vw, 3.5rem);
}

.niceeval-report__section > :is(h1, h2, h3, h4, h5, h6) + * {
  margin-top: 1.25rem;
}

.niceeval-report__paragraph,
.niceeval-report__list {
  max-width: 68ch;
}

.niceeval-report__paragraph {
  margin: 1rem 0;
}

.niceeval-report__list {
  margin: 1rem 0;
  padding-inline-start: 1.5rem;
}

.niceeval-report__list > li + li {
  margin-top: 0.6rem;
}

.niceeval-report__list > li > *:first-child {
  margin-top: 0;
}

.niceeval-report a {
  color: var(--niceeval-color-accent, #cbd6dc);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}

.niceeval-report a:focus-visible {
  outline: 2px solid var(--niceeval-color-focus, #cbd6dc);
  outline-offset: 3px;
}

.niceeval-report__inline-code,
.niceeval-report__code-block {
  font-family: var(--niceeval-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.niceeval-report__inline-code {
  padding: 0.1em 0.3em;
  background: var(--niceeval-color-surface-subtle, #111111);
  border-radius: var(--niceeval-radius, 0);
}

.niceeval-report__code-block {
  margin: 1.5rem 0 2.5rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  overflow: auto;
  background: var(--niceeval-color-surface-subtle, #111111);
  border: 1px solid var(--niceeval-color-border, #262626);
  border-radius: var(--niceeval-radius, 0);
}

.niceeval-report__code-block code {
  font: inherit;
}

.niceeval-report__table-wrap {
  width: 100%;
  margin: 1.5rem 0 2.75rem;
  overflow-x: auto;
}

.niceeval-report__table {
  width: 100%;
  min-width: 36rem;
  border-collapse: collapse;
  border-top: 1px solid var(--niceeval-color-border-strong, #343434);
}

.niceeval-report__table caption {
  padding-bottom: 0.75rem;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-weight: 600;
  text-align: left;
}

.niceeval-report__table th,
.niceeval-report__table td {
  padding: 0.8rem 0.75rem;
  border-bottom: 1px solid var(--niceeval-color-border, #262626);
  vertical-align: top;
}

.niceeval-report__table th {
  color: var(--niceeval-color-text, #ededed);
  font-weight: 600;
  vertical-align: bottom;
}

.niceeval-report__table tbody th {
  text-align: start;
  vertical-align: top;
}

.niceeval-report__align-start {
  text-align: start;
}

.niceeval-report__align-end {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__metric {
  display: inline-grid;
  width: min(100%, 16rem);
  margin: 0 clamp(2rem, 4vw, 4rem) 2rem 0;
  vertical-align: top;
}

.niceeval-report__metric > div {
  display: grid;
  gap: 0.35rem;
}

.niceeval-report__metric dt {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__metric dd {
  margin: 0;
  color: var(--niceeval-color-text, #ededed);
  font-size: clamp(1.6rem, 3vw, 2.25rem);
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__metric-unit {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.55em;
  font-weight: 400;
}

.niceeval-report__status {
  max-width: 72ch;
  margin: 1.25rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  border-left: 2px solid var(--niceeval-color-border-strong, #343434);
}

.niceeval-report__status--positive {
  border-left-color: var(--niceeval-color-positive, #3ddc97);
}

.niceeval-report__status--warning {
  border-left-color: var(--niceeval-color-warning, #e8b84a);
}

.niceeval-report__status--negative {
  border-left-color: var(--niceeval-color-negative, #ff6b6b);
}

.niceeval-report__status-detail {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__chart {
  margin: 2.5rem 0 3.5rem;
}

.niceeval-report__chart figcaption {
  max-width: 68ch;
  font-size: 1.1rem;
  font-weight: 600;
}

.niceeval-report__chart-category {
  display: block;
  margin-top: 0.3rem;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.85em;
  font-weight: 400;
}

@media (max-width: 44rem) {
  .niceeval-report {
    padding: 2rem 1rem 4rem;
  }

  .niceeval-report__document-header {
    padding-bottom: 3rem;
  }

  .niceeval-report__metric {
    width: 100%;
    margin-right: 0;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid var(--niceeval-color-border, #262626);
  }

  .niceeval-report__table {
    min-width: 32rem;
  }
}
`;
