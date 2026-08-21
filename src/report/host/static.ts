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
  REPORT_FRAGMENT_BYTES_MAX,
  REPORT_SOURCE_ASSET_BYTES_MAX,
  REPORT_SOURCE_DIFF_ASSET_BYTES_MAX,
  REPORT_SHELL_FRAGMENT_BYTES_MAX,
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
  REPORT_STYLESHEET_PATH,
} from "./site-assets.ts";

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
export const REPORT_APP_RENDERER = "niceeval.report-spa/v1" as const;
const MANIFEST_PATH = "_niceeval/manifest.json";
const PROBLEMS_PATH = "_niceeval/problems.json";
const PROJECTIONS_PATH = "_niceeval/data/projections.json";
const REPORT_APP_PATH = "_niceeval/app.js";
const REPORT_FRAGMENT_ROOT = "_niceeval/fragments";
const COMPLETE_PATH = "_niceeval/complete";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PRODUCT_STYLESHEET = readFileSync(new URL("../assets/styles.css", import.meta.url), "utf8");
const PRODUCT_APP = readFileSync(new URL("../client-dist/app.js", import.meta.url), "utf8");

/** Forms one byte-complete revision; neither view nor static renders afterward. */
export function buildSiteRevision(input: {
  readonly site: ClosedReportSite;
  readonly theme?: ThemeDefinition;
}): Effect.Effect<ClosedSiteRevision, ReportSiteBuildError> {
  return Effect.try({
    try: () => {
      const files = buildSiteFiles(input.site, input.theme ?? input.site.theme ?? basalt);
      assertFinalBuildBudgets(input.site.startedAtMs, input.site.baselineRssBytes);
      return signClosedSiteRevision({
        sampleIdentity: input.site.sampleIdentity,
        reportIdentity: input.site.reportIdentity,
        files,
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
}): ClosedSiteRevision {
  const files = Object.freeze([...input.files].sort((left, right) => compareUtf8(left.path, right.path)));
  const problems = closedProblemsFromFiles(files);
  return makeClosedSiteRevision({
    contentHash: siteRevisionIdentity({
      sampleIdentity: input.sampleIdentity,
      reportIdentity: input.reportIdentity,
      files,
      problems,
    }),
    files,
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

function assertFinalBuildBudgets(
  startedAtMs: number,
  baselineRssBytes: number,
  target?: { readonly pageId: string; readonly route: string },
): void {
  const elapsed = Date.now() - startedAtMs;
  if (elapsed > REPORT_BUILD_TIME_MS_MAX) {
    throw reportBuildBudgetExceeded("build-time", REPORT_BUILD_TIME_MS_MAX, elapsed);
  }
  const rssGrowth = Math.max(0, process.memoryUsage().rss - baselineRssBytes);
  if (rssGrowth > REPORT_BUILD_RSS_BYTES_MAX) {
    throw reportBuildBudgetExceeded("build-rss", REPORT_BUILD_RSS_BYTES_MAX, rssGrowth, target);
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
  const app = textFile(REPORT_APP_PATH, PRODUCT_APP, "text/javascript; charset=utf-8");
  add(stylesheet, hostStaticPath(stylesheet.path));
  add(themeFile, hostStaticPath(themeFile.path));
  add(app, hostStaticPath(app.path));

  const pages = [...site.pages].sort(compareSitePages);
  let shellFragmentBytes = 0;
  const fragmentFiles = new Map<string, string>();
  for (const entry of pages) {
    assertFinalBuildBudgets(site.startedAtMs, site.baselineRssBytes, entry.page.target);
    const routeIssue = validateReportRoute(entry.page.target.route);
    if (routeIssue !== undefined || entry.page.target.route === "/_niceeval" ||
      entry.page.target.route.startsWith("/_niceeval/")) {
      throw siteFailure("path", routeIssue?.reason ?? "author routes cannot occupy /_niceeval");
    }
    const fragmentPath = fragmentPathForRoute(entry.page.target.route);
    const fragment = textFile(fragmentPath, renderFragment(site, entry), "application/json; charset=utf-8");
    if (fragment.bytes.byteLength > REPORT_FRAGMENT_BYTES_MAX) {
      throw reportBuildBudgetExceeded(
        "fragment-bytes",
        REPORT_FRAGMENT_BYTES_MAX,
        fragment.bytes.byteLength,
        { pageId: entry.page.target.pageId, route: entry.page.target.route },
      );
    }
    shellFragmentBytes += fragment.bytes.byteLength;
    if (shellFragmentBytes > REPORT_SHELL_FRAGMENT_BYTES_MAX) {
      throw reportBuildBudgetExceeded("shell-fragment-bytes", REPORT_SHELL_FRAGMENT_BYTES_MAX, shellFragmentBytes);
    }
    add(fragment, hostStaticPath(fragment.path));
    fragmentFiles.set(entry.page.target.route, fragment.path);
    for (const asset of entry.page.assets) addPageAsset(add, asset);
  }

  const shell = textFile("index.html", renderShell(site, pages), "text/html; charset=utf-8");
  shellFragmentBytes += shell.bytes.byteLength;
  if (shellFragmentBytes > REPORT_SHELL_FRAGMENT_BYTES_MAX) {
    throw reportBuildBudgetExceeded("shell-fragment-bytes", REPORT_SHELL_FRAGMENT_BYTES_MAX, shellFragmentBytes);
  }
  add(shell, hostStaticPath("index.html"));

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
  const landing = landingPage(pages);
  const manifestValue = Object.freeze({
    format: "niceeval.report-static/v2",
    sampleIdentity: site.sampleIdentity,
    reportIdentity: site.reportIdentity,
    title: {
      en: resolveLocalizedText(site.title, "en"),
      "zh-CN": resolveLocalizedText(site.title, "zh-CN"),
    },
    defaultRoute: landing.page.target.route,
    pages: pages.map((entry) => Object.freeze({
      pageId: entry.page.target.pageId,
      route: entry.page.target.route,
      fragment: fragmentFiles.get(entry.page.target.route)!,
      title: {
        en: resolveLocalizedText(entry.page.title, "en"),
        "zh-CN": resolveLocalizedText(entry.page.title, "zh-CN"),
      },
      navigation: entry.navigation,
      presentation: entry.presentation,
    })),
    files: [...files.keys(), MANIFEST_PATH, COMPLETE_PATH].sort(compareUtf8),
    stylesheet: REPORT_STYLESHEET_PATH,
    theme: REPORT_THEME_STYLESHEET_PATH,
    app: REPORT_APP_PATH,
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

function fragmentPathForRoute(route: string): string {
  return route === "/" ? `${REPORT_FRAGMENT_ROOT}/root.json` : `${REPORT_FRAGMENT_ROOT}${route}.json`;
}

function renderFragment(site: ClosedReportSite, entry: ClosedSitePage): string {
  const page = entry.page;
  const pageProblems = site.problems.filter((problem) =>
    problem.path.length === 0 || (problem.path[0] === "page" && problem.path[1] === page.target.pageId)
  );
  return `${canonicalJson({
    title: {
      en: resolveLocalizedText(page.title, "en"),
      "zh-CN": resolveLocalizedText(page.title, "zh-CN"),
    },
    html: {
      en: `${projection(page, "en")}${renderProblems(pageProblems, "en")}`,
      "zh-CN": `${projection(page, "zh-CN")}${renderProblems(pageProblems, "zh-CN")}`,
    },
  })}\n`;
}

function renderShell(
  site: ClosedReportSite,
  pages: readonly ClosedSitePage[],
): string {
  const first = pages[0]!;
  const rendererAssets = [...new Map(pages.flatMap((entry) => entry.page.assets).map((asset) => [asset.path, asset])).values()]
    .map((asset) => asset.kind === "style"
      ? `<link rel="stylesheet" href="${escapeAttribute(asset.path)}">`
      : asset.kind === "script"
        ? `<script src="${escapeAttribute(asset.path)}" defer></script>`
        : "").join("");
  return `<!doctype html><html class="niceeval-view-document" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(resolveLocalizedText(site.title, "en"))}</title><noscript><style>#root{display:none!important}</style></noscript><link rel="stylesheet" href="${REPORT_STYLESHEET_PATH}"><link rel="stylesheet" href="${REPORT_THEME_STYLESHEET_PATH}">${renderHead(first.page, "index.html")}${rendererAssets}<script src="${REPORT_APP_PATH}" defer></script></head><body><noscript><main class="niceeval-view-js-required" role="alert"><h1>JavaScript required</h1><p>Enable JavaScript to view this NiceEval report.</p></main></noscript><div id="root"></div></body></html>`;
}

function landingPage(pages: readonly ClosedSitePage[]): ClosedSitePage {
  const landing = pages.find((entry) => entry.presentation === "page");
  if (landing === undefined) throw siteFailure("render", "a report site requires at least one page presentation");
  return landing;
}

function renderProblems(problems: readonly ReportProblem[], locale: string): string {
  const visible = problems.filter((problem) => !isGenericMissingSlotProblem(problem));
  if (visible.length === 0) return "";
  const title = locale === "zh-CN" ? "数据说明" : "Data notes";
  return `<aside class="niceeval-view-problems"><h2>${title}</h2><ul>${visible.map((problem) =>
    `<li><code>${escapeText(problem.code)}</code>${problem.summary === undefined ? "" : ` — ${escapeText(problem.summary)}`}</li>`
  ).join("")}</ul></aside>`;
}

function isGenericMissingSlotProblem(problem: ReportProblem): boolean {
  return problem.code === "analysis-missing" &&
    problem.refs.length === 0 &&
    problem.summary === "the selected logical Slot has no input value";
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
  readonly problems: readonly ReportProblem[];
}): string {
  const hash = createHash("sha256");
  hash.update(canonicalJson({
    format: "niceeval.report-site-revision/v2",
    renderer: REPORT_APP_RENDERER,
    sampleIdentity: input.sampleIdentity,
    reportIdentity: input.reportIdentity,
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
