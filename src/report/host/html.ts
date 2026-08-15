import type {
  ClosedReportPage,
  ClosedReportTree,
} from "../execution/model.ts";
import type { LocalizedText } from "../../shared/types.ts";
import { REPORT_SUPPORTED_LOCALES } from "../classic/locale.ts";
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
import { closedLinkTarget } from "../semantic/closed.ts";
import {
  closedDownloadPath,
  compareUtf8,
  evidenceRefText,
  localizedText,
  localizedUnknownText,
  metricValue,
  reportClosedValueText,
} from "./presentation.ts";
import {
  basalt,
  themeStylesheet,
  type ThemeDefinition,
} from "./theme.ts";
import {
  REPORT_CLASSIC_STYLESHEET_PATH,
  REPORT_REFRESH_RUNTIME_PATH,
} from "./site-assets.ts";
import {
  renderClassicHorizontalBarsHtml,
  renderStaticChartSvg,
} from "./chart-svg.ts";
import {
  compactMetricNumber,
  metricDisplayUnit,
} from "../classic/format.ts";

/** Metadata comes from a fixed view revision, never a Report callback. */
export interface ReportHtmlHostMetadata {
  readonly revision?: number;
  readonly lastRebuildProblem?: string;
}

type ReportSiteLocale = typeof REPORT_SUPPORTED_LOCALES[number];

const HEAD_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const HEAD_META_ATTRIBUTES = new Set(["content", "itemprop", "name", "property"]);
const HEAD_LINK_ATTRIBUTES = new Set(["href", "hreflang", "rel", "title", "type"]);
const HEAD_STYLE_ATTRIBUTES = new Set(["media", "type"]);
const HEAD_LINK_RELATIONS = new Set(["alternate", "author", "canonical", "license"]);
/**
 * HTML gets a closed tree and one already-selected page. It never receives a
 * Report module, a Sample, a reader, or browser-side data-fetching authority.
 */
export type RenderReportHtmlInput =
  | {
    readonly tree: ClosedReportTree;
    readonly page: ClosedReportPage;
    /** Report identity is closed data used by the Host-owned document chrome. */
    readonly reportTitle?: LocalizedText;
    readonly theme?: ThemeDefinition;
    readonly hostMetadata?: ReportHtmlHostMetadata;
  }
  | {
    readonly tree: ClosedReportTree;
    readonly surface: "problems";
    readonly reportTitle?: LocalizedText;
    readonly theme?: ThemeDefinition;
    readonly hostMetadata?: ReportHtmlHostMetadata;
  }
  | {
    readonly tree: ClosedReportTree;
    /** A host-owned index used only when no authored page owns `/`. */
    readonly surface: "index";
    readonly reportTitle?: LocalizedText;
    readonly theme?: ThemeDefinition;
    readonly hostMetadata?: ReportHtmlHostMetadata;
  }
  | {
    /** Reserved host surfaces may use a fully escaped text projection. */
    readonly text: string;
    readonly reportTitle?: LocalizedText;
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
  const page = "page" in input ? input.page : undefined;
  const surface = "surface" in input ? input.surface : undefined;
  const fallbackTitle: LocalizedText = "text" in input
    ? "NiceEval report"
    : page === undefined
      ? surface === "problems" ? "NiceEval report problems" : "NiceEval report"
      : page.title;
  const siteTitle = input.reportTitle ?? fallbackTitle;
  const title = localizedText(siteTitle, "en");
  const pageRoute = page?.route ?? (surface === "problems" ? "/_niceeval/problems" : "/");
  const localeContent = REPORT_SUPPORTED_LOCALES.map((locale) => {
    const content = "text" in input
      ? `<pre class="niceeval-report__text">${escapeHtmlText(input.text)}</pre>`
      : page === undefined
        ? surface === "problems" ? renderProblemsSurface(input.tree, locale) : renderIndexSurface(input.tree, locale)
        : renderPageSurface(input.tree, page, locale);
    return renderReportSiteShell({
      tree: "text" in input ? undefined : input.tree,
      locale,
      route: pageRoute,
      content,
      ...(locale === "en" ? {} : { hidden: true }),
    });
  }).join("");
  const authorHead = page === undefined ? "" : renderPageHead(page);
  const outputDirectory = page === undefined
    ? surface === "problems" ? ["_niceeval", "problems"] : []
    : staticOutputPathForRoute(page.route).segments.slice(0, -1);
  const stylesheetHref = reportHostAssetHref(outputDirectory, REPORT_CLASSIC_STYLESHEET_PATH);
  const runtimeHref = reportHostAssetHref(outputDirectory, REPORT_REFRESH_RUNTIME_PATH);
  const titleAttributes = REPORT_SUPPORTED_LOCALES.map((locale) =>
    ` data-niceeval-title-${locale.toLowerCase()}="${escapeHtmlAttribute(localizedText(siteTitle, locale))}"`
  ).join("");
  // A live view must return exactly the bytes that export writes. Revision and
  // rebuild state therefore live in transport headers/probes, never in this
  // immutable page body.
  return `<!doctype html><html lang="en"${titleAttributes}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtmlText(title)}</title>${authorHead}<style>${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}</style><link rel="stylesheet" href="${escapeHtmlAttribute(stylesheetHref)}"><script src="${escapeHtmlAttribute(runtimeHref)}" defer></script></head><body>${localeContent}</body></html>`;
}

