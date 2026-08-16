import {
  closedSiteRevisionData,
  type ClosedSiteFile,
  type ClosedSiteRevision,
} from "../report/execution/model.ts";
import {
  REPORT_STATIC_RENDERER,
  REPORT_THEME_STYLESHEET_PATH,
} from "../report/host/static.ts";

const MANIFEST_PATH = "_niceeval/manifest.json";
const STATIC_RENDERER = REPORT_STATIC_RENDERER;
const VIEW_LOCALES = "en,zh-CN";
const decoder = new TextDecoder();

/**
 * The identity of one fully closed route. `paramsIdentity` is the canonical
 * route: parameter Pages have already encode/decode-validated it before any
 * bytes enter this cache. The completed static document always holds both
 * browser locales.
 */
export interface ClosedReportPageByteKey {
  readonly format: "niceeval.report-page-bytes/v1";
  readonly sampleIdentity: string;
  readonly selectionIdentity: string;
  readonly reportIdentity: string;
  readonly renderer: typeof STATIC_RENDERER;
  readonly pageId: string;
  readonly route: string;
  readonly paramsIdentity: string;
  readonly locales: typeof VIEW_LOCALES;
  readonly themeIdentity: string;
}

/** One route document after every callback, query, and renderer step closed. */
export interface ClosedReportPageBytesEntry {
  readonly key: ClosedReportPageByteKey;
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/**
 * Page-level cache data. It deliberately stores byte copies instead of a
 * ClosedSiteRevision, ResolvedPage, Sample, Scope, callback, or capability.
 * `sharedFiles` are the already-closed site assets/downloads/metadata needed
 * to publish the page documents as one consistent immutable revision.
 */
export interface ClosedReportPageBytes {
  readonly sampleIdentity: string;
  readonly selectionIdentity: string;
  readonly reportIdentity: string;
  readonly renderer: typeof STATIC_RENDERER;
  readonly themeIdentity: string;
  readonly pages: readonly ClosedReportPageBytesEntry[];
  readonly sharedFiles: readonly ClosedSiteFile[];
  readonly defaultRoute?: string;
}

/** The static Host remains the sole owner of revision identity signing. */
export type ResignClosedReportPageBytes = (input: {
  readonly sampleIdentity: string;
  readonly reportIdentity: string;
  readonly files: readonly ClosedSiteFile[];
  readonly routes: readonly string[];
  readonly defaultRoute?: string;
}) => ClosedSiteRevision;

/**
 * Extracts one immutable byte-only cache entry from a Host-issued revision.
 * Invalid or unrecognized static output simply opts out of page reuse.
 */
export function closeReportPageBytes(
  revision: ClosedSiteRevision,
  input: { readonly selectionIdentity: string; readonly themeIdentity: string },
): ClosedReportPageBytes | undefined {
  try {
    if (input.selectionIdentity.length === 0 || input.themeIdentity.length === 0) return undefined;
    const data = closedSiteRevisionData(revision);
    if (data.identity.format !== "niceeval.report-site-revision/v1" || data.identity.renderer !== STATIC_RENDERER) {
      return undefined;
    }
    const manifest = manifestIdentity(data.files);
    if (manifest === undefined || !sameFileSet(manifest.files, data.files)) return undefined;

    const filesByPath = new Map(data.files.map((file) => [file.path, file] as const));
    const pagePaths = new Set<string>();
    const pageEntries = new Set<string>();
    const routes = new Set<string>();
    const pages: ClosedReportPageBytesEntry[] = [];
    for (const page of manifest.pages) {
      const entryIdentity = `${page.pageId}\0${page.route}`;
      if (pagePaths.has(page.path) || pageEntries.has(entryIdentity) || routes.has(page.route)) return undefined;
      const file = filesByPath.get(page.path);
      if (file === undefined || !file.mediaType.startsWith("text/html")) return undefined;
      pagePaths.add(page.path);
      pageEntries.add(entryIdentity);
      routes.add(page.route);
      pages.push(Object.freeze({
        key: Object.freeze({
          format: "niceeval.report-page-bytes/v1" as const,
          sampleIdentity: manifest.sampleIdentity,
          selectionIdentity: input.selectionIdentity,
          reportIdentity: manifest.reportIdentity,
          renderer: STATIC_RENDERER,
          pageId: page.pageId,
          route: page.route,
          paramsIdentity: page.route,
          locales: VIEW_LOCALES,
          themeIdentity: input.themeIdentity,
        }),
        path: file.path,
        mediaType: file.mediaType,
        bytes: new Uint8Array(file.bytes),
      }));
    }
    if (pages.length === 0) return undefined;

    const sharedFiles = data.files.filter((file) => !pagePaths.has(file.path)).map(cloneFile);
    return Object.freeze({
      sampleIdentity: manifest.sampleIdentity,
      selectionIdentity: input.selectionIdentity,
      reportIdentity: manifest.reportIdentity,
      renderer: STATIC_RENDERER,
      themeIdentity: input.themeIdentity,
      pages: Object.freeze(pages),
      sharedFiles: Object.freeze(sharedFiles),
      ...(data.defaultRoute === undefined ? {} : { defaultRoute: data.defaultRoute }),
    });
  } catch {
    return undefined;
  }
}

/**
 * Reuses only completed route/shared bytes for a new Theme stylesheet. The
 * caller supplies the Host signer so cache code never owns static revision
 * hashing or its canonical JSON contract.
 */
export function rethemeClosedReportPageBytes(
  cached: ClosedReportPageBytes,
  themeCss: Uint8Array,
  resign: ResignClosedReportPageBytes,
): ClosedSiteRevision | undefined {
  try {
    if (!validPageCache(cached)) return undefined;
    let foundTheme = false;
    const files = [
      ...cached.pages.map((page): ClosedSiteFile => Object.freeze({
        path: page.path,
        mediaType: page.mediaType,
        bytes: new Uint8Array(page.bytes),
      })),
      ...cached.sharedFiles.map((file): ClosedSiteFile => {
        if (file.path !== REPORT_THEME_STYLESHEET_PATH) return cloneFile(file);
        foundTheme = true;
        return Object.freeze({
          path: file.path,
          mediaType: file.mediaType,
          bytes: new Uint8Array(themeCss),
        });
      }),
    ];
    if (!foundTheme) return undefined;
    const manifest = manifestIdentity(files);
    if (
      manifest === undefined ||
      manifest.sampleIdentity !== cached.sampleIdentity ||
      manifest.reportIdentity !== cached.reportIdentity ||
      !sameFileSet(manifest.files, files)
    ) return undefined;
    return resign({
      sampleIdentity: cached.sampleIdentity,
      reportIdentity: cached.reportIdentity,
      files,
      routes: cached.pages.map((page) => page.key.route),
      ...(cached.defaultRoute === undefined ? {} : { defaultRoute: cached.defaultRoute }),
    });
  } catch {
    return undefined;
  }
}

interface StaticManifest {
  readonly sampleIdentity: string;
  readonly reportIdentity: string;
  readonly pages: readonly { readonly pageId: string; readonly route: string; readonly path: string }[];
  readonly files: readonly string[];
}

function manifestIdentity(files: readonly ClosedSiteFile[]): StaticManifest | undefined {
  const manifest = files.find((file) => file.path === MANIFEST_PATH);
  if (manifest === undefined) return undefined;
  const value: unknown = JSON.parse(decoder.decode(manifest.bytes));
  if (
    !isRecord(value) ||
    value.format !== "niceeval.report-static/v1" ||
    typeof value.sampleIdentity !== "string" ||
    value.sampleIdentity.length === 0 ||
    typeof value.reportIdentity !== "string" ||
    value.reportIdentity.length === 0 ||
    !Array.isArray(value.pages) ||
    !Array.isArray(value.files)
  ) return undefined;
  const pages = value.pages.map((entry) => {
    if (!isRecord(entry) || typeof entry.pageId !== "string" || entry.pageId.length === 0 ||
      typeof entry.route !== "string" || entry.route.length === 0 ||
      typeof entry.path !== "string" || entry.path.length === 0) return undefined;
    return Object.freeze({ pageId: entry.pageId, route: entry.route, path: entry.path });
  });
  if (pages.some((page) => page === undefined) || value.files.some((path) => typeof path !== "string")) {
    return undefined;
  }
  return Object.freeze({
    sampleIdentity: value.sampleIdentity,
    reportIdentity: value.reportIdentity,
    pages: Object.freeze(pages as { readonly pageId: string; readonly route: string; readonly path: string }[]),
    files: Object.freeze([...value.files] as string[]),
  });
}

function validPageCache(cached: ClosedReportPageBytes): boolean {
  if (
    cached.renderer !== STATIC_RENDERER ||
    cached.sampleIdentity.length === 0 ||
    cached.selectionIdentity.length === 0 ||
    cached.reportIdentity.length === 0 ||
    cached.themeIdentity.length === 0 ||
    cached.pages.length === 0
  ) return false;
  const pagePaths = new Set<string>();
  const pageEntries = new Set<string>();
  const routes = new Set<string>();
  for (const page of cached.pages) {
    const key = page.key;
    const entryIdentity = `${key.pageId}\0${key.route}`;
    if (
      pagePaths.has(page.path) || pageEntries.has(entryIdentity) || routes.has(key.route) ||
      key.format !== "niceeval.report-page-bytes/v1" ||
      key.sampleIdentity !== cached.sampleIdentity ||
      key.selectionIdentity !== cached.selectionIdentity ||
      key.reportIdentity !== cached.reportIdentity ||
      key.renderer !== cached.renderer || key.paramsIdentity !== key.route ||
      key.locales !== VIEW_LOCALES || key.themeIdentity !== cached.themeIdentity ||
      !page.mediaType.startsWith("text/html") || !(page.bytes instanceof Uint8Array)
    ) return false;
    pagePaths.add(page.path);
    pageEntries.add(entryIdentity);
    routes.add(key.route);
  }
  const filePaths = new Set<string>(pagePaths);
  for (const file of cached.sharedFiles) {
    if (filePaths.has(file.path) || !(file.bytes instanceof Uint8Array)) return false;
    filePaths.add(file.path);
  }
  return cached.defaultRoute === undefined || routes.has(cached.defaultRoute);
}

function sameFileSet(paths: readonly string[], files: readonly ClosedSiteFile[]): boolean {
  return paths.length === files.length && new Set(paths).size === paths.length &&
    paths.every((path) => files.some((file) => file.path === path));
}

function cloneFile(file: ClosedSiteFile): ClosedSiteFile {
  return Object.freeze({ path: file.path, mediaType: file.mediaType, bytes: new Uint8Array(file.bytes) });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
