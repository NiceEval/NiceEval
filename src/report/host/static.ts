import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Effect } from "effect";

import {
  REPORT_BUILD_RSS_BYTES_MAX,
  REPORT_BUILD_TIME_MS_MAX,
  REPORT_DIFF_ASSET_BYTES_MAX,
  REPORT_DOWNLOAD_FILE_BYTES_MAX,
  REPORT_DOWNLOAD_FILES_MAX,
  REPORT_PAGE_HTML_BYTES_MAX,
  REPORT_SOURCE_ASSET_BYTES_MAX,
  REPORT_SOURCE_DIFF_ASSET_BYTES_MAX,
  REPORT_SITE_HTML_BYTES_MAX,
  REPORT_STATIC_ASSET_BYTES_MAX,
  closedSiteRevisionData,
  compareUtf8,
  makeClosedSiteRevision,
  reportBuildBudgetExceeded,
  type ClosedSiteFile,
  type ClosedSiteRevision,
  type ReportBuildBudgetExceeded,
} from "../execution/model.ts";
import {
  hostStaticPath,
  staticPathConflicts,
  staticPathForDownload,
  staticPathForRoute,
  validateDownloadPath,
  validateReportRoute,
  type ReportStaticPath,
} from "../execution/paths.ts";
import type { ReportProblem } from "../execution/machine.ts";
import { resolveLocalizedText } from "../model/locale.ts";
import type { ResolvedPage, ResolvedPageAsset } from "../runtime/resolved-page.ts";
import {
  basalt,
  themeSourceBase,
  themeStylesheet,
  type ThemeDefinition,
} from "../theme.ts";
import type { ClosedReportSite, ClosedSitePage } from "./execute.ts";
import {
  REPORT_REFRESH_RUNTIME_PATH,
  REPORT_STYLESHEET_PATH,
} from "./site-assets.ts";
import { reportSiteRuntime } from "./site-runtime.ts";

export interface ReportHostOutputPath {
  readonly value: string;
}

export interface ReportFileSystemError {
  readonly code: "report-export-write-failed";
  readonly operation: string;
}

export interface ReportExportTargetExists {
  readonly code: "report-export-target-exists";
}

export type ReportFileSystemFailure = ReportFileSystemError | ReportExportTargetExists;

export interface ReportFileSystemService {
  readonly prepareOutput: (out: string) => Effect.Effect<void, ReportFileSystemFailure>;
  readonly writeFile: (input: {
    readonly out: string;
    readonly path: ReportHostOutputPath;
    readonly bytes: Uint8Array;
  }) => Effect.Effect<void, ReportFileSystemFailure>;
  readonly writeCompleteMarker: (out: string) => Effect.Effect<void, ReportFileSystemFailure>;
  readonly syncDirectory: (out: string) => Effect.Effect<void, ReportFileSystemFailure>;
}

export class ReportFileSystem extends Context.Tag("@niceeval/report/ReportFileSystem")<
  ReportFileSystem,
  ReportFileSystemService
>() {}

export interface ReportStaticExportReceipt {
  readonly out: string;
  /** Does not include the zero-byte publication marker. */
  readonly filesWritten: number;
}

export interface ReportSiteBuildFailure {
  readonly code: "report-site-build-failed";
  readonly operation: "render" | "identity" | "path" | "asset" | "download";
  readonly reason: string;
}

export type ReportSiteBuildError = ReportSiteBuildFailure | ReportBuildBudgetExceeded;
export type ReportExportError = ReportFileSystemFailure | ReportSiteBuildFailure;

/** The one Host-owned static resource path for a closed Theme stylesheet. */
export const REPORT_THEME_STYLESHEET_PATH = "_niceeval/theme.css";
/** The Host-owned renderer identity carried by every static revision. */
export const REPORT_STATIC_RENDERER = "niceeval.report-ssg/v1" as const;
const MANIFEST_PATH = "_niceeval/manifest.json";
const PROBLEMS_PATH = "_niceeval/problems.json";
const PROJECTIONS_PATH = "_niceeval/data/projections.json";
const COMPLETE_PATH = "_niceeval/complete";
const NICEEVAL_BRAND_HREF = "https://niceeval.com/?utm_source=report&utm_medium=brand";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PRODUCT_STYLESHEET = readFileSync(new URL("../assets/styles.css", import.meta.url), "utf8");
const PRODUCT_ENHANCER = readFileSync(new URL("../assets/enhance.js", import.meta.url), "utf8");