function renderReportSiteShell(input: {
  readonly tree: ClosedReportTree | undefined;
  readonly locale: ReportSiteLocale;
  readonly route: string;
  readonly content: string;
  readonly hidden?: true;
}): string {
  const chrome = siteChrome(input.locale);
  const navigation = input.tree === undefined ? "" : renderNavigation(input.tree, input.route, input.locale);
  return `<div class="niceeval-report" data-niceeval-locale="${input.locale}"${input.hidden === true ? " hidden" : ""}><header class="niceeval-report__topbar"><a class="niceeval-report__brand" href="https://niceeval.com/?utm_source=report&amp;utm_medium=brand" target="_blank" rel="noopener noreferrer"><span class="niceeval-report__brand-mark" aria-hidden="true"></span><span>NiceEval</span></a><nav class="niceeval-report__site-navigation" aria-label="${escapeHtmlAttribute(chrome.navigationLabel)}">${navigation}</nav><div class="niceeval-report__language" aria-label="${escapeHtmlAttribute(chrome.languageLabel)}"><button type="button" data-niceeval-locale-button="en" aria-pressed="${input.locale === "en"}">EN</button><button type="button" data-niceeval-locale-button="zh-CN" aria-pressed="${input.locale === "zh-CN"}">中文</button></div></header><main class="niceeval-report__site-main">${input.content}</main></div>`;
}

function renderPageHead(page: ClosedReportPage): string {
  const metadata = page.head.metadata.map(renderClosedHeadMetadata).join("");
  const styles = page.head.styles
    .map(renderClosedStyle)
    .filter(Boolean)
    .join("");
  return `${metadata}${styles}`;
}

function renderClosedStyle(value: unknown): string {
  const entry = dataRecord(value);
  if (entry === undefined || typeof entry.css !== "string" || !isScopedClosedCss(entry.css)) return "";
  const attributes = renderClosedHeadAttributes(entry.attrs, "style");
  return attributes === undefined ? "" : `<style${attributes}>${entry.css}</style>`;
}

function renderClosedHeadMetadata(value: unknown): string {
  const entry = dataRecord(value);
  if (entry === undefined || (entry.tag !== "meta" && entry.tag !== "link")) return "";
  const attributes = renderClosedHeadAttributes(entry.attrs, entry.tag);
  if (attributes === undefined) return "";
  return `<${entry.tag}${attributes}>`;
}

function renderClosedHeadAttributes(
  value: unknown,
  tag: "meta" | "link" | "style",
): string | undefined {
  if (value === undefined) return tag === "style" ? "" : undefined;
  const attrs = dataRecord(value);
  if (attrs === undefined) return undefined;
  const allowed = tag === "meta" ? HEAD_META_ATTRIBUTES : tag === "link" ? HEAD_LINK_ATTRIBUTES : HEAD_STYLE_ATTRIBUTES;
  const rendered: string[] = [];
  for (const key of Object.keys(attrs).sort(compareUtf8)) {
    const attribute = attrs[key];
    if (!HEAD_ATTRIBUTE_NAME.test(key) || key.toLowerCase().startsWith("on") || !allowed.has(key) ||
      (attribute !== true && typeof attribute !== "string")) {
      return undefined;
    }
    rendered.push(attribute === true ? ` ${key}` : ` ${key}="${escapeHtmlAttribute(attribute)}"`);
  }
  if (tag === "link") {
    const rel = attrs.rel;
    const href = attrs.href;
    if (typeof rel !== "string" || !HEAD_LINK_RELATIONS.has(rel.toLowerCase()) ||
      typeof href !== "string" || !isLocalHeadReference(href)) {
      return undefined;
    }
  }
  if (tag === "style" && attrs.type !== undefined && attrs.type !== "text/css") return undefined;
  return rendered.join("");
}

function renderPageSurface(
  tree: ClosedReportTree,
  page: ClosedReportPage,
  locale: ReportSiteLocale,
): string {
  const route = page.route;
  return `<article class="niceeval-report__document"><section class="niceeval-report__author">${renderNodeHtml(page.node, tree, route, "web", 2, locale)}</section>${renderPageProblems(tree, page, route, locale)}${renderDownloads(tree, route, locale)}</article>`;
}

function renderProblemsSurface(tree: ClosedReportTree, locale: ReportSiteLocale): string {
  const route = "/_niceeval/problems";
  const chrome = siteChrome(locale);
  return `<article class="niceeval-report__document"><header class="niceeval-report__document-header"><h1>${escapeHtmlText(chrome.problemsTitle)}</h1><p>${escapeHtmlText(chrome.problemsDescription)}</p></header>${renderProblemList(tree.problemTable, tree, route, locale)}${renderDownloads(tree, route, locale)}</article>`;
}

function renderIndexSurface(tree: ClosedReportTree, locale: ReportSiteLocale): string {
  const chrome = siteChrome(locale);
  return `<article class="niceeval-report__document"><header class="niceeval-report__document-header"><h1>${escapeHtmlText(chrome.indexTitle)}</h1><p>${escapeHtmlText(chrome.indexDescription)}</p></header>${renderProblemList(tree.problemTable, tree, "/", locale)}${renderDownloads(tree, "/", locale)}</article>`;
}

function renderNavigation(tree: ClosedReportTree, sourceRoute: string, locale: ReportSiteLocale): string {
  const pages = [...tree.pages].filter((page) => page.navigation).sort(comparePages);
  const links = pages.map((page) => {
    const label = localizedText(page.title, locale);
    const current = page.route === sourceRoute ? " aria-current=\"page\"" : "";
    return `<li><a href="${escapeHtmlAttribute(reportHref(sourceRoute, { kind: "route", route: page.route }))}"${current}>${escapeHtmlText(label)}</a></li>`;
  });
  const problems = reportHref(sourceRoute, { kind: "problems" });
  const problemLink = tree.problemTable.length === 0
    ? ""
    : `<li><a href="${escapeHtmlAttribute(problems)}">${escapeHtmlText(siteChrome(locale).problemsLink)}</a></li>`;
  return `<ul>${links.join("")}${problemLink}</ul>`;
}

