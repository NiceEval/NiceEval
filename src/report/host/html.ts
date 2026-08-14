import {
  isReportDownloadPath,
  isReportRoute,
  staticPathForReportDownload,
  staticPathForReportRoute,
  type ReportRoute,
} from "../author/identity.ts";
import type {
  ReportBlock,
  ReportCoverage,
  ReportDisplayValue,
  ReportDocument,
  ReportInline,
  ReportRankedBars,
  ReportScalar,
  ReportScatter,
  ReportTreeCell,
  ReportTreeTable,
} from "../semantic/document.ts";
import {
  basalt,
  themeStylesheet,
  type ThemeDefinition,
} from "./theme.ts";

export type RenderReportHtmlInput =
  | {
    readonly document: ReportDocument;
    readonly locale?: "en" | "zh-CN";
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
    readonly locale?: "en" | "zh-CN";
    /** Omission deliberately means the host's closed Basalt default. */
    readonly theme?: ThemeDefinition;
  };

export interface ReportHtmlHostMetadata {
  readonly revision?: number;
  readonly lastRebuildProblem?: string;
}

type ReportLinkTarget = Extract<ReportInline, { readonly type: "link" }>["target"];
export type ReportHrefMode = "relative" | "root";

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
    ? renderDocument(input.document, input.route, "relative")
    : `<pre class="niceeval-report__text">${escapeHtml(input.text)}</pre>`;
  return `<!doctype html><html lang="${input.locale ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${metadata}<style>${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}</style></head><body><main class="niceeval-report">${content}</main></body></html>`;
}

/** Package-owned fragment renderer used by the live shell for the same closed document. */
export function renderReportDocumentFragment(input: {
  readonly document: ReportDocument;
  readonly route: ReportRoute;
  readonly hrefMode?: ReportHrefMode;
}): string {
  return renderDocument(input.document, input.route, input.hrefMode ?? "relative");
}

export interface RenderReportLiveHtmlInput {
  readonly title: string;
  readonly locale?: "en" | "zh-CN";
  readonly revision: number;
  readonly currentRoute: ReportRoute;
  readonly currentDocument?: ReportDocument;
  readonly navigation: readonly {
    readonly pageId: string;
    readonly title: string;
    readonly route: ReportRoute;
    readonly state: "rendered" | "data-unavailable" | "execution-failed";
    readonly document?: ReportDocument;
  }[];
  readonly hostMetadata?: ReportHtmlHostMetadata;
  readonly theme?: ThemeDefinition;
}