/**
 * Host-owned parameterized-Page dialog for the shared view/static runtime.
 * A click on a same-site `<pageId>/<key>/index.html` href writes the legacy
 * hash deep link and opens a native `<dialog>` filled with that standalone
 * detail document's own slot bytes. No-JS and direct hrefs keep reading the
 * same document. The route list comes from the revision's closed pages, not
 * from any author declaration. The report content inside the dialog is styled
 * by the existing product stylesheet; only the dialog chrome is styled here.
 */
const PARAM_PAGE_DIALOG_RUNTIME = `(() => {
  "use strict";
  if (typeof window === "undefined" || typeof HTMLDialogElement !== "function") return;
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const routes = (document.documentElement.getAttribute("data-niceeval-param-routes") || "")
    .split(" ")
    .filter((value) => value.length > 0);
  if (routes.length === 0) return;
  const siteRoot = document.documentElement.getAttribute("data-niceeval-site-root") || "index.html";

  function closest(target, selector) {
    return target && target.closest ? target.closest(selector) : null;
  }

  function escapeRegExp(value) {
    const special = ".+*?^$()[]{}|";
    let escaped = "";
    for (const character of value) {
      if (special.includes(character) || character.charCodeAt(0) === 92) {
        escaped += String.fromCharCode(92);
      }
      escaped += character;
    }
    return escaped;
  }

  function matchTarget(url) {
    if (url.origin !== location.origin) return null;
    for (const prefix of routes) {
      const root = new URL(siteRoot, document.baseURI);
      const pattern = new RegExp("^" + escapeRegExp(new URL(prefix + "/", root).pathname) + "([^/]+)/index\\\\.html$");
      const match = pattern.exec(url.pathname);
      if (!match) continue;
      let key;
      try {
        key = decodeURIComponent(match[1]);
      } catch {
        return null;
      }
      if (!key || key.includes("/")) return null;
      return { prefix, key, url };
    }
    return null;
  }

  function targetFromHash() {
    const match = location.hash.startsWith("#/") ? location.hash.slice(2).split("/") : [];
    if (match.length !== 2 || !routes.includes(match[0]) || !match[1]) return null;
    const root = new URL(siteRoot, document.baseURI);
    return {
      prefix: match[0],
      key: match[1],
      url: new URL(match[0] + "/" + encodeURIComponent(match[1]) + "/index.html", root),
    };
  }

  function hashForTarget(target) {
    return "#/" + target.prefix + "/" + target.key;
  }

  function currentLocale() {
    return document.documentElement.lang === "zh-CN" ? "zh-CN" : "en";
  }

  function rebaseSlotUrls(slot, responseUrl) {
    for (const element of slot.querySelectorAll("[href], [src]")) {
      for (const attribute of ["href", "src"]) {
        const value = element.getAttribute(attribute);
        if (value === null) continue;
        // Fragment and non-document schemes retain their literal browser
        // meaning. Every other relative reference must keep the fetched
        // detail document as its base after this slot moves into the root
        // page's dialog.
        if (value.startsWith("#") || /^(?:data:|mailto:|tel:)/i.test(value)) continue;
        try {
          element.setAttribute(attribute, new URL(value, responseUrl).href);
        } catch {
          // Leave malformed author data untouched; the standalone document
          // would have the same browser-level handling.
        }
      }
    }
  }

  function extractDocument(html, locale, responseUrl) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const slot = parsed.querySelector('.niceeval-view-report-slot[data-niceeval-locale="' + locale + '"]');
    if (!slot) return null;
    rebaseSlotUrls(slot, responseUrl);
    return { title: parsed.title, content: slot.innerHTML };
  }

  let dialog = null;
  let ownsHistory = false;
  let requestRevision = 0;
  let requestedTarget = null;

  function ensureDialog() {
    if (dialog !== null) return;
    dialog = document.createElement("dialog");
    dialog.className = "niceeval-view-dialog";
    const head = document.createElement("div");
    head.className = "niceeval-view-dialog-head";
    const title = document.createElement("span");
    title.className = "niceeval-view-dialog-title";
    title.id = "niceeval-view-dialog-title";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "niceeval-view-dialog-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "\\u00d7";
    close.addEventListener("click", closeFromUi);
    head.appendChild(title);
    head.appendChild(close);
    const body = document.createElement("div");
    body.className = "niceeval-view-dialog-body niceeval-view-report-slot";
    dialog.appendChild(head);
    dialog.appendChild(body);
    dialog.setAttribute("aria-labelledby", title.id);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeFromUi();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeFromUi();
    });
    document.body.appendChild(dialog);
  }

  function closeFromUi() {
    if (dialog === null || !dialog.open) return;
    requestedTarget = null;
    requestRevision++;
    if (!ownsHistory) {
      dialog.close();
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    ownsHistory = false;
    history.back();
  }

  function openTarget(target, nextOwnsHistory) {
    ensureDialog();
    requestedTarget = target;
    const revision = ++requestRevision;
    fetch(target.url.href, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("http " + response.status);
        return response.text().then((html) => ({ html, responseUrl: response.url || target.url.href }));
      })
      .then(({ html, responseUrl }) => {
        if (revision !== requestRevision || requestedTarget !== target) return;
        const extracted = extractDocument(html, currentLocale(), responseUrl);
        if (extracted === null) {
          location.href = target.url.href;
          return;
        }
        dialog.querySelector(".niceeval-view-dialog-title").textContent = extracted.title;
        dialog.querySelector(".niceeval-view-dialog-close").setAttribute(
          "aria-label",
          currentLocale() === "zh-CN" ? "关闭" : "Close",
        );
        dialog.querySelector(".niceeval-view-dialog-body").innerHTML = extracted.content;
        if (!dialog.open) dialog.showModal();
        ownsHistory = nextOwnsHistory;
      })
      .catch(() => {
        if (revision === requestRevision && requestedTarget === target) location.href = target.url.href;
      });
  }

  function onHashChange() {
    const target = targetFromHash();
    if (target !== null) {
      openTarget(target, true);
      return;
    }
    requestedTarget = null;
    requestRevision++;
    ownsHistory = false;
    if (dialog !== null && dialog.open) dialog.close();
  }

  const initialTarget = targetFromHash();
  if (initialTarget !== null) openTarget(initialTarget, false);
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("popstate", () => {
    if (location.hash) return;
    onHashChange();
  });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = closest(event.target, "a[href]");
    if (!anchor) return;
    const anchorTarget = anchor.getAttribute("target");
    if (anchorTarget !== null && anchorTarget !== "_self") return;
    if (anchor.hasAttribute("download")) return;
    let url;
    try {
      url = new URL(anchor.getAttribute("href"), document.baseURI);
    } catch {
      return;
    }
    const target = matchTarget(url);
    if (target === null) return;
    event.preventDefault();
    location.hash = hashForTarget(target);
  });
})();`;