function siteChrome(locale: ReportSiteLocale): Readonly<{
  readonly navigationLabel: string;
  readonly languageLabel: string;
  readonly problemsLink: string;
  readonly problemsTitle: string;
  readonly problemsDescription: string;
  readonly indexTitle: string;
  readonly indexDescription: string;
}> {
  if (locale === "zh-CN") {
    return {
      navigationLabel: "报告页面",
      languageLabel: "语言",
      problemsLink: "问题",
      problemsTitle: "报告问题",
      problemsDescription: "Analysis 问题仍会显示。执行问题会阻止形成完整的静态导出。",
      indexTitle: "NiceEval 报告",
      indexDescription: "请选择一个已闭合的报告页面。即使禁用 JavaScript 或网络，本站仍可阅读。",
    };
  }
  return {
    navigationLabel: "Report pages",
    languageLabel: "Language",
    problemsLink: "Problems",
    problemsTitle: "Report problems",
    problemsDescription: "Analysis issues remain visible. Execution problems are shown here and prevent a complete static export.",
    indexTitle: "NiceEval report",
    indexDescription: "Choose a closed report page. This site remains readable without JavaScript or network access.",
  };
}

type RenderFace = "text" | "web";
type RenderPresentation = "default" | "classic";

/** Renders a validated node recursively; unknown nodes become explicit text. */
export function renderNodeHtml(
  value: unknown,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace = "web",
  headingLevel = 2,
  locale: ReportSiteLocale = "en",
  inlineText = false,
  presentation: RenderPresentation = "default",
): string {
  const node = dataRecord(value);
  if (node === undefined || typeof node.type !== "string") {
    return unsupportedNodeHtml("unsupported Report node");
  }
  switch (node.type) {
    case "text":
      return inlineText
        ? `<span class="niceeval-report__inline-text">${escapeHtmlText(localizedUnknownText(node.value, locale))}</span>`
        : `<p class="niceeval-report__paragraph">${escapeHtmlText(localizedUnknownText(node.value, locale))}</p>`;
    case "stack":
      return `<section class="niceeval-report__stack">${renderChildrenHtml(node.children, tree, route, face, headingLevel, locale, false, presentation)}</section>`;
    case "grid":
      return `<section class="niceeval-report__grid">${renderChildrenHtml(node.children, tree, route, face, headingLevel, locale, false, presentation)}</section>`;
    case "callout":
      return renderCalloutHtml(node, tree, route, face, headingLevel, locale, presentation);
    case "table":
      return renderTableHtml(node, tree, route, locale, presentation);
    case "bars":
    case "line":
    case "scatter":
      return renderChartHtml(node, tree, route, locale, presentation);
    case "stat":
      return renderStatHtml(node, tree, route, locale, presentation);
    case "download":
      return renderDownloadHtml(node, tree, route, face, headingLevel, locale, presentation);
    case "element":
      return renderElementHtml(node, tree, route, face, headingLevel, locale, inlineText, presentation);
    case "link":
      return renderLinkHtml(node, tree, route, face, headingLevel, locale, inlineText, presentation);
    case "primitive":
      return renderNodeHtml(face === "text" ? node.text : node.web, tree, route, face, headingLevel, locale, inlineText, presentation);
    default:
      return unsupportedNodeHtml(`unsupported Report node: ${node.type}`);
  }
}

function renderElementHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
  locale: ReportSiteLocale,
  inlineText: boolean,
  presentation: RenderPresentation,
): string {
  const tag = safeElementTag(node.tag);
  if (tag === undefined) return unsupportedNodeHtml("unsupported closed JSX tag");
  const classes = closedElementClasses(node.classes);
  const classAttribute = classes.length === 0 ? "" : ` class="${escapeHtmlAttribute(classes.join(" "))}"`;
  const childPresentation = presentation === "classic" || classes.includes("niceeval-classic")
    ? "classic"
    : "default";
  return `<${tag}${classAttribute}>${renderChildrenHtml(node.children, tree, route, face, headingLevel + 1, locale, inlineText || tag === "summary", childPresentation)}</${tag}>`;
}

function renderLinkHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
  locale: ReportSiteLocale,
  inlineText: boolean,
  presentation: RenderPresentation,
): string {
  const hrefValue = typeof node.href === "string" ? node.href : undefined;
  const target = closedLinkTarget(hrefValue);
  const href = target === "local" && hrefValue !== undefined
    ? hrefValue.startsWith("#") ? hrefValue : reportHref(route, { kind: "route", route: hrefValue })
    : target === "https" && hrefValue !== undefined ? hrefValue : "#";
  const external = target === "https" ? " target=\"_blank\" rel=\"noopener noreferrer\"" : "";
  return `<a class="niceeval-report__link" href="${escapeHtmlAttribute(href)}"${external}>${renderChildrenHtml(node.children, tree, route, face, headingLevel + 1, locale, inlineText, presentation)}</a>`;
}

function renderChildrenHtml(
  value: unknown,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
  locale: ReportSiteLocale,
  inlineText = false,
  presentation: RenderPresentation = "default",
): string {
  if (!Array.isArray(value)) return unsupportedNodeHtml("unsupported Report children");
  return value.map((child) => renderNodeHtml(child, tree, route, face, headingLevel + 1, locale, inlineText, presentation)).join("");
}

function renderCalloutHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
  locale: ReportSiteLocale,
  presentation: RenderPresentation,
): string {
  const tone = knownTone(node.tone);
  const title = node.title === undefined ? "" : `<h${Math.min(headingLevel, 6)}>${escapeHtmlText(localizedUnknownText(node.title, locale))}</h${Math.min(headingLevel, 6)}>`;
  return `<section class="niceeval-report__callout niceeval-report__callout--${tone}" data-tone="${tone}" role="status">${title}${renderChildrenHtml(node.children, tree, route, face, headingLevel + 1, locale, false, presentation)}</section>`;
}

function renderTableHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  locale: ReportSiteLocale,
  presentation: RenderPresentation,
): string {
  const columns = tableColumns(node.columns, locale);
  const caption = node.caption === undefined ? "" : `<caption>${escapeHtmlText(localizedUnknownText(node.caption, locale))}</caption>`;
  if (columns.length === 0 || !Array.isArray(node.rows)) {
    return `${unsupportedNodeHtml("unsupported table shape")}${renderRowsIssuesHtml(node.issues, tree, route, locale)}`;
  }
  const header = columns.map((column) =>
    `<th scope="col" class="niceeval-report__align-${column.align}">${escapeHtmlText(column.label)}</th>`
  ).join("");
  const body = node.rows.map((row) => {
    const record = dataRecord(row);
    if (record === undefined) {
      return `<tr><td colspan="${columns.length}" data-label="Row">Unsupported table row</td></tr>`;
    }
    return `<tr>${columns.map((column) =>
      `<td class="niceeval-report__align-${column.align}" data-label="${escapeHtmlAttribute(column.label)}">${renderCellHtml(record[column.key], locale, presentation)}</td>`
    ).join("")}</tr>`;
  }).join("");
  return `<section class="niceeval-report__table-section"><div class="niceeval-report__table-wrap"><table class="niceeval-report__table">${caption}<thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>${renderRowsIssuesHtml(node.issues, tree, route, locale)}</section>`;
}

function renderChartHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  locale: ReportSiteLocale,
  presentation: RenderPresentation,
): string {
  const kind = node.type === "bars" ? "Bars" : node.type === "line" ? "Line" : "Scatter";
  const title = node.title === undefined ? kind : localizedUnknownText(node.title, locale);
  const points = Array.isArray(node.points) ? node.points : [];
  const channels = [node.x, node.y, node.color, node.series, node.point]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const fields = orderedPointFields(points, channels);
  if (fields.length === 0) {
    return `<figure class="niceeval-report__chart" data-chart="${kind.toLowerCase()}"><figcaption>${escapeHtmlText(title)} (${kind})</figcaption>${unsupportedNodeHtml("chart has no text-equivalent points")}${renderRowsIssuesHtml(node.issues, tree, route, locale)}</figure>`;
  }
  const header = fields.map((field) => `<th scope="col">${escapeHtmlText(field)}</th>`).join("");
  const body = points.map((point) => {
    const record = dataRecord(point);
    if (record === undefined) return `<tr><td colspan="${fields.length}" data-label="Chart point">Unsupported chart point</td></tr>`;
    return `<tr>${fields.map((field) => `<td data-label="${escapeHtmlAttribute(field)}">${renderCellHtml(record[field], locale, presentation)}</td>`).join("")}</tr>`;
  }).join("");
  const xBetter = typeof node.x === "string" ? chartMetricDirection(points, node.x) : undefined;
  const yBetter = typeof node.y === "string" ? chartMetricDirection(points, node.y) : undefined;
  const chartInput = {
    type: node.type === "bars" || node.type === "line" || node.type === "scatter" ? node.type : "bars",
    title,
    points,
    x: typeof node.x === "string" ? node.x : "x",
    y: typeof node.y === "string" ? node.y : "y",
    ...(typeof node.color === "string" ? { color: node.color } : {}),
    ...(typeof node.series === "string" ? { series: node.series } : {}),
    ...(typeof node.point === "string" ? { point: node.point } : {}),
    ...(node.layout === "horizontal" || node.layout === "vertical"
      ? { layout: node.layout }
      : {}),
    ...(xBetter === undefined ? {} : { xBetter }),
    ...(yBetter === undefined ? {} : { yBetter }),
    ...(presentation === "classic" ? { formatMetrics: true as const, locale } : {}),
  };
  const leaderboard = presentation === "classic"
    ? renderClassicHorizontalBarsHtml(chartInput)
    : undefined;
  const svg = leaderboard === undefined ? renderStaticChartSvg(chartInput) : undefined;
  const visual = leaderboard ?? svg ?? `<p class="niceeval-report__chart-empty">No plottable numeric ${escapeHtmlText(typeof node.y === "string" ? node.y : "y")} values. The closed data table remains available below.</p>`;
  const kindText = leaderboard === undefined ? `${kind} · static SVG` : `${kind} · ranked bars`;
  const classicLeaderboard = leaderboard === undefined ? "" : " niceeval-report__chart--classic-horizontal";
  return `<figure class="niceeval-report__chart niceeval-report__chart--${kind.toLowerCase()}${classicLeaderboard}" data-chart="${kind.toLowerCase()}"><figcaption><span>${escapeHtmlText(title)}</span><span class="niceeval-report__chart-kind">${kindText}</span></figcaption>${visual}<details class="niceeval-report__chart-data"><summary>Data table</summary><div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><caption>${escapeHtmlText(`${title} data table`)}</caption><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div></details>${renderRowsIssuesHtml(node.issues, tree, route, locale)}</figure>`;
}

function chartMetricDirection(
  points: readonly unknown[],
  field: string,
): MetricValue["better"] | undefined {
  let direction: MetricValue["better"] | undefined;
  for (const point of points) {
    const record = dataRecord(point);
    const candidate = record === undefined ? undefined : metricValue(record[field])?.better;
    if (candidate === undefined) continue;
    if (direction !== undefined && direction !== candidate) return undefined;
    direction = candidate;
  }
  return direction;
}

function renderStatHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  locale: ReportSiteLocale,
  presentation: RenderPresentation,
): string {
  const label = localizedUnknownText(node.label, locale);
  const metric = metricValue(node.value);
  if (metric === undefined) return unsupportedNodeHtml(`${label}: unsupported metric`);
  const value = metric.value === null
    ? "—"
    : presentation === "classic"
      ? compactMetricNumber(metric, locale)
      : String(metric.value);
  const displayUnit = presentation === "classic" ? metricDisplayUnit(metric) : metric.unit === undefined ? "" : ` ${metric.unit}`;
  const unit = displayUnit.length === 0 ? "" : `<span class="niceeval-report__metric-unit">${escapeHtmlText(displayUnit)}</span>`;
  const details = presentation === "classic"
    ? classicMetricCoverageSummary(metric, locale)
    : metricCoverageSummary(metric, locale);
  const detailsHtml = details.length === 0 ? "" : `<dd class="niceeval-report__metric-details">${escapeHtmlText(details)}</dd>`;
  return `<dl class="niceeval-report__metric"><div><dt>${escapeHtmlText(label)}</dt><dd><data value="${escapeHtmlAttribute(metric.value === null ? "" : String(metric.value))}">${escapeHtmlText(value)}</data>${unit}</dd>${detailsHtml}</div></dl>`;
}

