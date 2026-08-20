import type { ReportProblem } from "./machine.ts";

/** Full-site budgets fixed by docs/feature/reports/architecture.md. */
export const REPORT_PAGES_MAX = 20_000;
export const REPORT_DOCUMENT_NODES_MAX = 20_000;
export const REPORT_DOCUMENT_DEPTH_MAX = 32;
export const REPORT_PAGE_HTML_BYTES_MAX = 16_777_216;
export const REPORT_SITE_HTML_BYTES_MAX = 268_435_456;
export const REPORT_BUILD_TIME_MS_MAX = 120_000;
export const REPORT_BUILD_RSS_BYTES_MAX = 1_342_177_280;
export const REPORT_DOWNLOAD_FILES_MAX = 1_000;
export const REPORT_DOWNLOAD_FILE_BYTES_MAX = 33_554_432;
export const REPORT_SOURCE_ASSET_BYTES_MAX = 8_388_608;
export const REPORT_DIFF_ASSET_BYTES_MAX = 4_194_304;
export const REPORT_SOURCE_DIFF_ASSET_BYTES_MAX = 134_217_728;
export const REPORT_STATIC_ASSET_BYTES_MAX = 268_435_456;

export type ReportBuildBudget =
  | "pages"
  | "document-nodes"
  | "document-depth"
  | "page-html-bytes"
  | "site-html-bytes"
  | "build-time"
  | "build-rss"
  | "download-files"
  | "download-file-bytes"
  | "source-asset-bytes"
  | "diff-asset-bytes"
  | "source-diff-asset-bytes"
  | "static-asset-bytes";

export interface ReportBuildBudgetExceeded {
  readonly code: "report-build-budget-exceeded";
  readonly budget: ReportBuildBudget;
  readonly maximum: number;
  readonly observedAtLeast: number;
  readonly pageId?: string;
  readonly route?: string;
}

export function reportBuildBudgetExceeded(
  budget: ReportBuildBudget,
  maximum: number,
  observedAtLeast: number,
  target?: { readonly pageId: string; readonly route: string },
): ReportBuildBudgetExceeded {
  return Object.freeze({
    code: "report-build-budget-exceeded" as const,
    budget,
    maximum,
    observedAtLeast,
    ...(target === undefined ? {} : target),
  });
}

/** One exact emitted resource. view and static read these same bytes. */
export interface ClosedSiteFile {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface ClosedSiteIdentity {
  readonly format: "niceeval.report-site-revision/v1";
  readonly renderer: "niceeval.report-ssg/v1";
  readonly contentHash: string;
}

const closedSiteRevisionTypeId: unique symbol = Symbol.for(
  "niceeval.report.closed-site-revision/v1",
);

/**
 * Publicly opaque full-site closure. The unexported unique-symbol member keeps
 * author code from constructing or inspecting it through the package type.
 */
export interface ClosedSiteRevision {
  readonly [closedSiteRevisionTypeId]: true;
}

/** @internal Transport and publisher view of the opaque revision. */
export interface ClosedSiteRevisionData extends ClosedSiteRevision {
  readonly identity: ClosedSiteIdentity;
  readonly files: readonly ClosedSiteFile[];
  readonly routes: readonly string[];
  /** The deterministic landing route when the revision has no root index.html. */
  readonly defaultRoute?: string;
  readonly problems: readonly ReportProblem[];
}

export function makeClosedSiteRevision(input: {
  readonly contentHash: string;
  readonly files: readonly ClosedSiteFile[];
  readonly routes: readonly string[];
  readonly defaultRoute?: string;
  readonly problems?: readonly ReportProblem[];
}): ClosedSiteRevision {
  if (typeof input.contentHash !== "string" || input.contentHash.length === 0) {
    throw new TypeError("ClosedSiteRevision requires a non-empty content hash");
  }
  const paths = new Set<string>();
  const files = input.files.map((file) => {
    if (!isPortablePath(file.path) || typeof file.mediaType !== "string" || file.mediaType.length === 0 ||
      !(file.bytes instanceof Uint8Array)) {
      throw new TypeError("ClosedSiteRevision files must contain a portable path, media type, and bytes");
    }
    if (paths.has(file.path)) throw new TypeError(`ClosedSiteRevision repeats file path ${JSON.stringify(file.path)}`);
    paths.add(file.path);
    return Object.freeze({
      path: file.path,
      mediaType: file.mediaType,
      bytes: new Uint8Array(file.bytes),
    });
  });
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const sourceRoutes = [...new Set(input.routes)];
  const routes = [...sourceRoutes].sort(compareUtf8);
  const defaultRoute = input.defaultRoute ?? sourceRoutes[0];
  if (defaultRoute !== undefined && !routes.includes(defaultRoute)) {
    throw new TypeError("ClosedSiteRevision default route must belong to its routes");
  }
  const revision: Omit<ClosedSiteRevisionData, typeof closedSiteRevisionTypeId> = {
    identity: Object.freeze({
      format: "niceeval.report-site-revision/v1" as const,
      renderer: "niceeval.report-ssg/v1" as const,
      contentHash: input.contentHash,
    }),
    files: Object.freeze(files),
    routes: Object.freeze(routes),
    ...(defaultRoute === undefined ? {} : { defaultRoute }),
    problems: Object.freeze([...(input.problems ?? [])]),
  };
  Object.defineProperty(revision, closedSiteRevisionTypeId, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(revision) as unknown as ClosedSiteRevision;
}

/** @internal The only way transports inspect an opaque revision. */
export function closedSiteRevisionData(value: ClosedSiteRevision): ClosedSiteRevisionData {
  if (!isClosedSiteRevision(value)) throw new TypeError("value is not a ClosedSiteRevision");
  return value;
}

export function isClosedSiteRevision(value: unknown): value is ClosedSiteRevisionData {
  if (typeof value !== "object" || value === null) return false;
  const brand = Object.getOwnPropertyDescriptor(value, closedSiteRevisionTypeId);
  return brand !== undefined && "value" in brand && brand.value === true &&
    Array.isArray((value as Partial<ClosedSiteRevisionData>).files) &&
    typeof (value as Partial<ClosedSiteRevisionData>).identity?.contentHash === "string";
}

function isPortablePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.endsWith("/") &&
    !value.includes("\\") && !value.includes("\u0000") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

const encoder = new TextEncoder();

export function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