/** Forms one byte-complete revision; neither view nor static renders afterward. */
export function buildSiteRevision(input: {
  readonly site: ClosedReportSite;
  readonly theme?: ThemeDefinition;
}): Effect.Effect<ClosedSiteRevision, ReportSiteBuildError> {
  return Effect.try({
    try: () => {
      const files = buildSiteFiles(input.site, input.theme ?? input.site.theme ?? basalt);
      assertFinalBuildBudgets(input.site.startedAtMs, input.site.baselineRssBytes);
      const defaultRoute = defaultRouteForSite(input.site);
      return signClosedSiteRevision({
        sampleIdentity: input.site.sampleIdentity,
        reportIdentity: input.site.reportIdentity,
        files,
        routes: input.site.pages.map(({ page }) => page.target.route),
        ...(defaultRoute === undefined ? {} : { defaultRoute }),
      });
    },
    catch: (cause): ReportSiteBuildError => isBudgetError(cause)
      ? cause
      : siteFailure(
        isSiteBuildFailure(cause) ? cause.operation : "render",
        isSiteBuildFailure(cause) ? cause.reason : boundedReason(cause),
      ),
  });
}

/**
 * Host-only final signer for a byte-complete static site. It derives the
 * problem table from the closed `_niceeval/problems.json` resource, so callers
 * which retain only closed bytes never need to retain revision problem values.
 */
export function signClosedSiteRevision(input: {
  readonly sampleIdentity: string;
  readonly reportIdentity: string;
  readonly files: readonly ClosedSiteFile[];
  readonly routes: readonly string[];
  readonly defaultRoute?: string;
}): ClosedSiteRevision {
  const files = Object.freeze([...input.files].sort((left, right) => compareUtf8(left.path, right.path)));
  const problems = closedProblemsFromFiles(files);
  return makeClosedSiteRevision({
    contentHash: siteRevisionIdentity({
      sampleIdentity: input.sampleIdentity,
      reportIdentity: input.reportIdentity,
      files,
      ...(input.defaultRoute === undefined ? {} : { defaultRoute: input.defaultRoute }),
      problems,
    }),
    files,
    routes: input.routes,
    ...(input.defaultRoute === undefined ? {} : { defaultRoute: input.defaultRoute }),
    problems,
  });
}