function renderDownloadHtml(
  node: Readonly<Record<string, unknown>>,
  tree: ClosedReportTree,
  route: string,
  face: RenderFace,
  headingLevel: number,
  locale: ReportSiteLocale,
  presentation: RenderPresentation,
): string {
  const id = typeof node.id === "string" ? node.id : undefined;
  const download = id === undefined ? undefined : tree.downloads.find((candidate) => candidate.id === id);
  if (download === undefined) return unsupportedNodeHtml("closed Download target is unavailable");
  const path = closedDownloadPath(download);
  const href = reportHref(route, { kind: "download", path });
  const label = `Download ${path} (${download.mediaType}, ${download.bytes.byteLength} bytes)`;
  return `<section class="niceeval-report__download"><a href="${escapeHtmlAttribute(href)}" download>${escapeHtmlText(label)}</a>${renderChildrenHtml(node.children, tree, route, face, headingLevel + 1, locale, false, presentation)}</section>`;
}

function renderCellHtml(
  value: unknown,
  locale: ReportSiteLocale,
  presentation: RenderPresentation = "default",
): string {
  const metric = metricValue(value);
  if (metric === undefined) return `<span class="niceeval-report__scalar">${escapeHtmlText(reportClosedValueText(value))}</span>`;
  const numeric = metric.value === null
    ? "—"
    : presentation === "classic"
      ? compactMetricNumber(metric, locale)
      : String(metric.value);
  const displayUnit = presentation === "classic" ? metricDisplayUnit(metric) : metric.unit === undefined ? "" : ` ${metric.unit}`;
  const unit = displayUnit.length === 0 ? "" : `<span class="niceeval-report__metric-unit">${escapeHtmlText(displayUnit)}</span>`;
  const details = presentation === "classic"
    ? classicMetricCoverageSummary(metric, locale)
    : metricCoverageSummary(metric, locale);
  const detailsHtml = details.length === 0 ? "" : `<span class="niceeval-report__metric-meta">${escapeHtmlText(details)}</span>`;
  return `<span class="niceeval-report__metric-value"><data value="${escapeHtmlAttribute(metric.value === null ? "" : String(metric.value))}">${escapeHtmlText(numeric)}</data>${unit}${detailsHtml}</span>`;
}

function metricCoverageSummary(
  metric: MetricValue,
  locale: ReportSiteLocale,
): string {
  const summary = [`${metric.samples} / ${metric.total} ${metric.basis} · ${metric.state}`];
  if (metric.issues.length > 0) {
    summary.push(locale === "zh-CN" ? `${metric.issues.length} 个问题` : `${metric.issues.length} issue${metric.issues.length === 1 ? "" : "s"}`);
  }
  if (metric.refs.length > 0) {
    summary.push(locale === "zh-CN" ? `${metric.refs.length} 条证据` : `${metric.refs.length} evidence ref${metric.refs.length === 1 ? "" : "s"}`);
  }
  return summary.join(" · ");
}

/**
 * A normal classic KPI is deliberately quiet. Its denominator, state, issues,
 * and evidence are still rendered whenever availability is not complete, so a
 * compact strip never turns a partial or unsupported measure into a claim.
 */
function classicMetricCoverageSummary(
  metric: MetricValue,
  locale: ReportSiteLocale,
): string {
  if (metric.state === "available" && metric.issues.length === 0) return "";
  return metricCoverageSummary(metric, locale);
}

function renderRowsIssuesHtml(
  value: unknown,
  tree: ClosedReportTree,
  route: string,
  locale: ReportSiteLocale,
): string {
  const issues = rowsIssues(value);
  if (issues.length === 0) return "";
  const label = locale === "zh-CN" ? "行问题" : "Rows issues";
  return `<aside class="niceeval-report__row-issues" aria-label="${label}"><h2>${label}</h2><ul>${issues.map((issue) => `<li>${renderIssueHtml(issue, tree, route, locale)}</li>`).join("")}</ul></aside>`;
}

function renderIssueHtml(
  issue: AnalysisIssue,
  tree: ClosedReportTree,
  route: string,
  locale: ReportSiteLocale,
): string {
  const refs = issue.refs.length === 0
    ? ""
    : ` <span class="niceeval-report__issue-refs">${issue.refs.map((reference) => renderEvidenceRefHtml(reference, tree, route, locale)).join(", ")}</span>`;
  return `<strong>${escapeHtmlText(issue.code)}</strong>: ${escapeHtmlText(issue.message)}${refs}`;
}

