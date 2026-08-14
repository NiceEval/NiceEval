import {
  isReportDownloadPath,
  isReportRoute,
  staticPathForReportDownload,
  staticPathForReportRoute,
  type ReportRoute,
} from "../author/identity.ts";
import { formatAxisTick, formatInstant, shortestUniqueLabels } from "../classic/format.ts";
import { paddedAxisDomain, ticksInDomain, tickStepOf } from "../model/chart/math.ts";
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
  REPORT_ENHANCE_SCRIPT,
  REPORT_FRAGMENT_HEADER,
  REPORT_LOCALE_HEADER,
} from "./html-enhance.ts";
import {
  REPORT_CLASSIC_STYLESHEET,
  REPORT_HTML_STYLESHEET,
  REPORT_LIVE_STYLESHEET,
} from "./html-styles.ts";
import {
  basalt,
  themeStylesheet,
  type ThemeDefinition,
} from "./theme.ts";

export { REPORT_FRAGMENT_HEADER, REPORT_LOCALE_HEADER };

export type ReportViewLocale = "en" | "zh-CN";
export type ReportHrefMode = "relative" | "root";

export interface ReportHtmlHostMetadata {
  readonly revision?: number;
  readonly lastRebuildProblem?: string;
}

/**
 * Closed document for another locale on the same ordinary route.
 * Static hosts may embed zh-CN here; they must not copy the canonical route.
 */
export interface ReportHtmlLocaleDocument {
  readonly locale: ReportViewLocale;
  readonly document: ReportDocument;
}

export type RenderReportHtmlInput =
  | {
    readonly document: ReportDocument;
    readonly locale?: ReportViewLocale;
    /** The rendered document's semantic route, used for package-owned links. */
    readonly route: ReportRoute;
    /** Fixed host facts are metadata, never author-page body content. */
    readonly hostMetadata?: ReportHtmlHostMetadata;
    /** Omission deliberately means the host's closed Basalt default. */
    readonly theme?: ThemeDefinition;
    /**
     * Additive: embed other already-closed locale documents in this route.
     * Existing single-execution callers omit this and stay English-only.
     */
    readonly localeDocuments?: readonly ReportHtmlLocaleDocument[];
  }
  | {
    /** Reserved host surfaces may use a safe text projection. */
    readonly text: string;
    readonly locale?: ReportViewLocale;
    /** Omission deliberately means the host's closed Basalt default. */
    readonly theme?: ThemeDefinition;
  };

export interface ReportLiveNavigationItem {
  readonly pageId: string;
  readonly title: string;
  readonly route: ReportRoute;
  readonly state: "rendered" | "data-unavailable" | "execution-failed";
  readonly document?: ReportDocument;
}

/**
 * A completed locale execution already rendered by the host. Language clicks
 * prefer a same-revision fragment request; hosts may also pass these so the
 * shell can swap without a round-trip. The browser never recomputes business.
 */
export interface ReportLiveLocaleRevision {
  readonly locale: ReportViewLocale;
  readonly title: string;
  readonly navigation: readonly ReportLiveNavigationItem[];
  /** Localized document of the live URL when that route is a direct/family page. */
  readonly currentDocument?: ReportDocument;
  readonly currentRoute?: ReportRoute;
}

export interface RenderReportLiveHtmlInput {
  readonly title: string;
  readonly locale?: ReportViewLocale;
  readonly revision: number;
  readonly currentRoute: ReportRoute;
  readonly currentDocument?: ReportDocument;
  readonly navigation: readonly ReportLiveNavigationItem[];
  readonly hostMetadata?: ReportHtmlHostMetadata;
  readonly theme?: ThemeDefinition;
  /**
   * Additive: embed other closed locale revisions. Existing single-execution
   * callers omit this. Prefer live language clicks to request
   * {@link REPORT_FRAGMENT_HEADER} + {@link REPORT_LOCALE_HEADER} on the
   * current URL and replace navigation HTML from
   * {@link renderReportLocaleSwitchPayload}.
   */
  readonly localeRevisions?: readonly ReportLiveLocaleRevision[];
}

export interface ReportDialogFragmentPayload {
  readonly revision: number;
  readonly title: string;
  readonly html: string;
  readonly locale?: ReportViewLocale;
}

export interface ReportLocaleSwitchNavigationItem {
  readonly pageId?: string;
  readonly title: string;
  /** Semantic route or static path; the enhance runtime applies items by declaration order. */
  readonly route?: string | ReportRoute;
  readonly state?: ReportLiveNavigationItem["state"];
  readonly html: string;
}

/**
 * One JSON body for both live language apply and dialog open.
 *
 * Host GET of the current URL with {@link REPORT_FRAGMENT_HEADER} +
 * {@link REPORT_LOCALE_HEADER} must return a completed locale execution:
 *
 * - `revision` — must match the live shell or the page reloads
 * - `locale` — `en` | `zh-CN`
 * - `title` / `html` — the requested route's localized document
 * - `navigation` — every fixed sample page, author declaration order
 *
 * Consumers:
 * - Language apply (`applyNavigation`): writes `navigation` into tab labels
 *   and tabpanels by index; if `[data-niceeval-direct-page]` is visible
 *   (family / exact-route live page), also replaces that section with
 *   `html` and sets `document.title` from `title`. It never leaves the
 *   direct section on the previous locale. URL and hierarchy
 *   key/route context are preserved.
 * - Dialog apply: reads only `title` and `html`. Extra `navigation` is ignored.
 *
 * Fragment renderers must receive the execution `locale`. Package-owned copy
 * (Hero last-run line, Filter/Clear, Close, Language) is selected from that
 * locale; a zh-CN execution must not emit English host chrome.
 */