/**
 * Closes exactly the stylesheet bytes used by the static builder. Watch cache
 * code may request these bytes but must not reproduce Theme asset resolution.
 */
export function closeStaticThemeStylesheet(theme: ThemeDefinition): Uint8Array {
  return encoder.encode(`${themeStylesheet(theme)}\n${inlineThemeStyles(theme)}\n`);
}

function assertFinalBuildBudgets(startedAtMs: number, baselineRssBytes: number): void {
  const elapsed = Date.now() - startedAtMs;
  if (elapsed > REPORT_BUILD_TIME_MS_MAX) {
    throw reportBuildBudgetExceeded("build-time", REPORT_BUILD_TIME_MS_MAX, elapsed);
  }
  const rssGrowth = Math.max(0, process.memoryUsage().rss - baselineRssBytes);
  if (rssGrowth > REPORT_BUILD_RSS_BYTES_MAX) {
    throw reportBuildBudgetExceeded("build-rss", REPORT_BUILD_RSS_BYTES_MAX, rssGrowth);
  }
}

/** Writes only the immutable revision mapping, then publishes its marker last. */
export function exportStaticReport(input: {
  readonly revision: ClosedSiteRevision;
  readonly out: string;
}): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return Effect.gen(function* () {
    const files = closedSiteRevisionData(input.revision).files;
    const fileSystem = yield* ReportFileSystem;
    yield* fileSystem.prepareOutput(input.out);
    let written = 0;
    for (const file of files) {
      if (file.path === COMPLETE_PATH) continue;
      yield* fileSystem.writeFile({
        out: input.out,
        path: Object.freeze({ value: file.path }),
        bytes: file.bytes,
      });
      written += 1;
    }
    yield* fileSystem.writeCompleteMarker(input.out);
    yield* fileSystem.syncDirectory(input.out);
    return Object.freeze({ out: input.out, filesWritten: written });
  });
}