/** Evidence can navigate only to an already closed page; no renderer opens it. */
function renderEvidenceRefHtml(
  reference: EvidenceRef,
  tree: ClosedReportTree,
  sourceRoute: string,
  locale: ReportSiteLocale,
): string {
  const label = evidenceRefText(reference);
  const target = evidencePageRoute(reference, tree);
  if (target === undefined) return `<code class="niceeval-report__evidence-id">${escapeHtmlText(label)}</code>`;
  const prefix = locale === "zh-CN" ? "证据" : "Evidence";
  return `<a class="niceeval-report__evidence-link" href="${escapeHtmlAttribute(reportHref(sourceRoute, { kind: "route", route: target }))}">${prefix} ${escapeHtmlText(label)}</a>`;
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

function renderPageProblems(
  tree: ClosedReportTree,
  page: ClosedReportPage,
  route: string,
  locale: ReportSiteLocale,
): string {
  const ids = new Set(page.problemIds.map(Number));
  const entries = tree.problemTable.filter((entry) => ids.has(Number(entry.id)));
  if (entries.length === 0) return "";
  const label = locale === "zh-CN" ? "页面问题" : "Page problems";
  return `<aside class="niceeval-report__page-problems" aria-label="${label}"><h2>${label}</h2>${renderProblemList(entries, tree, route, locale)}</aside>`;
}

function renderDownloads(tree: ClosedReportTree, sourceRoute: string, locale: ReportSiteLocale): string {
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
  const label = locale === "zh-CN" ? "下载" : "Downloads";
  return `<aside class="niceeval-report__downloads" aria-label="${label}"><h2>${label}</h2><ul>${downloads}</ul></aside>`;
}

function renderProblemList(
  entries: readonly ReportProblemTableEntry[],
  tree: ClosedReportTree,
  route: string,
  locale: ReportSiteLocale,
): string {
  if (entries.length === 0) {
    return `<p class="niceeval-report__no-problems">${locale === "zh-CN" ? "没有问题。" : "No problems."}</p>`;
  }
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
  const source = reportOutputPathForSourceRoute(sourceRoute);
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

/** Host surfaces have output paths but are never author Report routes. */
function reportOutputPathForSourceRoute(sourceRoute: string): readonly string[] | undefined {
  if (sourceRoute === "/_niceeval/problems") {
    return ["_niceeval", "problems", "index.html"];
  }
  return staticPathForRoute(sourceRoute);
}

/** A fixed host asset follows the generated file tree, never server root. */
function reportHostAssetHref(sourceDirectory: readonly string[], assetPath: string): string {
  return relativePath(sourceDirectory, assetPath.split("/"));
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

function tableColumns(
  value: unknown,
  locale: ReportSiteLocale,
): readonly { readonly key: string; readonly label: string; readonly align: "start" | "end" }[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const columns: Array<{ readonly key: string; readonly label: string; readonly align: "start" | "end" }> = [];
  for (const candidate of value) {
    const record = dataRecord(candidate);
    if (record === undefined || typeof record.key !== "string" || record.key.length === 0) continue;
    columns.push(Object.freeze({
      key: record.key,
      label: localizedUnknownText(record.label, locale),
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

function safeElementTag(value: unknown): string | undefined {
  return typeof value === "string" && new Set([
    "article", "aside", "blockquote", "code", "div", "em", "footer", "header",
    "details", "h1", "h2", "h3", "h4", "h5", "h6", "li", "main", "ol", "p", "pre",
    "section", "small", "span", "strong", "summary", "ul",
  ]).has(value) ? value : undefined;
}

function closedElementClasses(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const classes = value.filter((entry): entry is string =>
    typeof entry === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(entry) &&
      !entry.startsWith("niceeval-report")
  );
  return Object.freeze(classes);
}

function isLocalHeadReference(value: string): boolean {
  return value.length > 0 && !value.startsWith("//") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function isScopedClosedCss(value: string): boolean {
  return value.length <= 65_536 && !value.includes("@") && !value.includes("\\") && !value.includes("</") &&
    !/url\s*\(|expression\s*\(|!important/i.test(value) &&
    value.split("}").filter((rule) => rule.trim().length > 0)
      .every((rule) => rule.trimStart().startsWith(".niceeval-report__author "));
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
.niceeval-report[data-niceeval-locale], .niceeval-report[data-niceeval-locale] * { box-sizing: border-box; }
.niceeval-report[data-niceeval-locale] {
  --report-page: var(--niceeval-color-page, #050505);
  --report-panel: var(--niceeval-color-surface, #0b0b0b);
  --report-panel-raised: var(--niceeval-color-surface-subtle, #111111);
  --report-line: var(--niceeval-color-border, #262626);
  --report-line-strong: var(--niceeval-color-border-strong, #343434);
  --report-text: var(--niceeval-color-text, #ededed);
  --report-muted: var(--niceeval-color-text-secondary, #a1a1aa);
  --report-soft: var(--niceeval-color-text-tertiary, #74747b);
  --report-accent: var(--niceeval-color-accent, #cbd6dc);
  --report-focus: var(--niceeval-color-focus, var(--report-accent));
  --report-good: var(--niceeval-color-positive, #3ddc97);
  --report-warn: var(--niceeval-color-warning, #e8b84a);
  --report-bad: var(--niceeval-color-negative, #ff6b6b);
  min-height: 100vh;
  background: var(--report-page);
  color: var(--report-text);
  font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif);
  font-size: var(--niceeval-font-size, 14px);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.niceeval-report[data-niceeval-locale] :focus-visible { outline: 2px solid var(--report-focus); outline-offset: 3px; }
.niceeval-report[data-niceeval-locale] a { color: inherit; text-decoration-thickness: .08em; text-underline-offset: .16em; }
.niceeval-report__topbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
  min-height: 64px;
  padding: 0 clamp(20px, 5vw, 80px);
  border-bottom: 1px solid var(--report-line);
  background: var(--report-page);
  position: sticky;
  top: 0;
  z-index: 10;
}
.niceeval-report__brand {
  display: inline-flex;
  align-items: baseline;
  justify-self: start;
  gap: .75rem;
  color: var(--report-text) !important;
  font-size: 1.25rem;
  font-weight: 690;
  text-decoration: none;
}
.niceeval-report__brand-mark { width: 18px; height: 18px; border: 1.25px solid currentColor; transform: rotate(45deg); }
.niceeval-report__site-navigation { min-width: 0; }
.niceeval-report__site-navigation ul { display: flex; align-items: center; justify-content: center; gap: 1.35rem; margin: 0; padding: 0; list-style: none; }
.niceeval-report__site-navigation a { display: inline-flex; min-block-size: 2rem; align-items: center; color: var(--report-muted) !important; font-size: .875rem; font-weight: 600; text-decoration: none; }
.niceeval-report__site-navigation a:hover, .niceeval-report__site-navigation a[aria-current="page"] { color: var(--report-text) !important; }
.niceeval-report__language { display: inline-flex; align-items: center; justify-self: end; overflow: hidden; border: 1px solid var(--report-line); background: var(--report-panel); }
.niceeval-report__language button { min-width: 44px; height: 30px; border: 0; border-inline-end: 1px solid var(--report-line); background: transparent; color: var(--report-muted); font: inherit; font-size: .75rem; line-height: 1; cursor: pointer; }
.niceeval-report__language button:last-child { border-inline-end: 0; }
.niceeval-report__language button:hover, .niceeval-report__language button[aria-pressed="true"] { background: var(--report-panel-raised); color: var(--report-text); font-weight: 620; }
.niceeval-report__site-main { width: min(1120px, calc(100vw - 40px)); margin: 0 auto; padding: clamp(52px, 7vw, 82px) 0 72px; }
.niceeval-report__document, .niceeval-report__text {
  display: block;
  width: 100%;
  margin: 0 auto;
}
.niceeval-report__text { max-width: 96ch; white-space: pre-wrap; font-family: var(--niceeval-font-mono, ui-monospace, monospace); }
.niceeval-report__document-header { max-width: 76ch; padding-bottom: clamp(1.4rem, 4vw, 3rem); }
.niceeval-report[data-niceeval-locale] h1, .niceeval-report[data-niceeval-locale] h2, .niceeval-report[data-niceeval-locale] h3, .niceeval-report[data-niceeval-locale] h4, .niceeval-report[data-niceeval-locale] h5, .niceeval-report[data-niceeval-locale] h6 { margin: 0; color: var(--report-text); line-height: 1.15; }
.niceeval-report[data-niceeval-locale] h1 { font-size: clamp(2rem, 5vw, 3.65rem); letter-spacing: -.04em; }
.niceeval-report[data-niceeval-locale] h2 { font-size: clamp(1.08rem, 2vw, 1.32rem); }
.niceeval-report__author { display: grid; gap: clamp(.85rem, 2vw, 1.25rem); }
.niceeval-report__paragraph { max-width: 76ch; margin: 0; color: var(--report-text); white-space: pre-wrap; }
.niceeval-report__stack { display: grid; gap: clamp(.7rem, 1.8vw, 1.1rem); }
.niceeval-report__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--report-line); border-radius: max(.45rem, var(--niceeval-radius, .5rem)); background: var(--report-line); }
.niceeval-report__grid > * { min-width: 0; margin: 0; padding: clamp(.85rem, 2.3vw, 1.2rem); background: var(--report-panel); }
.niceeval-report__callout { margin: 0; padding: clamp(.85rem, 2.3vw, 1.2rem); border: 1px solid var(--report-line); border-inline-start: 3px solid var(--report-line-strong); border-radius: max(.45rem, var(--niceeval-radius, .5rem)); background: var(--report-panel-raised); }
.niceeval-report__callout > h2, .niceeval-report__callout > h3, .niceeval-report__callout > h4, .niceeval-report__callout > h5, .niceeval-report__callout > h6 { margin-bottom: .6rem; }
.niceeval-report__callout--positive { border-inline-start-color: var(--report-good); }
.niceeval-report__callout--warning { border-inline-start-color: var(--report-warn); }
.niceeval-report__callout--negative { border-inline-start-color: var(--report-bad); }
.niceeval-report__table-section, .niceeval-report__chart { min-width: 0; margin: 0; padding: clamp(.85rem, 2.3vw, 1.2rem); border: 1px solid var(--report-line); border-radius: max(.45rem, var(--niceeval-radius, .5rem)); background: var(--report-panel); }
.niceeval-report__table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--report-line); border-radius: calc(max(.45rem, var(--niceeval-radius, .5rem)) * .75); }
.niceeval-report__table { width: 100%; min-width: 32rem; border-collapse: collapse; background: var(--report-panel); }
.niceeval-report__table caption { padding: .75rem .9rem; color: var(--report-muted); font-size: .82em; font-weight: 700; letter-spacing: .045em; text-align: left; text-transform: uppercase; }
.niceeval-report__table th, .niceeval-report__table td { padding: .78rem .85rem; border-bottom: 1px solid var(--report-line); color: var(--report-text); vertical-align: top; text-align: start; }
.niceeval-report__table th { color: var(--report-muted); background: var(--report-panel-raised); font-size: .76em; font-weight: 750; letter-spacing: .055em; text-transform: uppercase; }
.niceeval-report__table tbody tr:hover { background: color-mix(in oklch, var(--report-accent), transparent 95%); }
.niceeval-report__table tbody tr:last-child td { border-bottom: 0; }
.niceeval-report__align-end { text-align: end !important; font-variant-numeric: tabular-nums; }
.niceeval-report__metric { margin: 0; padding: 1rem; border: 1px solid var(--report-line); border-radius: max(.45rem, var(--niceeval-radius, .5rem)); background: var(--report-panel); }
.niceeval-report__metric dt { color: var(--report-soft); font-size: .73em; font-weight: 720; letter-spacing: .065em; text-transform: uppercase; }
.niceeval-report__metric dd { margin: .35rem 0 0; font-variant-numeric: tabular-nums; }
.niceeval-report__metric dd:first-of-type { font-size: clamp(1.35rem, 3vw, 2rem); font-weight: 750; letter-spacing: -.035em; line-height: 1.05; }
.niceeval-report__metric-value { display: grid; gap: .22rem; min-width: max-content; font-variant-numeric: tabular-nums; }
.niceeval-report__metric-meta, .niceeval-report__metric-details, .niceeval-report__metric-unit, .niceeval-report__chart-kind { color: var(--report-muted); font-size: .84em; }
.niceeval-report__download { margin: 0; padding: .85rem 1rem; border: 1px solid color-mix(in oklch, var(--report-accent), var(--report-line) 58%); border-radius: max(.45rem, var(--niceeval-radius, .5rem)); background: color-mix(in oklch, var(--report-accent), var(--report-panel) 94%); }
.niceeval-report__download > a { color: var(--report-accent); font-weight: 700; }
.niceeval-report__issues, .niceeval-report__evidence { margin: .55rem 0 0; padding-inline-start: 1.25rem; }
.niceeval-report__issues { color: var(--report-warn); }
.niceeval-report__evidence-id { font-family: var(--niceeval-font-mono, ui-monospace, monospace); }
.niceeval-report__chart { display: grid; gap: .85rem; }
.niceeval-report__chart figcaption { display: flex; flex-wrap: wrap; gap: .35rem .65rem; align-items: baseline; color: var(--report-text); font-size: .94rem; font-weight: 740; }
.niceeval-report__chart-svg { display: block; width: 100%; min-height: 13rem; overflow: visible; border: 1px solid var(--report-line); border-radius: calc(max(.45rem, var(--niceeval-radius, .5rem)) * .8); background: color-mix(in oklch, var(--report-panel-raised), var(--report-panel) 54%); }
.niceeval-report__chart-grid-line { stroke: var(--report-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.niceeval-report__chart-axis { stroke: var(--report-line-strong); stroke-width: 1; vector-effect: non-scaling-stroke; }
.niceeval-report__chart-tick, .niceeval-report__chart-axis-title, .niceeval-report__chart-legend-item text, .niceeval-report__chart-better-hint { fill: var(--report-muted); font-family: var(--niceeval-font-sans, ui-sans-serif, system-ui, sans-serif); font-size: 11px; }
.niceeval-report__chart-axis-title { font-size: 12px; font-weight: 650; }
.niceeval-report__chart-legend-marker, .niceeval-report__chart-bar { fill: var(--report-muted); }
.niceeval-report__chart-line { fill: none; stroke: var(--report-muted); stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.niceeval-report__chart-point { fill: var(--report-panel); stroke: var(--report-muted); stroke-width: 2; vector-effect: non-scaling-stroke; }
.niceeval-report__chart-series-0 { --report-chart-series: var(--niceeval-color-series-1, #3987e5); }
.niceeval-report__chart-series-1 { --report-chart-series: var(--niceeval-color-series-2, #199e70); }
.niceeval-report__chart-series-2 { --report-chart-series: var(--niceeval-color-series-3, #c98500); }
.niceeval-report__chart-series-3 { --report-chart-series: var(--niceeval-color-series-4, #008300); }
.niceeval-report__chart-series-4 { --report-chart-series: var(--niceeval-color-series-5, #e66767); }
.niceeval-report__chart-series-5 { --report-chart-series: var(--niceeval-color-series-6, #d95926); }
.niceeval-report__chart-legend-marker[class*="niceeval-report__chart-series"], .niceeval-report__chart-bar[class*="niceeval-report__chart-series"] { fill: var(--report-chart-series); }
.niceeval-report__chart-line[class*="niceeval-report__chart-series"] { stroke: var(--report-chart-series); }
.niceeval-report__chart-point[class*="niceeval-report__chart-series"] { stroke: var(--report-chart-series); }
.niceeval-report__chart-data { min-width: 0; }
.niceeval-report__chart-data > summary { width: fit-content; color: var(--report-muted); cursor: pointer; font-size: .84em; font-weight: 700; }
.niceeval-report__chart-data[open] > summary { margin-bottom: .65rem; color: var(--report-text); }
.niceeval-report__chart-empty { margin: 0; padding: .75rem .9rem; border-inline-start: 3px solid var(--report-warn); color: var(--report-muted); background: var(--report-panel-raised); }
.niceeval-report__row-issues, .niceeval-report__page-problems, .niceeval-report__downloads, .niceeval-report__unsupported { margin: 0; padding: .9rem 1rem; border: 1px solid var(--report-line); border-radius: max(.45rem, var(--niceeval-radius, .5rem)); background: var(--report-panel-raised); }
.niceeval-report__unsupported { color: var(--report-warn); }
.niceeval-report__problems { margin: 0; padding-inline-start: 1.5rem; }
.niceeval-report__problems li + li { margin-top: .75rem; }
@media (max-width: 44rem) {
  .niceeval-report__topbar { grid-template-columns: minmax(0, 1fr) auto; padding-inline: 20px; }
  .niceeval-report__site-navigation { display: none; }
  .niceeval-report__language button { min-width: 40px; }
  .niceeval-report__site-main { width: min(1120px, calc(100vw - 28px)); padding-top: 42px; }
  .niceeval-report__grid { grid-template-columns: minmax(0, 1fr); }
  .niceeval-report__table-wrap { overflow-x: visible; border: 0; }
  .niceeval-report__table { display: block; min-width: 0; }
  .niceeval-report__table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .niceeval-report__table tbody { display: grid; gap: .65rem; }
  .niceeval-report__table tbody tr { display: grid; gap: .15rem; padding: .65rem .75rem; border: 1px solid var(--report-line); border-radius: calc(max(.45rem, var(--niceeval-radius, .5rem)) * .75); background: var(--report-panel); }
  .niceeval-report__table tbody td { display: grid; grid-template-columns: minmax(6.5rem, .72fr) minmax(0, 1.28fr); gap: .65rem; min-width: 0; padding: .2rem 0; border: 0; overflow-wrap: anywhere; word-break: break-word; }
  .niceeval-report__table tbody td::before { color: var(--report-soft); content: attr(data-label); font-size: .72em; font-weight: 720; letter-spacing: .055em; text-transform: uppercase; }
  .niceeval-report__table tbody td[colspan] { display: block; }
  .niceeval-report__table tbody td[colspan]::before { content: none; }
  .niceeval-report__table .niceeval-report__align-end { text-align: start !important; }
  .niceeval-report__chart-svg { min-height: 11rem; }
}
@media (prefers-reduced-motion: reduce) {
  .niceeval-report *, .niceeval-report *::before, .niceeval-report *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`;