export interface ReportLocaleSwitchPayload {
  readonly revision: number;
  readonly locale: ReportViewLocale;
  readonly title: string;
  readonly html: string;
  readonly navigation: readonly ReportLocaleSwitchNavigationItem[];
}

const BRAND_HREF = "https://niceeval.com/?utm_source=report&utm_medium=brand";
const POWERED_HREF = "https://niceeval.com/?utm_source=report&utm_medium=powered";

type ReportLinkTarget = Extract<ReportInline, { readonly type: "link" }>["target"];

interface RenderContext {
  readonly route: ReportRoute;
  readonly hrefMode: ReportHrefMode;
  readonly classic: boolean;
  readonly locale: ReportViewLocale;
}

interface PackageCopy {
  readonly language: string;
  readonly reportPages: string;
  readonly reportLinks: string;
  readonly poweredBy: string;
  readonly noRuns: string;
  readonly lastRun: (when: string) => string;
  readonly composedFrom: (count: number) => string;
  readonly filter: string;
  readonly clear: string;
  readonly noMatch: string;
  readonly close: string;
  readonly higherBetter: string;
  readonly lowerBetter: string;
  readonly accessibleValues: (title: string) => string;
  readonly seriesKey: string;
  readonly betterHint: string;
  readonly summary: string;
  readonly lastRunLabel: string;
  readonly experimentHierarchy: string;
  readonly children: (label: string) => string;
  readonly pageState: (state: string) => string;
}

const PACKAGE_COPY_EN: PackageCopy = Object.freeze({
  language: "Language",
  reportPages: "Report pages",
  reportLinks: "Report links",
  poweredBy: "Powered by NiceEval",
  noRuns: "No runs yet",
  lastRun: (when: string) => `Last run ${when}`,
  composedFrom: (count: number) => `composed from ${count} runs`,
  filter: "Filter",
  clear: "Clear",
  noMatch: "No matching experiments",
  close: "Close",
  higherBetter: "Higher is better",
  lowerBetter: "Lower is better",
  accessibleValues: (title: string) => `Accessible values for ${title}`,
  seriesKey: "Series key",
  betterHint: "better → upper right",
  summary: "Summary",
  lastRunLabel: "Last run",
  experimentHierarchy: "Experiment hierarchy",
  children: (label: string) => `${label} children`,
  pageState: (state: string) => `Page ${state}`,
});

const PACKAGE_COPY_ZH: PackageCopy = Object.freeze({
  language: "语言",
  reportPages: "报告页面",
  reportLinks: "报告链接",
  poweredBy: "由 NiceEval 提供",
  noRuns: "还没有运行",
  lastRun: (when: string) => `上次运行 ${when}`,
  composedFrom: (count: number) => `由 ${count} 次运行组成`,
  filter: "筛选",
  clear: "清除",
  noMatch: "没有匹配的实验",
  close: "关闭",
  higherBetter: "越高越好",
  lowerBetter: "越低越好",
  accessibleValues: (title: string) => `${title} 的可访问数值`,
  seriesKey: "系列图例",
  betterHint: "更好 → 右上",
  summary: "摘要",
  lastRunLabel: "上次运行",
  experimentHierarchy: "实验层级",
  children: (label: string) => `${label} 的子项`,
  pageState: (state: string) => `页面 ${state}`,
});

function packageCopy(locale: ReportViewLocale): PackageCopy {
  return locale === "zh-CN" ? PACKAGE_COPY_ZH : PACKAGE_COPY_EN;
}

/**
 * The sole HTML shell for a fixed Report projection. Author pages render the
 * validated closed semantic tree; reserved host surfaces retain a text-only
 * escape hatch. The stylesheet structure and every emitted element are
 * package-owned, while a Theme contributes only validated token values.
 */