function buildSiteFiles(site: ClosedReportSite, theme: ThemeDefinition): readonly ClosedSiteFile[] {
  const files = new Map<string, ClosedSiteFile>();
  const paths: ReportStaticPath[] = [];
  const add = (file: ClosedSiteFile, owner: ReportStaticPath): void => {
    const prior = files.get(file.path);
    if (prior !== undefined) {
      if (prior.mediaType === file.mediaType && bytesEqual(prior.bytes, file.bytes)) return;
      throw siteFailure("path", `two site resources produce ${file.path}`);
    }
    files.set(file.path, file);
    paths.push(owner);
  };

  const stylesheet = textFile(REPORT_STYLESHEET_PATH, PRODUCT_STYLESHEET, "text/css; charset=utf-8");
  const themeFile = binaryFile(
    REPORT_THEME_STYLESHEET_PATH,
    "text/css; charset=utf-8",
    closeStaticThemeStylesheet(theme),
  );
  const runtime = textFile(
    REPORT_REFRESH_RUNTIME_PATH,
    `${reportSiteRuntime(PRODUCT_ENHANCER).trimEnd()}\n${PARAM_PAGE_DIALOG_RUNTIME}\n`,
    "text/javascript; charset=utf-8",
  );
  add(stylesheet, hostStaticPath(stylesheet.path));
  add(themeFile, hostStaticPath(themeFile.path));
  add(runtime, hostStaticPath(runtime.path));

  const pages = [...site.pages].sort(compareSitePages);
  const paramRoutes = parameterizedRoutePrefixes(site);
  let siteHtmlBytes = 0;
  for (const entry of pages) {
    assertFinalBuildBudgets(site.startedAtMs, site.baselineRssBytes);
    const routeIssue = validateReportRoute(entry.page.target.route);
    if (routeIssue !== undefined || entry.page.target.route === "/_niceeval" ||
      entry.page.target.route.startsWith("/_niceeval/")) {
      throw siteFailure("path", routeIssue?.reason ?? "author routes cannot occupy /_niceeval");
    }
    const output = staticPathForRoute(entry.page.target.route);
    const pageFile = textFile(output.posix, renderPage(site, entry, paramRoutes), "text/html; charset=utf-8");
    if (pageFile.bytes.byteLength > REPORT_PAGE_HTML_BYTES_MAX) {
      throw reportBuildBudgetExceeded(
        "page-html-bytes",
        REPORT_PAGE_HTML_BYTES_MAX,
        pageFile.bytes.byteLength,
        { pageId: entry.page.target.pageId, route: entry.page.target.route },
      );
    }
    siteHtmlBytes += pageFile.bytes.byteLength;
    if (siteHtmlBytes > REPORT_SITE_HTML_BYTES_MAX) {
      throw reportBuildBudgetExceeded("site-html-bytes", REPORT_SITE_HTML_BYTES_MAX, siteHtmlBytes);
    }
    add(pageFile, output);
    for (const asset of entry.page.assets) addPageAsset(add, asset);
  }

  const downloads = collectDownloads(site.pages);
  if (downloads.length > REPORT_DOWNLOAD_FILES_MAX) {
    throw reportBuildBudgetExceeded("download-files", REPORT_DOWNLOAD_FILES_MAX, downloads.length);
  }
  for (const download of downloads) {
    if (download.bytes.byteLength > REPORT_DOWNLOAD_FILE_BYTES_MAX) {
      throw reportBuildBudgetExceeded(
        "download-file-bytes",
        REPORT_DOWNLOAD_FILE_BYTES_MAX,
        download.bytes.byteLength,
      );
    }
    const invalid = validateDownloadPath(download.path);
    if (invalid !== undefined) throw siteFailure("download", invalid.reason);
    const output = staticPathForDownload(download.path);
    add(binaryFile(output.posix, download.mediaType, download.bytes), output);
  }

  const problems = textFile(PROBLEMS_PATH, `${canonicalJson(site.problems)}\n`, "application/json; charset=utf-8");
  add(problems, hostStaticPath(problems.path));

  // Every closed site revision carries its projections document: the same
  // canonical bytes view serves and static export writes, and the same file
  // that enters the revision content hash below.
  const projections = textFile(
    PROJECTIONS_PATH,
    `${canonicalJson(site.projections)}\n`,
    "application/json; charset=utf-8",
  );
  add(projections, hostStaticPath(projections.path));

  assertAssetBudgets(files, site.pages);
  const manifestValue = Object.freeze({
    format: "niceeval.report-static/v1",
    sampleIdentity: site.sampleIdentity,
    reportIdentity: site.reportIdentity,
    pages: pages.map((entry) => Object.freeze({
      pageId: entry.page.target.pageId,
      route: entry.page.target.route,
      path: staticPathForRoute(entry.page.target.route).posix,
      navigation: entry.navigation,
    })),
    files: [...files.keys(), MANIFEST_PATH, COMPLETE_PATH].sort(compareUtf8),
    stylesheet: REPORT_STYLESHEET_PATH,
    theme: REPORT_THEME_STYLESHEET_PATH,
    runtime: REPORT_REFRESH_RUNTIME_PATH,
    problems: PROBLEMS_PATH,
    projections: PROJECTIONS_PATH,
  });
  const manifest = textFile(MANIFEST_PATH, `${canonicalJson(manifestValue)}\n`, "application/json; charset=utf-8");
  add(manifest, hostStaticPath(manifest.path));
  add(binaryFile(COMPLETE_PATH, "application/octet-stream", new Uint8Array()), hostStaticPath(COMPLETE_PATH));

  const conflicts = staticPathConflicts(paths);
  if (conflicts.length > 0) {
    const first = conflicts[0]!;
    throw siteFailure("path", `${first.kind} collision between ${first.left.posix} and ${first.right.posix}`);
  }
  return Object.freeze([...files.values()].sort((left, right) => compareUtf8(left.path, right.path)));
}

/**
 * The closed parameterized Page route prefixes of this site (the instance
 * route minus its final key segment, without the leading slash).  The shared
 * dialog runtime uses them to recognize same-site detail hrefs.
 */
function parameterizedRoutePrefixes(site: ClosedReportSite): readonly string[] {
  const prefixes = new Set<string>();
  for (const entry of site.pages) {
    if (entry.page.target.params === undefined) continue;
    const route = entry.page.target.route;
    const cut = route.lastIndexOf("/");
    prefixes.add(route.slice(1, cut));
  }
  return Object.freeze([...prefixes].sort(compareUtf8));
}