/** One live shell over fixed documents from the same immutable execution revision. */
export function renderReportLiveHtml(input: RenderReportLiveHtmlInput): string {
  const theme = input.theme ?? basalt;
  const selectedIndex = input.navigation.findIndex((item) => item.route === input.currentRoute);
  const tabs = input.navigation.map((item, index) => {
    const selected = index === selectedIndex;
    return `<button type="button" role="tab" id="niceeval-tab-${index}" aria-controls="niceeval-panel-${index}" aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}" data-niceeval-tab="${index}" data-niceeval-route="/${escapeHtml(staticPathForReportRoute(item.route).posix)}">${escapeHtml(item.title)}</button>`;
  }).join("");
  const panels = input.navigation.map((item, index) => {
    const selected = index === selectedIndex;
    const body = item.state === "rendered" && item.document !== undefined
      ? renderDocument(item.document, item.route, "root")
      : `<article class="niceeval-report__document"><header class="niceeval-report__document-header"><h1>${escapeHtml(item.title)}</h1></header><p role="status">${escapeHtml(`Page ${item.state}`)}</p></article>`;
    return `<section role="tabpanel" id="niceeval-panel-${index}" aria-labelledby="niceeval-tab-${index}" data-niceeval-panel="${index}"${selected ? "" : " hidden"}>${body}</section>`;
  }).join("");
  const direct = selectedIndex < 0 && input.currentDocument !== undefined
    ? `<section data-niceeval-direct-page>${renderDocument(input.currentDocument, input.currentRoute, "root")}</section>`
    : "";
  const metadata = renderHostMetadata({
    ...input.hostMetadata,
    revision: input.revision,
  });
  return `<!doctype html><html lang="${input.locale ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>${metadata}<style>${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}${REPORT_LIVE_STYLESHEET}</style></head><body><main class="niceeval-report niceeval-report--live"><div role="tablist" aria-label="Report pages" class="niceeval-report__tabs">${tabs}</div>${panels}${direct}<dialog class="niceeval-report__dialog" aria-modal="true"><div data-niceeval-dialog-content></div><button type="button" data-niceeval-dialog-close>Close</button></dialog></main><script>${REPORT_LIVE_SCRIPT}</script></body></html>`;
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

function renderDocument(document: ReportDocument, route: ReportRoute, hrefMode: ReportHrefMode): string {
  const dashboardClass = document.presentation === "classic-dashboard"
    ? " niceeval-report__document--classic-dashboard"
    : "";
  return `<article class="niceeval-report__document${dashboardClass}"><header class="niceeval-report__document-header"><h1>${escapeHtml(document.title)}</h1></header>${document.children.map((block) => renderBlock(block, route, 2, hrefMode)).join("")}</article>`;
}

function renderBlock(block: ReportBlock, route: ReportRoute, headingLevel: number, hrefMode: ReportHrefMode): string {
  switch (block.type) {
    case "section": {
      const level = Math.min(headingLevel, 6);
      const meta = block.meta === undefined ? "" : `<p class="niceeval-report__section-meta">${escapeHtml(block.meta)}</p>`;
      return `<section class="niceeval-report__section"><h${level}>${escapeHtml(block.heading)}</h${level}>${meta}${block.children.map((child) => renderBlock(child, route, level + 1, hrefMode)).join("")}</section>`;
    }
    case "paragraph":
      return `<p class="niceeval-report__paragraph">${renderInlines(block.children, route, hrefMode)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag} class="niceeval-report__list">${block.items.map((item) => `<li>${item.map((child) => renderBlock(child, route, headingLevel, hrefMode)).join("")}</li>`).join("")}</${tag}>`;
    }
    case "table":
      return `<div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><caption>${escapeHtml(block.caption)}</caption><thead><tr>${block.columns.map((column) => `<th scope="col" class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${block.columns.map((column) => `<td class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(scalarText(row[column.key]!))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "metric": {
      const value = scalarText(block.value);
      return `<dl class="niceeval-report__metric"><div><dt>${escapeHtml(block.label)}</dt><dd><data value="${escapeHtml(value)}">${escapeHtml(value)}</data>${block.unit === undefined ? "" : ` <span class="niceeval-report__metric-unit">${escapeHtml(block.unit)}</span>`}</dd></div></dl>`;
    }
    case "status": {
      const tone = statusTone(block.tone);
      return `<p class="niceeval-report__status niceeval-report__status--${tone}" data-tone="${tone}" role="status"><strong>${escapeHtml(block.label)}</strong>${block.detail === undefined ? "" : ` <span class="niceeval-report__status-detail">${renderInlines(block.detail, route, hrefMode)}</span>`}</p>`;
    }
    case "code-block":
      return `<pre class="niceeval-report__code-block"><code${block.language === undefined ? "" : ` data-language="${escapeHtml(block.language)}"`}>${escapeHtml(block.value)}</code></pre>`;
    case "chart":
      return renderChart(block);
    case "hero":
      return renderHero(block, route, hrefMode);
    case "summary":
      return renderSummary(block);
    case "ranked-bars":
      return renderRankedBars(block);
    case "scatter":
      return renderScatter(block, route, hrefMode);
    case "tree-table":
      return renderTreeTable(block, route, hrefMode);
    case "grid":
      return `<div class="niceeval-report__grid">${block.cells.map((cell) => renderBlock(cell, route, headingLevel, hrefMode)).join("")}</div>`;
    case "stat":
      return `<dl class="niceeval-report__stat"><div><dt>${escapeHtml(block.label)}</dt><dd>${escapeHtml(block.value)}</dd></div></dl>`;
    case "cell-table": {
      if (block.hierarchy === true) {
        return renderCellTableHierarchy(block, route, hrefMode);
      }
      const headings = block.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("");
      const rows = block.rows.map((row) =>
        `<tr>${block.columns.map((column) => `<td>${escapeHtml(row.cells[column] ?? "—")}</td>`).join("")}</tr>`
      ).join("");
      return `<div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }
}

function renderCellTableHierarchy(
  block: Extract<ReportBlock, { readonly type: "cell-table" }>,
  route: ReportRoute,
  hrefMode: ReportHrefMode,
): string {
  const children = new Map<string | undefined, typeof block.rows>();
  for (const row of block.rows) {
    const siblings = children.get(row.parentKey) ?? [];
    children.set(row.parentKey, Object.freeze([...siblings, row]));
  }
  const headings = block.columns.map((column) =>
    `<span role="columnheader">${escapeHtml(column)}</span>`
  ).join("");
  const renderRow = (row: typeof block.rows[number]): string => {
    const descendants = children.get(row.key) ?? [];
    const cells = block.columns.map((column, index) => {
      const label = index === 0 ? row.label ?? row.cells[column] ?? "—" : row.cells[column] ?? "—";
      const content = index === 0 && descendants.length === 0 && row.target !== undefined
        ? `<a ${reportLinkAttributes(route, row.target, hrefMode)}>${escapeHtml(label)}</a>`
        : escapeHtml(label);
      return `<span role="cell" class="niceeval-report__hierarchy-cell${index === 0 ? " niceeval-report__hierarchy-cell--label" : ""}">${content}</span>`;
    }).join("");
    const rowContent = `<span role="row" class="niceeval-report__hierarchy-row" data-kind="${escapeHtml(row.kind ?? "item")}">${cells}</span>`;
    if (descendants.length === 0) return rowContent;
    const label = row.label ?? row.key;
    return `<details class="niceeval-report__hierarchy-node"><summary role="button" aria-label="${escapeHtml(label)}">${rowContent}</summary><div role="rowgroup" aria-label="${escapeHtml(`${label} children`)}" class="niceeval-report__hierarchy-children">${descendants.map(renderRow).join("")}</div></details>`;
  };
  const roots = children.get(undefined) ?? [];
  const trailingColumns = Math.max(0, block.columns.length - 1);
  return `<div class="niceeval-report__table-wrap"><div role="table" aria-label="Experiment hierarchy" class="niceeval-report__hierarchy-table" style="--niceeval-hierarchy-template:minmax(15rem,2fr) repeat(${trailingColumns},minmax(7rem,1fr))"><div role="rowgroup"><div role="row" class="niceeval-report__hierarchy-row niceeval-report__hierarchy-header">${headings}</div></div><div role="rowgroup">${roots.map(renderRow).join("")}</div></div></div>`;
}

function renderChart(block: Extract<ReportBlock, { readonly type: "chart" }>): string {
  const chart = block.chart === "line" ? "line" : "bar";
  return `<figure class="niceeval-report__chart niceeval-report__chart--${chart}" data-chart="${chart}"><figcaption>${escapeHtml(block.title)}<span class="niceeval-report__chart-category">${escapeHtml(block.categoryLabel)}</span></figcaption><div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><thead><tr><th scope="col">${escapeHtml(block.categoryLabel)}</th>${block.series.map((series) => `<th scope="col" class="niceeval-report__align-end">${escapeHtml(series.label)}</th>`).join("")}</tr></thead><tbody>${block.categories.map((category, categoryIndex) => `<tr><th scope="row">${escapeHtml(category)}</th>${block.series.map((series) => `<td class="niceeval-report__align-end">${escapeHtml(scalarText(series.values[categoryIndex] ?? null))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></figure>`;
}

function renderHero(
  block: Extract<ReportBlock, { readonly type: "hero" }>,
  route: ReportRoute,
  hrefMode: ReportHrefMode,
): string {
  const logo = block.logo === undefined
    ? ""
    : `<img class="niceeval-report__hero-logo" src="${escapeHtml(block.logo.src)}" alt="${escapeHtml(block.logo.alt)}" />`;
  const title = block.title === undefined
    ? ""
    : `<h1 class="niceeval-report__hero-title">${escapeHtml(block.title)}</h1>`;
  const links = block.links.length === 0
    ? ""
    : `<nav class="niceeval-report__hero-links" aria-label="Report links"><ul>${block.links.map((link) => `<li><a ${reportLinkAttributes(route, link.target, hrefMode)}>${escapeHtml(link.label)}</a></li>`).join("")}</ul></nav>`;
  return `<section class="niceeval-report__hero">${logo}${title}<p>${escapeHtml(block.description)}</p>${links}</section>`;
}

function renderSummary(block: Extract<ReportBlock, { readonly type: "summary" }>): string {
  const metrics = block.metrics.map((metric) => `<div class="niceeval-report__summary-metric"><dt>${escapeHtml(metric.label)}</dt><dd>${renderDashboardDisplay(metric)}</dd></div>`).join("");
  return `<section class="niceeval-report__summary" aria-label="Summary"><h2>Summary</h2><dl><div class="niceeval-report__summary-metric"><dt>Last run</dt><dd>${escapeHtml(formatLastRunAt(block.lastRunAt))}</dd></div>${metrics}</dl></section>`;
}

function renderRankedBars(block: ReportRankedBars): string {
  const points = [...block.points].sort((left, right) => compareRankedBarPoints(left, right, block.better));
  const scale = rankedBarScale(points.map((point) => point.value));
  const bars = points.map((point) => {
    const missing = point.value === null;
    const percent = missing ? 0 : rankedBarPercent(point.value, scale);
    const value = point.display;
    const label = point.series.length === 0 ? point.label : `${point.label} · ${point.series}`;
    return `<li class="niceeval-report__bar${missing ? " niceeval-report__bar--missing" : ""}"><div class="niceeval-report__bar-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div><div class="niceeval-report__bar-track" aria-hidden="true"><span class="niceeval-report__bar-fill" style="width:${percent.toFixed(3)}%"></span></div><span class="niceeval-report__bar-coverage">${escapeHtml(formatCoverage(point.coverage))}</span></li>`;
  }).join("");
  const tableRows = points.map((point) => `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(point.series)}</td><td class="niceeval-report__align-end">${escapeHtml(point.display)}</td><td class="niceeval-report__align-end">${escapeHtml(formatCoverage(point.coverage))}</td></tr>`).join("");
  return `<figure class="niceeval-report__ranked-bars"><figcaption>${escapeHtml(block.title)}<span>${escapeHtml(block.better === "higher" ? "Higher is better" : "Lower is better")}</span></figcaption><ol>${bars}</ol><div class="niceeval-report__table-wrap niceeval-report__dashboard-data"><table class="niceeval-report__table"><caption>Accessible values for ${escapeHtml(block.title)}</caption><thead><tr><th scope="col">Label</th><th scope="col">Series</th><th scope="col" class="niceeval-report__align-end">Value</th><th scope="col" class="niceeval-report__align-end">Coverage</th></tr></thead><tbody>${tableRows}</tbody></table></div></figure>`;
}

function renderScatter(block: ReportScatter, route: ReportRoute, hrefMode: ReportHrefMode): string {
  const plotted = block.series.flatMap((series, seriesIndex) => series.points
    .filter((point) => point.x !== null && point.y !== null)
    .map((point) => ({ point, series, seriesIndex })));
  const xRange = numericRange(plotted.map(({ point }) => point.x!));
  const yRange = numericRange(plotted.map(({ point }) => point.y!));
  const width = 640;
  const height = 360;
  const bounds = { left: 68, right: 30, top: 26, bottom: 54 };
  const pointPosition = (x: number, y: number) => ({
    x: bounds.left + ((x - xRange.minimum) / (xRange.maximum - xRange.minimum)) * (width - bounds.left - bounds.right),
    y: height - bounds.bottom - ((y - yRange.minimum) / (yRange.maximum - yRange.minimum)) * (height - bounds.top - bounds.bottom),
  });
  const links = block.series.map((series, index) => `<li><span class="niceeval-report__scatter-key niceeval-report__scatter-key--${index % 6}" aria-hidden="true"></span>${escapeHtml(series.label)}</li>`).join("");
  const marks = block.series.map((series, seriesIndex) => {
    const points = series.points.filter((point) => point.x !== null && point.y !== null);
    const line = block.connect && points.length > 1
      ? `<polyline class="niceeval-report__scatter-line niceeval-report__scatter-line--${seriesIndex % 6}" points="${points.map((point) => {
        const position = pointPosition(point.x!, point.y!);
        return `${position.x.toFixed(2)},${position.y.toFixed(2)}`;
      }).join(" ")}"></polyline>`
      : "";
    const circles = points.map((point) => {
      const position = pointPosition(point.x!, point.y!);
      const label = `${series.label}: ${point.key}; ${block.xLabel} ${point.xDisplay}; ${block.yLabel} ${point.yDisplay}`;
      const circle = `<circle class="niceeval-report__scatter-point niceeval-report__scatter-point--${seriesIndex % 6}" cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="5"><title>${escapeHtml(label)}</title></circle>`;
      return point.target === undefined || point.target.kind === "attempt"
        ? circle
        : `<a ${reportLinkAttributes(route, point.target, hrefMode)} aria-label="${escapeHtml(label)}">${circle}</a>`;
    }).join("");
    return `${line}${circles}`;
  }).join("");
  const tableRows = block.series.flatMap((series) => series.points.map((point) => `<tr><th scope="row">${escapeHtml(series.label)} · ${escapeHtml(point.key)}</th><td class="niceeval-report__align-end">${escapeHtml(point.xDisplay)}</td><td class="niceeval-report__align-end">${escapeHtml(point.yDisplay)}</td><td>${point.target === undefined ? "" : point.target.kind === "attempt" ? escapeHtml(linkTargetLabel(point.target)) : `<a ${reportLinkAttributes(route, point.target, hrefMode)}>${escapeHtml(linkTargetLabel(point.target))}</a>`}</td></tr>`)).join("");
  return `<figure class="niceeval-report__scatter"><figcaption>${escapeHtml(block.title)}<span>${escapeHtml(block.xLabel)} × ${escapeHtml(block.yLabel)}</span></figcaption><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${block.title}: ${block.xLabel} by ${block.yLabel}`)}" preserveAspectRatio="xMidYMid meet"><title>${escapeHtml(block.title)}</title><desc>${escapeHtml(`Scatter plot of ${block.yLabel} against ${block.xLabel}. Missing values are listed in the table below.`)}</desc><line class="niceeval-report__scatter-axis" x1="${bounds.left}" y1="${height - bounds.bottom}" x2="${width - bounds.right}" y2="${height - bounds.bottom}"></line><line class="niceeval-report__scatter-axis" x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${height - bounds.bottom}"></line><text class="niceeval-report__scatter-axis-label" x="${width / 2}" y="${height - 14}" text-anchor="middle">${escapeHtml(block.xLabel)}</text><text class="niceeval-report__scatter-axis-label" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">${escapeHtml(block.yLabel)}</text>${marks}</svg><ul class="niceeval-report__scatter-legend" aria-label="Series key">${links}</ul><div class="niceeval-report__table-wrap niceeval-report__dashboard-data"><table class="niceeval-report__table"><caption>Accessible values for ${escapeHtml(block.title)}</caption><thead><tr><th scope="col">Point</th><th scope="col" class="niceeval-report__align-end">${escapeHtml(block.xLabel)}</th><th scope="col" class="niceeval-report__align-end">${escapeHtml(block.yLabel)}</th><th scope="col">Link</th></tr></thead><tbody>${tableRows}</tbody></table></div></figure>`;
}

function renderTreeTable(block: ReportTreeTable, route: ReportRoute, hrefMode: ReportHrefMode): string {
  const headings = block.columns.map((column) => `<th scope="col" class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(column.label)}</th>`).join("");
  const rows = block.rows.map((row) => {
    const label = `${treeKindLabel(row.kind)} · ${row.label}`;
    const target = row.target === undefined || row.target.kind === "attempt"
      ? escapeHtml(label)
      : `<a ${reportLinkAttributes(route, row.target, hrefMode)}>${escapeHtml(label)}</a>`;
    const cells = block.columns.map((column) => `<td class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${renderTreeCell(row.cells[column.key]!)}</td>`).join("");
    return `<tr data-kind="${row.kind}" style="--niceeval-tree-depth:${row.depth}"><th scope="row" class="niceeval-report__tree-label">${target}</th>${cells}</tr>`;
  }).join("");
  return `<div class="niceeval-report__table-wrap"><table class="niceeval-report__table niceeval-report__tree-table"><caption>${escapeHtml(block.caption)}</caption><thead><tr><th scope="col">Hierarchy</th>${headings}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function treeKindLabel(kind: ReportTreeTable["rows"][number]["kind"]): string {
  switch (kind) {
    case "experiment":
      return "Experiment";
    case "eval":
      return "Eval";
    case "attempt":
      return "Attempt";
  }
}

function renderTreeCell(value: ReportTreeCell): string {
  if (value === null || typeof value !== "object") return escapeHtml(value === null ? "—" : scalarText(value));
  return renderDashboardDisplay(value);
}

function renderDashboardDisplay(value: ReportDisplayValue): string {
  const display = value.display;
  const coverage = value.coverage === undefined ? "" : ` <span class="niceeval-report__coverage">${escapeHtml(formatCoverage(value.coverage))}</span>`;
  return `${escapeHtml(display)}${coverage}`;
}

function formatLastRunAt(value: number | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toISOString();
}

function formatCoverage(coverage: ReportCoverage): string {
  return `coverage ${coverage.samples}/${coverage.total} ${coverage.basis}`;
}

function linkTargetLabel(target: ReportLinkTarget): string {
  switch (target.kind) {
    case "route":
      return target.route;
    case "download":
      return target.path;
    case "external":
      return target.href;
    case "attempt":
      return target.locator;
  }
}

function compareRankedBarPoints(
  left: ReportRankedBars["points"][number],
  right: ReportRankedBars["points"][number],
  better: ReportRankedBars["better"],
): number {
  if (left.value === null && right.value === null) return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  if (left.value === null) return 1;
  if (right.value === null) return -1;
  const order = better === "higher" ? right.value - left.value : left.value - right.value;
  return order === 0 ? (left.key < right.key ? -1 : left.key > right.key ? 1 : 0) : order;
}

interface RankedBarScale {
  readonly mode: "fraction" | "percent" | "relative";
  readonly maximum: number;
  readonly minimum: number;
}

function rankedBarScale(values: readonly (number | null)[]): RankedBarScale {
  const numbers = values.filter((value): value is number => value !== null);
  const maximum = numbers.length === 0 ? 1 : Math.max(...numbers);
  const minimum = numbers.length === 0 ? 0 : Math.min(...numbers);
  if (minimum >= 0 && maximum <= 1) return { mode: "fraction", minimum: 0, maximum: 1 };
  if (minimum >= 0 && maximum <= 100) return { mode: "percent", minimum: 0, maximum: 100 };
  return { mode: "relative", minimum, maximum };
}

function rankedBarPercent(value: number, scale: RankedBarScale): number {
  if (scale.mode === "fraction") return clamp(value * 100, 0, 100);
  if (scale.mode === "percent") return clamp(value, 0, 100);
  if (scale.maximum === scale.minimum) return 100;
  return clamp(((value - scale.minimum) / (scale.maximum - scale.minimum)) * 100, 0, 100);
}

interface NumericRange {
  readonly minimum: number;
  readonly maximum: number;
}

function numericRange(values: readonly number[]): NumericRange {
  if (values.length === 0) return { minimum: 0, maximum: 1 };
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const delta = minimum === 0 ? 1 : Math.abs(minimum) * 0.1;
    return { minimum: minimum - delta, maximum: maximum + delta };
  }
  return { minimum, maximum };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function renderInlines(children: readonly ReportInline[], route: ReportRoute, hrefMode: ReportHrefMode): string {
  return children.map((child) => {
    switch (child.type) {
      case "text":
        return escapeHtml(child.value);
      case "code":
        return `<code class="niceeval-report__inline-code">${escapeHtml(child.value)}</code>`;
      case "emphasis":
        return `<em>${renderInlines(child.children, route, hrefMode)}</em>`;
      case "link":
        return `<a ${reportLinkAttributes(route, child.target, hrefMode)}>${renderInlines(child.label, route, hrefMode)}</a>`;
    }
  }).join("");
}

/**
 * Link targets always use the static site's output-file codec. A live server
 * serves the same explicit `index.html` paths, so a nested document has one
 * relative href that works identically over HTTP and from a `file://` export.
 */
function reportHref(sourceRoute: ReportRoute, target: ReportLinkTarget, hrefMode: ReportHrefMode): string {
  switch (target.kind) {
    case "external":
      return isAbsoluteHttps(target.href) ? target.href : "#";
    case "attempt":
      return "#";
    case "route":
      if (!isReportRoute(sourceRoute) || !isReportRoute(target.route)) return "#";
      if (hrefMode === "root") return `/${staticPathForReportRoute(target.route).posix}`;
      return relativePath(
        staticPathForReportRoute(sourceRoute).segments.slice(0, -1),
        staticPathForReportRoute(target.route).segments,
      );
    case "download":
      if (!isReportRoute(sourceRoute) || !isReportDownloadPath(target.path)) return "#";
      if (hrefMode === "root") return `/${staticPathForReportDownload(target.path).posix}`;
      return relativePath(
        staticPathForReportRoute(sourceRoute).segments.slice(0, -1),
        staticPathForReportDownload(target.path).segments,
      );
  }
}

function reportLinkAttributes(sourceRoute: ReportRoute, target: ReportLinkTarget, hrefMode: ReportHrefMode): string {
  const href = reportHref(sourceRoute, target, hrefMode);
  const security = target.kind === "external" && href !== "#"
    ? ' target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"'
    : "";
  const routeMarker = target.kind === "route" && href !== "#" ? " data-niceeval-report-route" : "";
  return `href="${escapeHtml(href)}"${routeMarker}${security}`;
}

function isAbsoluteHttps(value: string): boolean {
  if (value.length === 0 || /[\s\u0000-\u001f\u007f-\u009f]/.test(value) || !/^https:\/\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
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

.niceeval-report__hierarchy-table {
  min-width: 52rem;
  border-top: 1px solid var(--niceeval-color-border-strong, #343434);
}

.niceeval-report__hierarchy-row {
  display: grid;
  grid-template-columns: var(--niceeval-hierarchy-template);
  align-items: start;
  border-bottom: 1px solid var(--niceeval-color-border, #262626);
}

.niceeval-report__hierarchy-header {
  color: var(--niceeval-color-text, #ededed);
  font-weight: 600;
}

.niceeval-report__hierarchy-row > [role="columnheader"],
.niceeval-report__hierarchy-cell {
  min-width: 0;
  padding: 0.8rem 0.75rem;
  overflow-wrap: anywhere;
}

.niceeval-report__hierarchy-row > :not(:first-child) {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__hierarchy-node > summary {
  cursor: pointer;
  list-style-position: inside;
}

.niceeval-report__hierarchy-node > summary::marker {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__hierarchy-node > summary > .niceeval-report__hierarchy-row {
  display: inline-grid;
  width: calc(100% - 1.5rem);
  vertical-align: top;
}

.niceeval-report__hierarchy-children {
  margin-left: clamp(0.75rem, 2.5vw, 2rem);
  border-left: 1px solid var(--niceeval-color-border, #262626);
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

.niceeval-report__document--classic-dashboard > :not(.niceeval-report__document-header) {
  margin-top: clamp(2rem, 5vw, 4rem);
}

.niceeval-report__hero {
  max-width: 72ch;
  padding: clamp(1.25rem, 3vw, 2rem);
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-surface-subtle, #111111);
}

.niceeval-report__hero-logo {
  display: block;
  width: 3rem;
  height: 3rem;
  margin-bottom: 1rem;
  object-fit: contain;
}

.niceeval-report__hero-title {
  margin: 0 0 0.75rem;
  font-size: clamp(1.35rem, 3vw, 2rem);
  font-weight: 650;
}

.niceeval-report__hero > p {
  margin: 0;
  font-size: clamp(1.05rem, 2vw, 1.35rem);
}

.niceeval-report__hero-links ul,
.niceeval-report__scatter-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.niceeval-report__summary {
  max-width: 72rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid var(--niceeval-color-border, #262626);
  background: var(--niceeval-color-surface-subtle, #111111);
}

.niceeval-report__summary > h2 {
  margin-bottom: 1.25rem;
}

.niceeval-report__summary > dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
  margin: 0;
}

.niceeval-report__summary-metric {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}

.niceeval-report__summary-metric dt,
.niceeval-report__bar-coverage,
.niceeval-report__coverage {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
}

.niceeval-report__summary-metric dd {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__ranked-bars,
.niceeval-report__scatter {
  margin: 2.5rem 0 3.5rem;
}

.niceeval-report__ranked-bars figcaption,
.niceeval-report__scatter figcaption {
  display: grid;
  gap: 0.3rem;
  max-width: 68ch;
  font-size: 1.1rem;
  font-weight: 600;
}

.niceeval-report__ranked-bars figcaption > span,
.niceeval-report__scatter figcaption > span {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.85em;
  font-weight: 400;
}

.niceeval-report__ranked-bars > ol {
  display: grid;
  gap: 1rem;
  max-width: 72rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
}

.niceeval-report__bar {
  display: grid;
  grid-template-columns: minmax(10rem, 18rem) minmax(8rem, 1fr) auto;
  align-items: center;
  gap: 0.75rem 1rem;
}

.niceeval-report__bar-label {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.niceeval-report__bar-label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.niceeval-report__bar-label strong {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font-size: 0.9em;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__bar-track {
  height: 0.75rem;
  overflow: hidden;
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-page, #050505);
}

.niceeval-report__bar-fill {
  display: block;
  height: 100%;
  min-width: 0;
  background: var(--niceeval-color-accent, #cbd6dc);
}

.niceeval-report__bar--missing .niceeval-report__bar-track {
  background: repeating-linear-gradient(
    135deg,
    var(--niceeval-color-page, #050505),
    var(--niceeval-color-page, #050505) 0.35rem,
    var(--niceeval-color-surface-subtle, #111111) 0.35rem,
    var(--niceeval-color-surface-subtle, #111111) 0.7rem
  );
}

.niceeval-report__bar-coverage,
.niceeval-report__coverage {
  font-size: 0.82em;
  font-variant-numeric: tabular-nums;
}

.niceeval-report__dashboard-data {
  margin-top: 1.5rem;
}

.niceeval-report__scatter svg {
  display: block;
  width: min(100%, 72rem);
  height: auto;
  margin-top: 1.25rem;
  overflow: visible;
  border: 1px solid var(--niceeval-color-border, #262626);
  background: var(--niceeval-color-surface-subtle, #111111);
}

.niceeval-report__scatter-axis {
  stroke: var(--niceeval-color-border-strong, #343434);
  stroke-width: 1;
}

.niceeval-report__scatter-axis-label {
  fill: var(--niceeval-color-text-secondary, #a1a1aa);
  font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 14px;
}

.niceeval-report__scatter-line {
  fill: none;
  stroke: var(--niceeval-color-accent, #cbd6dc);
  stroke-width: 2;
  opacity: 0.55;
}

.niceeval-report__scatter-point {
  fill: var(--niceeval-color-accent, #cbd6dc);
  stroke: var(--niceeval-color-page, #050505);
  stroke-width: 1.5;
}

.niceeval-report__scatter-line--1,
.niceeval-report__scatter-point--1,
.niceeval-report__scatter-key--1 {
  stroke: var(--niceeval-color-positive, #3ddc97);
  fill: var(--niceeval-color-positive, #3ddc97);
}

.niceeval-report__scatter-line--2,
.niceeval-report__scatter-point--2,
.niceeval-report__scatter-key--2 {
  stroke: var(--niceeval-color-warning, #e8b84a);
  fill: var(--niceeval-color-warning, #e8b84a);
}

.niceeval-report__scatter-line--3,
.niceeval-report__scatter-point--3,
.niceeval-report__scatter-key--3 {
  stroke: var(--niceeval-color-negative, #ff6b6b);
  fill: var(--niceeval-color-negative, #ff6b6b);
}

.niceeval-report__scatter-key {
  display: inline-block;
  width: 0.7rem;
  height: 0.7rem;
  margin-right: 0.35rem;
  background: var(--niceeval-color-accent, #cbd6dc);
}

.niceeval-report__tree-label {
  padding-inline-start: calc(0.75rem + var(--niceeval-tree-depth, 0) * 1.25rem) !important;
}

.niceeval-report__tree-table tbody tr[data-kind="attempt"] .niceeval-report__tree-label {
  color: var(--niceeval-color-text-secondary, #a1a1aa);
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

  .niceeval-report__bar {
    grid-template-columns: 1fr auto;
  }

  .niceeval-report__bar-track {
    grid-column: 1 / -1;
  }
}
`;

const REPORT_LIVE_STYLESHEET = `
.niceeval-report__tabs {
  display: flex;
  width: min(100%, 72rem);
  margin: 0 auto 2.5rem;
  gap: 0.25rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--niceeval-color-border, #262626);
}

.niceeval-report__tabs [role="tab"] {
  flex: 0 0 auto;
  padding: 0.7rem 1rem;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--niceeval-color-text-secondary, #a1a1aa);
  font: inherit;
  cursor: pointer;
}

.niceeval-report__tabs [role="tab"][aria-selected="true"] {
  border-bottom-color: var(--niceeval-color-accent, #cbd6dc);
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report__dialog {
  width: min(92vw, 72rem);
  max-height: 88vh;
  padding: clamp(1rem, 3vw, 2.5rem);
  overflow: auto;
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-page, #050505);
  color: var(--niceeval-color-text, #ededed);
}

.niceeval-report__dialog::backdrop {
  background: rgb(0 0 0 / 72%);
}

.niceeval-report__dialog [data-niceeval-dialog-close] {
  position: sticky;
  bottom: 0;
  margin-top: 1.5rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--niceeval-color-border-strong, #343434);
  background: var(--niceeval-color-page-raised, #111);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
`;

const REPORT_LIVE_SCRIPT = `
(() => {
  const revisionMeta = document.querySelector('meta[name="niceeval-report-revision"]');
  const revision = revisionMeta ? Number(revisionMeta.getAttribute("content")) : -1;
  const tabs = Array.from(document.querySelectorAll('[role="tab"][data-niceeval-tab]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"][data-niceeval-panel]'));
  const directPage = document.querySelector('[data-niceeval-direct-page]');
  const activate = (tab, focus) => {
    const index = tab.getAttribute("data-niceeval-tab");
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      candidate.setAttribute("tabindex", selected ? "0" : "-1");
    }
    for (const panel of panels) panel.hidden = panel.getAttribute("data-niceeval-panel") !== index;
    if (directPage) directPage.hidden = true;
    if (focus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab, false));
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[next], true);
    });
  });
  for (const details of document.querySelectorAll('details.niceeval-report__hierarchy-node')) {
    const summary = details.querySelector(':scope > summary');
    if (!summary) continue;
    const sync = () => summary.setAttribute("aria-expanded", String(details.open));
    sync();
    details.addEventListener("toggle", sync);
  }
  const dialog = document.querySelector('dialog.niceeval-report__dialog');
  const content = dialog && dialog.querySelector('[data-niceeval-dialog-content]');
  const close = dialog && dialog.querySelector('[data-niceeval-dialog-close]');
  let trigger = null;
  if (dialog && close) {
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      const previous = trigger;
      trigger = null;
      if (previous && previous.isConnected) previous.focus();
    });
  }
  document.addEventListener("click", async (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target instanceof Element ? event.target.closest('a[data-niceeval-report-route]') : null;
    const href = element && element.getAttribute("href");
    if (!element || !href || element.getAttribute("target") === "_blank" || !dialog || !content || !close) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const fixedTab = tabs.find((tab) => tab.getAttribute("data-niceeval-route") === url.pathname);
    event.preventDefault();
    if (fixedTab) {
      activate(fixedTab, true);
      return;
    }
    try {
      const response = await fetch(url.href, {
        headers: {
          accept: "application/json",
          "x-niceeval-report-fragment": String(revision),
        },
      });
      if (response.status === 409) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        window.location.assign(url.href);
        return;
      }
      const payload = await response.json();
      if (payload.revision !== revision || typeof payload.title !== "string" || typeof payload.html !== "string") {
        window.location.reload();
        return;
      }
      content.innerHTML = payload.html;
      dialog.setAttribute("aria-label", payload.title);
      trigger = element;
      dialog.showModal();
      close.focus();
    } catch {
      window.location.assign(url.href);
    }
  });
})();
`;