export function renderReportHtml(input: RenderReportHtmlInput): string {
  const theme = input.theme ?? basalt;
  const semantic = "document" in input;
  const locale = input.locale ?? "en";
  const title = semantic ? input.document.title : "NiceEval report";
  const metadata = semantic ? renderHostMetadata(input.hostMetadata) : "";
  const classic = semantic && isClassicDocument(input.document);
  const content = semantic
    ? renderDocument(input.document, { route: input.route, hrefMode: "relative", classic, locale })
    : `<pre class="niceeval-report__text">${escapeHtml(input.text)}</pre>`;
  const localeDocuments = semantic ? input.localeDocuments ?? [] : [];
  const templates = classic
    ? localeDocuments
      .filter((item) => item.locale !== locale)
      .map((item) =>
        `<template data-niceeval-locale-document="${item.locale}">${
          renderDocument(item.document, {
            route: input.route,
            hrefMode: "relative",
            classic: isClassicDocument(item.document),
            locale: item.locale,
          })
        }</template>`
      )
      .join("")
    : "";
  const styles = `${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}${classic ? REPORT_CLASSIC_STYLESHEET : ""}`;
  const enhance = classic ? `<script>${REPORT_ENHANCE_SCRIPT}</script>` : "";
  if (classic) {
    return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${metadata}<style>${styles}</style></head><body><div class="niceeval-report niceeval-report--classic">${renderClassicBanner(locale)}<main>${content}</main>${templates}</div>${enhance}</body></html>`;
  }
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${metadata}<style>${styles}</style></head><body><main class="niceeval-report">${content}</main>${enhance}</body></html>`;
}

/**
 * Package-owned fragment renderer used by the live shell for the same closed document.
 * Hosts must pass the execution `locale` so package copy (Hero meta, Filter, Close)
 * matches that execution. Omission keeps English copy.
 */
export function renderReportDocumentFragment(input: {
  readonly document: ReportDocument;
  readonly route: ReportRoute;
  readonly hrefMode?: ReportHrefMode;
  readonly locale?: ReportViewLocale;
}): string {
  return renderDocument(input.document, {
    route: input.route,
    hrefMode: input.hrefMode ?? "relative",
    classic: isClassicDocument(input.document),
    locale: input.locale ?? "en",
  });
}

export function renderReportDialogFragmentPayload(input: {
  readonly revision: number;
  readonly document: ReportDocument;
  readonly route: ReportRoute;
  readonly hrefMode?: ReportHrefMode;
  readonly locale?: ReportViewLocale;
}): ReportDialogFragmentPayload {
  return Object.freeze({
    revision: input.revision,
    title: input.document.title,
    html: renderReportDocumentFragment({
      document: input.document,
      route: input.route,
      hrefMode: input.hrefMode,
      locale: input.locale,
    }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
  });
}

/**
 * Host helper: render one completed locale execution as the live language-switch
 * payload. Do not recompute Sample, projection, or page topology here.
 */
export function renderReportLocaleSwitchPayload(input: {
  readonly revision: number;
  readonly locale: ReportViewLocale;
  readonly title: string;
  readonly navigation: readonly ReportLiveNavigationItem[];
  readonly hrefMode?: ReportHrefMode;
  readonly currentRoute?: ReportRoute;
  readonly currentDocument?: ReportDocument;
}): ReportLocaleSwitchPayload {
  const hrefMode = input.hrefMode ?? "root";
  const current = input.currentDocument !== undefined && input.currentRoute !== undefined
    ? renderDocument(input.currentDocument, {
      route: input.currentRoute,
      hrefMode,
      classic: isClassicDocument(input.currentDocument),
      locale: input.locale,
    })
    : "";
  return Object.freeze({
    revision: input.revision,
    locale: input.locale,
    title: input.currentDocument?.title ?? input.title,
    html: current,
    navigation: Object.freeze(input.navigation.map((item) => Object.freeze({
      pageId: item.pageId,
      title: item.title,
      route: `/${staticPathForReportRoute(item.route).posix}`,
      state: item.state,
      html: renderNavigationBody(item, hrefMode, input.locale),
    }))),
  });
}

/** One live shell over fixed documents from the same immutable execution revision. */
export function renderReportLiveHtml(input: RenderReportLiveHtmlInput): string {
  const theme = input.theme ?? basalt;
  const locale = input.locale ?? "en";
  const classic = isClassicLive(input);
  const selectedIndex = input.navigation.findIndex((item) => item.route === input.currentRoute);
  const tabs = renderLiveTabs(input.navigation, selectedIndex);
  const panels = input.navigation.map((item, index) => {
    const selected = index === selectedIndex;
    return `<section role="tabpanel" id="niceeval-panel-${index}" aria-labelledby="niceeval-tab-${index}" data-niceeval-panel="${index}"${selected ? "" : " hidden"}>${renderNavigationBody(item, "root", locale)}</section>`;
  }).join("");
  const direct = selectedIndex < 0 && input.currentDocument !== undefined
    ? `<section data-niceeval-direct-page>${
      renderDocument(input.currentDocument, {
        route: input.currentRoute,
        hrefMode: "root",
        classic: isClassicDocument(input.currentDocument),
        locale,
      })
    }</section>`
    : "";
  const metadata = renderHostMetadata({
    ...input.hostMetadata,
    revision: input.revision,
  });
  const localePayloads = (input.localeRevisions ?? [])
    .filter((item) => item.locale !== locale)
    .map((item) =>
      `<script type="application/json" data-niceeval-locale-payload="${item.locale}">${
        jsonForScript(renderReportLocaleSwitchPayload({
          revision: input.revision,
          locale: item.locale,
          title: item.title,
          navigation: item.navigation,
          hrefMode: "root",
          ...(item.currentRoute === undefined ? {} : { currentRoute: item.currentRoute }),
          ...(item.currentDocument === undefined ? {} : { currentDocument: item.currentDocument }),
        }))
      }</script>`
    )
    .join("");
  const styles = `${themeStylesheet(theme)}${REPORT_HTML_STYLESHEET}${REPORT_LIVE_STYLESHEET}${
    classic ? REPORT_CLASSIC_STYLESHEET : ""
  }`;
  const copy = packageCopy(locale);
  const close = `<button type="button" data-niceeval-dialog-close data-niceeval-copy="close">${escapeHtml(copy.close)}</button>`;
  const shell = classic
    ? `<div class="niceeval-report niceeval-report--live niceeval-report--classic">${
      renderClassicBanner(locale, tabs)
    }<main>${panels}${direct}<dialog class="niceeval-report__dialog" aria-modal="true"><div data-niceeval-dialog-content></div>${close}</dialog></main>${localePayloads}</div>`
    : `<main class="niceeval-report niceeval-report--live"><div role="tablist" aria-label="${escapeHtml(copy.reportPages)}" class="niceeval-report__tabs" data-niceeval-copy="reportPages">${tabs}</div>${panels}${direct}<dialog class="niceeval-report__dialog" aria-modal="true"><div data-niceeval-dialog-content></div>${close}</dialog></main>`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>${metadata}<style>${styles}</style></head><body>${shell}<script>${REPORT_ENHANCE_SCRIPT}</script></body></html>`;
}

function renderLiveTabs(
  navigation: readonly ReportLiveNavigationItem[],
  selectedIndex: number,
): string {
  return navigation.map((item, index) => {
    const selected = index === selectedIndex;
    return `<button type="button" role="tab" id="niceeval-tab-${index}" aria-controls="niceeval-panel-${index}" aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}" data-niceeval-tab="${index}" data-niceeval-route="/${escapeHtml(staticPathForReportRoute(item.route).posix)}">${escapeHtml(item.title)}</button>`;
  }).join("");
}