function renderPage(site: ClosedReportSite, entry: ClosedSitePage, paramRoutes: readonly string[]): string {
  const page = entry.page;
  const output = staticPathForRoute(page.target.route).posix;
  const stylesheetHref = relativeHref(output, REPORT_STYLESHEET_PATH);
  const themeHref = relativeHref(output, REPORT_THEME_STYLESHEET_PATH);
  const runtimeHref = relativeHref(output, REPORT_REFRESH_RUNTIME_PATH);
  const titleEn = resolveLocalizedText(page.title, "en");
  const titleZh = resolveLocalizedText(page.title, "zh-CN");
  const authorHead = renderHead(page, output);
  const rendererAssets = page.assets.map((asset) => asset.kind === "style"
    ? `<link rel="stylesheet" href="${escapeAttribute(relativeHref(output, asset.path))}">`
    : asset.kind === "script"
      ? `<script src="${escapeAttribute(relativeHref(output, asset.path))}" defer></script>`
      : "").join("");
  const bodyEn = projection(page, "en");
  const bodyZh = projection(page, "zh-CN");
  const navigationEn = renderNavigation(site.pages, page.target.route, output, "en");
  const navigationZh = renderNavigation(site.pages, page.target.route, output, "zh-CN");
  const problemsEn = renderProblems(site.problems, "en");
  const problemsZh = renderProblems(site.problems, "zh-CN");
  const paramRoutesAttr = paramRoutes.length === 0
    ? ""
    : ` data-niceeval-param-routes="${escapeAttribute(paramRoutes.join(" "))}"`;
  const siteRootHref = relativeHref(output, "index.html");
  return `<!doctype html><html class="niceeval-view-document" lang="en" data-niceeval-title-en="${escapeAttribute(titleEn)}" data-niceeval-title-zh-cn="${escapeAttribute(titleZh)}" data-niceeval-site-root="${escapeAttribute(siteRootHref)}"${paramRoutesAttr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(titleEn)}</title><link rel="stylesheet" href="${escapeAttribute(stylesheetHref)}"><link rel="stylesheet" href="${escapeAttribute(themeHref)}">${authorHead}${rendererAssets}<script src="${escapeAttribute(runtimeHref)}" defer></script></head><body><header class="niceeval-view-shell"><a class="niceeval-view-brand" href="${escapeAttribute(NICEEVAL_BRAND_HREF)}" target="_blank" rel="noopener"><span class="niceeval-view-mark" aria-hidden="true"></span><span>NiceEval</span></a><nav class="niceeval-view-nav" data-niceeval-locale="en" aria-label="Report pages">${navigationEn}</nav><nav class="niceeval-view-nav" data-niceeval-locale="zh-CN" aria-label="报告页面" hidden>${navigationZh}</nav><div class="niceeval-view-locale" aria-label="Language"><button class="is-active" type="button" data-niceeval-locale-button="en" aria-pressed="true">EN</button><button type="button" data-niceeval-locale-button="zh-CN" aria-pressed="false">中文</button></div></header><main class="niceeval-view-main"><div class="niceeval-view-report-slot" data-niceeval-locale="en" data-page-id="${escapeAttribute(page.target.pageId)}">${bodyEn}${problemsEn}</div><div class="niceeval-view-report-slot" data-niceeval-locale="zh-CN" data-page-id="${escapeAttribute(page.target.pageId)}" hidden>${bodyZh}${problemsZh}</div><noscript><p class="niceeval-view-noscript">This report remains readable without JavaScript; language selection is unavailable.</p></noscript></main></body></html>`;
}

function renderNavigation(
  pages: readonly ClosedSitePage[],
  currentRoute: string,
  sourceFile: string,
  locale: string,
): string {
  const items = pages.filter((entry) => entry.navigation).sort(compareSitePages).map(({ page }) => {
    const current = page.target.route === currentRoute ? " aria-current=\"page\"" : "";
    const href = relativeHref(sourceFile, staticPathForRoute(page.target.route).posix);
    return `<li><a href="${escapeAttribute(href)}"${current}>${escapeText(resolveLocalizedText(page.title, locale))}</a></li>`;
  });
  return `<ul>${items.join("")}</ul>`;
}

function renderProblems(problems: readonly ReportProblem[], locale: string): string {
  if (problems.length === 0) return "";
  const title = locale === "zh-CN" ? "数据说明" : "Data notes";
  return `<aside class="niceeval-view-problems"><h2>${title}</h2><ul>${problems.map((problem) =>
    `<li><code>${escapeText(problem.code)}</code>${problem.summary === undefined ? "" : ` — ${escapeText(problem.summary)}`}</li>`
  ).join("")}</ul></aside>`;
}

function projection(page: ResolvedPage, locale: string): string {
  const found = page.web.find((candidate) => candidate.locale === locale);
  if (found === undefined) throw siteFailure("render", `Page ${page.target.pageId} lacks ${locale} web projection`);
  return found.html;
}