function renderNavigationBody(
  item: ReportLiveNavigationItem,
  hrefMode: ReportHrefMode,
  locale: ReportViewLocale,
): string {
  if (item.state === "rendered" && item.document !== undefined) {
    return renderDocument(item.document, {
      route: item.route,
      hrefMode,
      classic: isClassicDocument(item.document),
      locale,
    });
  }
  return `<article class="niceeval-report__document"><header class="niceeval-report__document-header"><h1>${escapeHtml(item.title)}</h1></header><p role="status">${escapeHtml(packageCopy(locale).pageState(item.state))}</p></article>`;
}

function renderClassicBanner(locale: ReportViewLocale, tabs = ""): string {
  const copy = packageCopy(locale);
  const tablist = tabs.length === 0
    ? ""
    : `<div role="tablist" aria-label="${escapeHtml(copy.reportPages)}" class="niceeval-report__tabs" data-niceeval-copy="reportPages">${tabs}</div>`;
  return `<header role="banner" class="niceeval-report__banner"><a class="niceeval-report__brand" href="${BRAND_HREF}" target="_blank" rel="noopener"><span class="niceeval-report__brand-mark" aria-hidden="true"></span><span>NiceEval</span></a>${tablist}<div class="niceeval-report__language" role="group" aria-label="${escapeHtml(copy.language)}" data-niceeval-copy="language"><button type="button" data-niceeval-locale="en" aria-pressed="${locale === "en"}">EN</button><button type="button" data-niceeval-locale="zh-CN" aria-pressed="${locale === "zh-CN"}">中文</button></div></header>`;
}

function isClassicDocument(document: ReportDocument): boolean {
  return document.presentation === "classic-dashboard";
}

function isClassicLive(input: RenderReportLiveHtmlInput): boolean {
  if (input.currentDocument !== undefined && isClassicDocument(input.currentDocument)) return true;
  return input.navigation.some((item) => item.document !== undefined && isClassicDocument(item.document));
}

function hasHeroTitle(document: ReportDocument): boolean {
  return document.children.some((block) => block.type === "hero" && block.title !== undefined);
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

function renderDocument(document: ReportDocument, ctx: RenderContext): string {
  const dashboardClass = document.presentation === "classic-dashboard"
    ? " niceeval-report__document--classic-dashboard"
    : "";
  const skipTitle = ctx.classic && hasHeroTitle(document);
  const header = skipTitle
    ? ""
    : `<header class="niceeval-report__document-header"><h1>${escapeHtml(document.title)}</h1></header>`;
  return `<article class="niceeval-report__document${dashboardClass}">${header}${
    document.children.map((block) => renderBlock(block, ctx, 2)).join("")
  }</article>`;
}

function renderBlock(block: ReportBlock, ctx: RenderContext, headingLevel: number): string {
  switch (block.type) {
    case "section": {
      const level = Math.min(headingLevel, 6);
      const meta = block.meta === undefined ? "" : `<p class="niceeval-report__section-meta">${escapeHtml(block.meta)}</p>`;
      return `<section class="niceeval-report__section"><h${level}>${escapeHtml(block.heading)}</h${level}>${meta}${
        block.children.map((child) => renderBlock(child, ctx, level + 1)).join("")
      }</section>`;
    }
    case "paragraph":
      return `<p class="niceeval-report__paragraph">${renderInlines(block.children, ctx)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag} class="niceeval-report__list">${
        block.items.map((item) => `<li>${item.map((child) => renderBlock(child, ctx, headingLevel)).join("")}</li>`).join("")
      }</${tag}>`;
    }
    case "table":
      return `<div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><caption>${escapeHtml(block.caption)}</caption><thead><tr>${
        block.columns.map((column) =>
          `<th scope="col" class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(column.label)}</th>`
        ).join("")
      }</tr></thead><tbody>${
        block.rows.map((row) =>
          `<tr>${
            block.columns.map((column) =>
              `<td class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(scalarText(row[column.key]!))}</td>`
            ).join("")
          }</tr>`
        ).join("")
      }</tbody></table></div>`;
    case "metric": {
      const value = scalarText(block.value);
      return `<dl class="niceeval-report__metric"><div><dt>${escapeHtml(block.label)}</dt><dd><data value="${escapeHtml(value)}">${escapeHtml(value)}</data>${
        block.unit === undefined ? "" : ` <span class="niceeval-report__metric-unit">${escapeHtml(block.unit)}</span>`
      }</dd></div></dl>`;
    }
    case "status": {
      const tone = statusTone(block.tone);
      return `<p class="niceeval-report__status niceeval-report__status--${tone}" data-tone="${tone}" role="status"><strong>${escapeHtml(block.label)}</strong>${
        block.detail === undefined ? "" : ` <span class="niceeval-report__status-detail">${renderInlines(block.detail, ctx)}</span>`
      }</p>`;
    }
    case "code-block":
      return `<pre class="niceeval-report__code-block"><code${
        block.language === undefined ? "" : ` data-language="${escapeHtml(block.language)}"`
      }>${escapeHtml(block.value)}</code></pre>`;
    case "chart":
      return renderChart(block);
    case "hero":
      return renderHero(block, ctx);
    case "summary":
      return renderSummary(block, ctx);
    case "ranked-bars":
      return renderRankedBars(block, ctx);
    case "scatter":
      return renderScatter(block, ctx);
    case "tree-table":
      return renderTreeTable(block, ctx);
    case "grid":
      return `<div class="niceeval-report__grid">${block.cells.map((cell) => renderBlock(cell, ctx, headingLevel)).join("")}</div>`;
    case "stat":
      return `<dl class="niceeval-report__stat"><div><dt>${escapeHtml(block.label)}</dt><dd>${renderStatValue(block.value, ctx.classic)}</dd></div></dl>`;
    case "cell-table": {
      if (block.hierarchy === true) {
        return renderCellTableHierarchy(block, ctx);
      }
      const headings = block.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("");
      const rows = block.rows.map((row) =>
        `<tr>${block.columns.map((column) => `<td>${escapeHtml(row.cells[column] ?? "—")}</td>`).join("")}</tr>`
      ).join("");
      return `<div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }
}

function renderStatValue(value: string, classic: boolean): string {
  const escaped = escapeHtml(value);
  if (!classic) return escaped;
  return escaped
    .replace(/(\d+)\s+passed/g, '<span class="niceeval-report__stat-good">$1 passed</span>')
    .replace(/(\d+)\s+failed/g, '<span class="niceeval-report__stat-bad">$1 failed</span>');
}

function renderCellTableHierarchy(
  block: Extract<ReportBlock, { readonly type: "cell-table" }>,
  ctx: RenderContext,
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
      const content = index === 0 && row.target !== undefined
        ? `<a ${reportLinkAttributes(ctx, row.target)}>${escapeHtml(label)}</a>`
        : escapeHtml(label);
      return `<span role="cell" class="niceeval-report__hierarchy-cell${index === 0 ? " niceeval-report__hierarchy-cell--label" : ""}">${content}</span>`;
    }).join("");
    const rowContent = `<span role="row" class="niceeval-report__hierarchy-row" data-kind="${escapeHtml(row.kind ?? "item")}">${cells}</span>`;
    if (descendants.length === 0) {
      return `<span${hierarchyItemAttributes(row, ctx)}>${rowContent}</span>`;
    }
    const label = row.label ?? row.key;
    return `<details class="niceeval-report__hierarchy-node"${hierarchyItemAttributes(row, ctx)}><summary role="button" aria-label="${escapeHtml(label)}">${rowContent}</summary><div role="rowgroup" aria-label="${escapeHtml(packageCopy(ctx.locale).children(label))}" class="niceeval-report__hierarchy-children">${
      descendants.map(renderRow).join("")
    }</div></details>`;
  };
  const roots = children.get(undefined) ?? [];
  const trailingColumns = Math.max(0, block.columns.length - 1);
  const hierarchyName = packageCopy(ctx.locale).experimentHierarchy;
  const table = `<div role="table" aria-label="${escapeHtml(hierarchyName)}" class="niceeval-report__hierarchy-table" style="--niceeval-hierarchy-template:minmax(15rem,2fr) repeat(${trailingColumns},minmax(7rem,1fr))"><div role="rowgroup"><div role="row" class="niceeval-report__hierarchy-row niceeval-report__hierarchy-header">${headings}</div></div><div role="rowgroup">${
    roots.map(renderRow).join("")
  }</div></div>`;
  const scroll = `<div class="niceeval-report__table-wrap${ctx.classic ? " niceeval-report__hierarchy-scroll" : ""}" role="region" aria-label="${escapeHtml(hierarchyName)}" tabindex="0">${table}</div>`;
  if (!ctx.classic) return scroll;
  const copy = packageCopy(ctx.locale);
  return `<div class="niceeval-report__hierarchy" data-niceeval-hierarchy><div class="niceeval-report__hierarchy-toolbar"><input type="search" role="searchbox" aria-label="${escapeHtml(copy.filter)}" data-niceeval-filter autocomplete="off" /><button type="button" data-niceeval-filter-clear>${escapeHtml(copy.clear)}</button></div><p role="status" data-niceeval-filter-status hidden></p>${scroll}</div>`;
}

function hierarchyItemAttributes(
  row: { readonly key: string; readonly target?: ReportLinkTarget },
  ctx: RenderContext,
): string {
  const key = ` data-niceeval-hierarchy-item data-niceeval-row-key="${escapeHtml(row.key)}" data-niceeval-hierarchy-key="${escapeHtml(row.key)}"`;
  if (row.target === undefined || row.target.kind !== "route") return key;
  const href = reportHref(ctx.route, row.target, ctx.hrefMode);
  return href === "#" ? key : `${key} data-niceeval-hierarchy-route="${escapeHtml(href)}"`;
}

function renderChart(block: Extract<ReportBlock, { readonly type: "chart" }>): string {
  const chart = block.chart === "line" ? "line" : "bar";
  return `<figure class="niceeval-report__chart niceeval-report__chart--${chart}" data-chart="${chart}"><figcaption>${escapeHtml(block.title)}<span class="niceeval-report__chart-category">${escapeHtml(block.categoryLabel)}</span></figcaption><div class="niceeval-report__table-wrap"><table class="niceeval-report__table"><thead><tr><th scope="col">${escapeHtml(block.categoryLabel)}</th>${
    block.series.map((series) => `<th scope="col" class="niceeval-report__align-end">${escapeHtml(series.label)}</th>`).join("")
  }</tr></thead><tbody>${
    block.categories.map((category, categoryIndex) =>
      `<tr><th scope="row">${escapeHtml(category)}</th>${
        block.series.map((series) =>
          `<td class="niceeval-report__align-end">${escapeHtml(scalarText(series.values[categoryIndex] ?? null))}</td>`
        ).join("")
      }</tr>`
    ).join("")
  }</tbody></table></div></figure>`;
}

function renderHero(
  block: Extract<ReportBlock, { readonly type: "hero" }>,
  ctx: RenderContext,
): string {
  const logo = block.logo === undefined
    ? ""
    : `<img class="niceeval-report__hero-logo" src="${escapeHtml(block.logo.src)}" alt="${escapeHtml(block.logo.alt)}" />`;
  const title = block.title === undefined
    ? ""
    : `<h1 class="niceeval-report__hero-title">${escapeHtml(block.title)}</h1>`;
  const copy = packageCopy(ctx.locale);
  const links = block.links.length === 0
    ? ""
    : `<nav class="niceeval-report__hero-links" aria-label="${escapeHtml(copy.reportLinks)}"><ul>${
      block.links.map((link) => `<li><a ${reportLinkAttributes(ctx, link.target)}>${escapeHtml(link.label)}</a></li>`).join("")
    }</ul></nav>`;
  const meta = heroMeta(block, copy, ctx.locale);
  const powered = ctx.classic
    ? `<p class="niceeval-report__powered"><a href="${POWERED_HREF}" target="_blank" rel="noopener">${escapeHtml(copy.poweredBy)}</a></p>`
    : "";
  return `<section class="niceeval-report__hero">${logo}${title}<p>${escapeHtml(block.description)}</p>${links}${meta}${powered}</section>`;
}

function heroMeta(
  block: Extract<ReportBlock, { readonly type: "hero" }>,
  copy: PackageCopy,
  locale: ReportViewLocale,
): string {
  if (block.lastRunAt === undefined) return "";
  const text = block.lastRunAt === null
    ? copy.noRuns
    : [
      copy.lastRun(formatInstant(block.lastRunAt, locale)),
      ...(block.runCount !== undefined && block.runCount > 1 ? [copy.composedFrom(block.runCount)] : []),
    ].join(" · ");
  return `<p class="niceeval-report__hero-meta">${escapeHtml(text)}</p>`;
}

function renderSummary(
  block: Extract<ReportBlock, { readonly type: "summary" }>,
  ctx: RenderContext,
): string {
  const copy = packageCopy(ctx.locale);
  const lastRun = ctx.classic
    ? ""
    : `<div class="niceeval-report__summary-metric"><dt>${escapeHtml(copy.lastRunLabel)}</dt><dd>${escapeHtml(formatLastRunAt(block.lastRunAt))}</dd></div>`;
  const metrics = block.metrics.map((metric) =>
    `<div class="niceeval-report__summary-metric"><dt>${escapeHtml(metric.label)}</dt><dd>${renderDashboardDisplay(metric)}</dd></div>`
  ).join("");
  return `<section class="niceeval-report__summary" aria-label="${escapeHtml(copy.summary)}"><h2>${escapeHtml(copy.summary)}</h2><dl>${lastRun}${metrics}</dl></section>`;
}

function renderRankedBars(block: ReportRankedBars, ctx: RenderContext): string {
  const seriesKeys = [...new Set(block.points.map((point) => point.series))];
  const points = [...block.points].sort((left, right) => compareRankedBarPoints(left, right, block.better));
  const scale = rankedBarScale(points.map((point) => point.value));
  const shorts = shortestUniqueLabels(points.map((point) => point.label));
  const bars = points.map((point) => {
    const missing = point.value === null;
    const percent = missing ? 0 : rankedBarPercent(point.value, scale);
    const short = shorts.get(point.label) ?? point.label;
    const value = point.display;
    const label = point.series.length === 0 || point.series === "all" ? short : `${short} · ${point.series}`;
    const seriesIndex = Math.max(0, seriesKeys.indexOf(point.series)) % 6;
    const pattern = seriesPattern(point.series);
    if (!ctx.classic) {
      return `<li class="niceeval-report__bar${missing ? " niceeval-report__bar--missing" : ""}"><div class="niceeval-report__bar-label"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div><div class="niceeval-report__bar-track" aria-hidden="true"><span class="niceeval-report__bar-fill" style="width:${percent.toFixed(3)}%"></span></div><span class="niceeval-report__bar-coverage">${escapeHtml(formatCoverage(point.coverage))}</span></li>`;
    }
    const now = missing ? "" : ` aria-valuenow="${escapeHtml(String(point.value))}"`;
    return `<li class="niceeval-report__bar${missing ? " niceeval-report__bar--missing" : ""} niceeval-report__series-${seriesIndex}"><span class="niceeval-report__bar-label" title="${escapeHtml(point.label)}" aria-hidden="true">${escapeHtml(short)}</span><div class="niceeval-report__bar-track"><span role="meter" class="niceeval-report__bar-fill niceeval-report__bar-fill--v${pattern}" aria-label="${escapeHtml(point.label)}" aria-valuemin="${scale.minimum}" aria-valuemax="${scale.maximum}"${now} style="width:${percent.toFixed(3)}%"></span></div><strong class="niceeval-report__bar-value" aria-hidden="true">${escapeHtml(value)}</strong></li>`;
  }).join("");
  const tableRows = points.map((point) =>
    `<tr><th scope="row">${escapeHtml(point.label)}</th><td>${escapeHtml(point.series)}</td><td class="niceeval-report__align-end">${escapeHtml(point.display)}</td><td class="niceeval-report__align-end">${escapeHtml(formatCoverage(point.coverage))}</td></tr>`
  ).join("");
  const hidden = ctx.classic ? " niceeval-report__visually-hidden" : "";
  const copy = packageCopy(ctx.locale);
  const legendSeries = seriesKeys.filter((series) => series.length > 0 && series !== "all");
  const legend = !ctx.classic || legendSeries.length === 0
    ? ""
    : `<ul class="niceeval-report__bar-legend" aria-label="${escapeHtml(copy.seriesKey)}">${
      legendSeries.map((series) => {
        const seriesIndex = Math.max(0, seriesKeys.indexOf(series)) % 6;
        return `<li><span class="niceeval-report__bar-key niceeval-report__series-${seriesIndex} niceeval-report__bar-fill--v${seriesPattern(series)}" aria-hidden="true"></span>${escapeHtml(series)}</li>`;
      }).join("")
    }</ul>`;
  return `<figure class="niceeval-report__ranked-bars"><figcaption>${escapeHtml(block.title)}<span>${escapeHtml(block.better === "higher" ? copy.higherBetter : copy.lowerBetter)}</span></figcaption><ol>${bars}</ol>${legend}<div class="niceeval-report__table-wrap niceeval-report__dashboard-data${hidden}"><table class="niceeval-report__table"><caption>${escapeHtml(copy.accessibleValues(block.title))}</caption><thead><tr><th scope="col">Label</th><th scope="col">Series</th><th scope="col" class="niceeval-report__align-end">Value</th><th scope="col" class="niceeval-report__align-end">Coverage</th></tr></thead><tbody>${tableRows}</tbody></table></div></figure>`;
}

function seriesPattern(series: string): 1 | 2 | 3 | 4 {
  let hash = 0;
  for (let index = 0; index < series.length; index += 1) {
    hash = (hash * 31 + series.charCodeAt(index)) | 0;
  }
  return ((Math.abs(hash) % 4) + 1) as 1 | 2 | 3 | 4;
}

function renderScatter(block: ReportScatter, ctx: RenderContext): string {
  const plotted = block.series.flatMap((series, seriesIndex) =>
    series.points
      .filter((point) => point.x !== null && point.y !== null)
      .map((point) => ({ point, series, seriesIndex }))
  );
  const invertX = block.xBetter === "lower";
  const invertY = block.yBetter === "lower";
  const xValues = plotted.map(({ point }) => point.x!);
  const yValues = plotted.map(({ point }) => point.y!);
  const xDomain = paddedAxisDomain(
    xValues.length === 0 ? [0, 1] : xValues,
    axisBounds(block.xLabel),
  );
  const yDomain = paddedAxisDomain(
    yValues.length === 0 ? [0, 1] : yValues,
    axisBounds(block.yLabel),
  );
  const width = 640;
  const height = 360;
  const bounds = { left: 68, right: 36, top: 28, bottom: 54 };
  const plotWidth = width - bounds.left - bounds.right;
  const plotHeight = height - bounds.top - bounds.bottom;
  const xSpan = xDomain[1] - xDomain[0] || 1;
  const ySpan = yDomain[1] - yDomain[0] || 1;
  const pointPosition = (x: number, y: number) => {
    const xT = invertX ? (xDomain[1] - x) / xSpan : (x - xDomain[0]) / xSpan;
    const yT = invertY ? (yDomain[1] - y) / ySpan : (y - yDomain[0]) / ySpan;
    return {
      x: bounds.left + xT * plotWidth,
      y: bounds.top + (1 - yT) * plotHeight,
    };
  };
  const xTicks = ticksInDomain(xDomain[0], xDomain[1], 5);
  const yTicks = ticksInDomain(yDomain[0], yDomain[1], 5);
  const xStep = tickStepOf(xTicks);
  const yStep = tickStepOf(yTicks);
  const xUnit = axisUnit(block.xLabel);
  const yUnit = axisUnit(block.yLabel);
  const grid = [
    ...xTicks.map((tick) => {
      const x = pointPosition(tick, yDomain[0]).x;
      return `<line class="niceeval-report__scatter-grid" x1="${x.toFixed(2)}" y1="${bounds.top}" x2="${x.toFixed(2)}" y2="${height - bounds.bottom}"></line><text class="niceeval-report__scatter-tick" x="${x.toFixed(2)}" y="${height - bounds.bottom + 16}" text-anchor="middle">${escapeHtml(formatAxisTick(tick, xStep, xUnit))}</text>`;
    }),
    ...yTicks.map((tick) => {
      const y = pointPosition(xDomain[0], tick).y;
      return `<line class="niceeval-report__scatter-grid" x1="${bounds.left}" y1="${y.toFixed(2)}" x2="${width - bounds.right}" y2="${y.toFixed(2)}"></line><text class="niceeval-report__scatter-tick" x="${bounds.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(formatAxisTick(tick, yStep, yUnit))}</text>`;
    }),
  ].join("");
  const copy = packageCopy(ctx.locale);
  const better = `<text class="niceeval-report__scatter-better" x="${width - bounds.right}" y="${bounds.top - 8}" text-anchor="end">${escapeHtml(copy.betterHint)}</text>`;
  const links = block.series.map((series, index) =>
    `<li><span class="niceeval-report__scatter-key niceeval-report__scatter-key--${index % 6}" aria-hidden="true"></span>${escapeHtml(series.label)}</li>`
  ).join("");
  const marks = block.series.map((series, seriesIndex) => {
    const points = series.points.filter((point) => point.x !== null && point.y !== null);
    const line = block.connect && points.length > 1
      ? `<polyline class="niceeval-report__scatter-line niceeval-report__scatter-line--${seriesIndex % 6}" points="${
        points.map((point) => {
          const position = pointPosition(point.x!, point.y!);
          return `${position.x.toFixed(2)},${position.y.toFixed(2)}`;
        }).join(" ")
      }"></polyline>`
      : "";
    const circles = points.map((point) => {
      const position = pointPosition(point.x!, point.y!);
      const label = `${point.key}: ${block.xLabel} ${point.xDisplay}; ${block.yLabel} ${point.yDisplay}`;
      const labelOnLeft = position.x > width - bounds.right - 96;
      const labelX = labelOnLeft ? position.x - 8 : position.x + 8;
      const circle = `<circle class="niceeval-report__scatter-point niceeval-report__scatter-point--${seriesIndex % 6}" cx="${position.x.toFixed(2)}" cy="${position.y.toFixed(2)}" r="5"><title>${escapeHtml(label)}</title></circle><text class="niceeval-report__scatter-point-label" x="${labelX.toFixed(2)}" y="${(position.y - 8).toFixed(2)}" text-anchor="${labelOnLeft ? "end" : "start"}">${escapeHtml(point.key)}</text>`;
      return point.target === undefined || point.target.kind === "attempt"
        ? circle
        : `<a ${reportLinkAttributes(ctx, point.target)} aria-label="${escapeHtml(label)}">${circle}</a>`;
    }).join("");
    return `${line}${circles}`;
  }).join("");
  const tableRows = block.series.flatMap((series) =>
    series.points.map((point) =>
      `<tr><th scope="row">${escapeHtml(series.label)} · ${escapeHtml(point.key)}</th><td class="niceeval-report__align-end">${escapeHtml(point.xDisplay)}</td><td class="niceeval-report__align-end">${escapeHtml(point.yDisplay)}</td><td>${
        point.target === undefined
          ? ""
          : point.target.kind === "attempt"
          ? escapeHtml(linkTargetLabel(point.target))
          : `<a ${reportLinkAttributes(ctx, point.target)}>${escapeHtml(linkTargetLabel(point.target))}</a>`
      }</td></tr>`
    )
  ).join("");
  const hidden = ctx.classic ? " niceeval-report__visually-hidden" : "";
  const aria = `${block.xLabel} by ${block.yLabel}`;
  return `<figure class="niceeval-report__scatter"><figcaption>${escapeHtml(block.title)}<span>${escapeHtml(block.xLabel)} × ${escapeHtml(block.yLabel)}</span></figcaption><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(aria)}" preserveAspectRatio="xMidYMid meet"><title>${escapeHtml(block.title)}</title><desc>${escapeHtml(`Scatter plot of ${block.yLabel} against ${block.xLabel}. Missing values are listed in the table below.`)}</desc>${grid}${better}<line class="niceeval-report__scatter-axis" x1="${bounds.left}" y1="${
    height - bounds.bottom
  }" x2="${width - bounds.right}" y2="${height - bounds.bottom}"></line><line class="niceeval-report__scatter-axis" x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${
    height - bounds.bottom
  }"></line><text class="niceeval-report__scatter-axis-label" x="${width / 2}" y="${height - 8}" text-anchor="middle">${escapeHtml(block.xLabel)}</text><text class="niceeval-report__scatter-axis-label" x="16" y="${height / 2}" text-anchor="middle" transform="rotate(-90 16 ${height / 2})">${escapeHtml(block.yLabel)}</text>${marks}</svg><ul class="niceeval-report__scatter-legend" aria-label="${escapeHtml(copy.seriesKey)}">${links}</ul><div class="niceeval-report__table-wrap niceeval-report__dashboard-data${hidden}"><table class="niceeval-report__table"><caption>${escapeHtml(copy.accessibleValues(block.title))}</caption><thead><tr><th scope="col">Point</th><th scope="col" class="niceeval-report__align-end">${escapeHtml(block.xLabel)}</th><th scope="col" class="niceeval-report__align-end">${escapeHtml(block.yLabel)}</th><th scope="col">Link</th></tr></thead><tbody>${tableRows}</tbody></table></div></figure>`;
}