function renderHead(page: ResolvedPage, sourceFile: string): string {
  if (!Array.isArray(page.head)) return "";
  return page.head.map((raw) => {
    if (!isRecord(raw) || typeof raw.tag !== "string") return "";
    const attrs = renderAttributes(raw.attrs, sourceFile, raw.tag);
    switch (raw.tag) {
      case "meta":
      case "link":
        return `<${raw.tag}${attrs}>`;
      case "style":
        return typeof raw.children === "string" ? `<style${attrs}>${raw.children}</style>` : "";
      case "script":
        return typeof raw.children === "string"
          ? `<script${attrs}>${raw.children}</script>`
          : `<script${attrs}></script>`;
      default:
        return "";
    }
  }).join("");
}

function renderAttributes(value: unknown, sourceFile: string, tag: string): string {
  if (!isRecord(value)) return "";
  return Object.entries(value).sort(([left], [right]) => compareUtf8(left, right)).map(([name, raw]) => {
    const normalized = (tag === "link" && name === "href") || (tag === "script" && name === "src")
      ? typeof raw === "string" && isLocalReference(raw) ? relativeHref(sourceFile, raw) : raw
      : raw;
    return normalized === true
      ? ` ${escapeAttribute(name)}`
      : typeof normalized === "string"
        ? ` ${escapeAttribute(name)}="${escapeAttribute(normalized)}"`
        : "";
  }).join("");
}

function isLocalReference(value: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/iu.test(value) && !value.startsWith("//") && !value.startsWith("/");
}

function addPageAsset(
  add: (file: ClosedSiteFile, owner: ReportStaticPath) => void,
  asset: ResolvedPageAsset,
): void {
  const path = asset.path;
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((segment) =>
    segment.length === 0 || segment === "." || segment === ".."
  )) throw siteFailure("asset", `invalid asset path ${path}`);
  add(binaryFile(path, asset.mediaType, asset.bytes), hostStaticPath(path));
}

function collectDownloads(pages: readonly ClosedSitePage[]): readonly ResolvedPage["downloads"][number][] {
  const byPath = new Map<string, ResolvedPage["downloads"][number]>();
  for (const { page } of pages) {
    for (const download of page.downloads) {
      const prior = byPath.get(download.path);
      if (prior !== undefined && (prior.mediaType !== download.mediaType || !bytesEqual(prior.bytes, download.bytes))) {
        throw siteFailure("download", `two downloads produce ${download.path}`);
      }
      if (prior === undefined) byPath.set(download.path, download);
    }
  }
  return Object.freeze([...byPath.values()].sort((left, right) => compareUtf8(left.path, right.path)));
}

function assertAssetBudgets(
  files: ReadonlyMap<string, ClosedSiteFile>,
  pages: readonly ClosedSitePage[],
): void {
  const assetsByPath = new Map<string, ResolvedPageAsset>();
  for (const { page } of pages) for (const asset of page.assets) assetsByPath.set(asset.path, asset);
  let sourceDiffBytes = 0;
  for (const asset of assetsByPath.values()) {
    if (asset.kind === "source" && asset.byteLength > REPORT_SOURCE_ASSET_BYTES_MAX) {
      throw reportBuildBudgetExceeded("source-asset-bytes", REPORT_SOURCE_ASSET_BYTES_MAX, asset.byteLength);
    }
    if (asset.kind === "diff" && asset.byteLength > REPORT_DIFF_ASSET_BYTES_MAX) {
      throw reportBuildBudgetExceeded("diff-asset-bytes", REPORT_DIFF_ASSET_BYTES_MAX, asset.byteLength);
    }
    if (asset.kind === "source" || asset.kind === "diff") sourceDiffBytes += asset.byteLength;
  }
  if (sourceDiffBytes > REPORT_SOURCE_DIFF_ASSET_BYTES_MAX) {
    throw reportBuildBudgetExceeded(
      "source-diff-asset-bytes",
      REPORT_SOURCE_DIFF_ASSET_BYTES_MAX,
      sourceDiffBytes,
    );
  }
  const assetBytes = [...files.values()]
    .filter((file) => !file.path.endsWith("index.html") && !file.path.startsWith("downloads/") &&
      file.path !== PROBLEMS_PATH)
    .reduce((total, file) => total + file.bytes.byteLength, 0);
  if (assetBytes > REPORT_STATIC_ASSET_BYTES_MAX) {
    throw reportBuildBudgetExceeded("static-asset-bytes", REPORT_STATIC_ASSET_BYTES_MAX, assetBytes);
  }
}

function inlineThemeStyles(theme: ThemeDefinition): string {
  return (theme.styles ?? []).map((asset) => {
    if ("inline" in asset) return asset.inline;
    const base = themeSourceBase(theme);
    if (base === undefined) {
      throw siteFailure("asset", `theme asset ${asset.src} has no trusted module base`);
    }
    try {
      return readFileSync(resolve(base, asset.src), "utf8");
    } catch (cause) {
      throw siteFailure("asset", `theme asset ${asset.src} could not be read: ${boundedReason(cause)}`);
    }
  }).join("\n");
}