function axisUnit(field: string): string | undefined {
  if (field === "costUSD") return "$";
  if (field === "passRate") return "%";
  if (field === "durationMs") return "ms";
  if (field === "tokens") return "tokens";
  return undefined;
}

function axisBounds(field: string): { min?: number; max?: number } | undefined {
  if (field === "passRate") return { min: 0, max: 1 };
  if (field === "costUSD" || field === "durationMs" || field === "tokens") return { min: 0 };
  return undefined;
}

function renderTreeTable(block: ReportTreeTable, ctx: RenderContext): string {
  const headings = block.columns.map((column) =>
    `<th scope="col" class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${escapeHtml(column.label)}</th>`
  ).join("");
  const rows = block.rows.map((row) => {
    const label = `${treeKindLabel(row.kind)} · ${row.label}`;
    const target = row.target === undefined || row.target.kind === "attempt"
      ? escapeHtml(label)
      : `<a ${reportLinkAttributes(ctx, row.target)}>${escapeHtml(label)}</a>`;
    const cells = block.columns.map((column) =>
      `<td class="niceeval-report__align-${column.align === "end" ? "end" : "start"}">${renderTreeCell(row.cells[column.key]!)}</td>`
    ).join("");
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
  const coverage = value.coverage === undefined
    ? ""
    : ` <span class="niceeval-report__coverage">${escapeHtml(formatCoverage(value.coverage))}</span>`;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function renderInlines(children: readonly ReportInline[], ctx: RenderContext): string {
  return children.map((child) => {
    switch (child.type) {
      case "text":
        return escapeHtml(child.value);
      case "code":
        return `<code class="niceeval-report__inline-code">${escapeHtml(child.value)}</code>`;
      case "emphasis":
        return `<em>${renderInlines(child.children, ctx)}</em>`;
      case "link":
        return `<a ${reportLinkAttributes(ctx, child.target)}>${renderInlines(child.label, ctx)}</a>`;
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

function reportLinkAttributes(ctx: RenderContext, target: ReportLinkTarget): string {
  const href = reportHref(ctx.route, target, ctx.hrefMode);
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

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