/** Uses show's first navigable Page, then the first closed route as a fallback. */
function defaultRouteForSite(site: ClosedReportSite): string | undefined {
  return site.pages.find((entry) => entry.navigation)?.page.target.route ?? site.pages[0]?.page.target.route;
}

function closedProblemsFromFiles(files: readonly ClosedSiteFile[]): readonly ReportProblem[] {
  const file = files.find((candidate) => candidate.path === PROBLEMS_PATH);
  if (file === undefined || file.mediaType !== "application/json; charset=utf-8") {
    throw siteFailure("identity", "closed site is missing its canonical problems resource");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(file.bytes));
  } catch (cause) {
    throw siteFailure("identity", `closed problems resource is invalid JSON: ${boundedReason(cause)}`);
  }
  if (!Array.isArray(raw)) {
    throw siteFailure("identity", "closed problems resource must be an array");
  }
  const problems = raw.map((value, index): ReportProblem => {
    if (!isRecord(value) || typeof value.code !== "string" || !Array.isArray(value.path) ||
      !Array.isArray(value.refs) || !value.path.every((part) => typeof part === "string") ||
      !value.refs.every((ref) => typeof ref === "string") ||
      (value.summary !== undefined && typeof value.summary !== "string")) {
      throw siteFailure("identity", `closed problems resource has an invalid entry at index ${index}`);
    }
    return Object.freeze({
      code: value.code,
      path: Object.freeze([...value.path]),
      refs: Object.freeze([...value.refs]),
      ...(value.summary === undefined ? {} : { summary: value.summary }),
    });
  });
  const canonical = encoder.encode(`${canonicalJson(problems)}\n`);
  if (!bytesEqual(file.bytes, canonical)) {
    throw siteFailure("identity", "closed problems resource is not canonical");
  }
  return Object.freeze(problems);
}

function siteRevisionIdentity(input: {
  readonly sampleIdentity: string;
  readonly reportIdentity: string;
  readonly files: readonly ClosedSiteFile[];
  readonly defaultRoute?: string;
  readonly problems: readonly ReportProblem[];
}): string {
  const hash = createHash("sha256");
  hash.update(canonicalJson({
    format: "niceeval.report-site-revision/v1",
    renderer: REPORT_STATIC_RENDERER,
    sampleIdentity: input.sampleIdentity,
    reportIdentity: input.reportIdentity,
    ...(input.defaultRoute === undefined ? {} : { defaultRoute: input.defaultRoute }),
    problems: input.problems,
  }));
  hash.update("\0");
  for (const file of input.files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.mediaType);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function relativeHref(sourceFile: string, targetFile: string): string {
  const source = sourceFile.split("/");
  source.pop();
  const target = targetFile.split("/");
  let common = 0;
  while (common < source.length && common < target.length && source[common] === target[common]) common += 1;
  const value = [...source.slice(common).map(() => ".."), ...target.slice(common)].join("/");
  return value || "./";
}

function compareSitePages(left: ClosedSitePage, right: ClosedSitePage): number {
  return compareUtf8(left.page.target.route, right.page.target.route) ||
    compareUtf8(left.page.target.pageId, right.page.target.pageId);
}

function textFile(path: string, text: string, mediaType: string): ClosedSiteFile {
  return Object.freeze({ path, mediaType, bytes: encoder.encode(text) });
}

function binaryFile(path: string, mediaType: string, bytes: Uint8Array): ClosedSiteFile {
  return Object.freeze({ path, mediaType, bytes: new Uint8Array(bytes) });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw siteFailure("identity", "canonical JSON rejects non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw siteFailure("identity", `canonical JSON rejects ${typeof value}`);
}

function siteFailure(operation: ReportSiteBuildFailure["operation"], reason: string): ReportSiteBuildFailure {
  return Object.freeze({ code: "report-site-build-failed" as const, operation, reason });
}

function isSiteBuildFailure(value: unknown): value is ReportSiteBuildFailure {
  return isRecord(value) && value.code === "report-site-build-failed" && typeof value.operation === "string" &&
    typeof value.reason === "string";
}

function isBudgetError(value: unknown): value is ReportBuildBudgetExceeded {
  return isRecord(value) && value.code === "report-build-budget-exceeded";
}

function boundedReason(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 512).trim() || "site build failed";
}
