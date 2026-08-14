import type { SampleSnapshot } from "../../analysis/contracts.ts";
import type { LocalizedText } from "../../shared/types.ts";
import {
  freezeClosedReportTree,
  type ClosedDownload,
  type ClosedReportNode,
  type ClosedReportPage,
  type ClosedReportProblem,
  type ClosedReportTree,
} from "../semantic/closed.ts";

/** A target never implies callback work outside its requested route closure. */
export type ReportTargetSelection =
  | { readonly kind: "show"; readonly route?: string }
  | { readonly kind: "view"; readonly route: string }
  | { readonly kind: "static" };

export const REPORT_PAGES_MAX = 20_000;
export const REPORT_DOCUMENT_NODES_MAX = 20_000;
export const REPORT_DOCUMENT_DEPTH_MAX = 32;
export const REPORT_DOWNLOAD_FILES_MAX = 1_000;
export const REPORT_DOWNLOAD_FILE_BYTES_MAX = 33_554_432;

export interface ReportLimitExceeded {
  readonly code: "report-limit-exceeded";
  readonly limit:
    | "pages"
    | "document-nodes"
    | "document-depth"
    | "download-files"
    | "download-file-bytes";
  readonly maximum: number;
  readonly observedAtLeast: number;
}

export interface ReportDefinitionIssue {
  readonly path: readonly string[];
  readonly reason: string;
}

export interface ReportDefinitionInvalid {
  readonly code: "report-definition-invalid";
  readonly issues: readonly ReportDefinitionIssue[];
}

export interface ReportRouteInvalid {
  readonly code: "report-route-invalid";
  readonly route: string;
  readonly reason: string;
}

/** A value identity, never the author module that supplied its definition. */
export interface ReportExecutionIdentity {
  readonly id: string;
  readonly title?: LocalizedText;
}

/** A portable copy of selection facts; it intentionally omits Sample capability. */
export interface ReportSampleSummary {
  readonly identity: SampleSnapshot["identity"];
  readonly selection: SampleSnapshot["selection"];
  readonly coverage: SampleSnapshot["coverage"];
  /** Counts are computed from the narrowed, non-excluded Snapshot frame. */
  readonly runCount: number;
  readonly slotCount: number;
  readonly denominator: number;
}

export interface ReportPageSummary {
  readonly pageId: string;
  readonly path: string;
  readonly kind: "plain" | "parameterized";
  readonly instanceCount: number;
}

export type {
  ClosedDownload,
  ClosedReportNode,
  ClosedReportPage,
  ClosedReportProblem,
  ClosedReportTree,
};

export type ReportPageResult =
  | {
      readonly state: "rendered";
      readonly pageId: string;
      readonly route: string;
      readonly tree: ClosedReportPage;
      readonly problemIds: readonly number[];
    }
  | {
      readonly state: "execution-failed";
      readonly pageId: string;
      readonly route?: string;
      readonly problemIds: readonly [number, ...number[]];
    };

export type ReportDownloadResult =
  | {
      readonly state: "built";
      readonly download: ClosedDownload;
    }
  | {
      readonly state: "execution-failed";
      readonly downloadId: string;
      readonly problemIds: readonly [number, ...number[]];
    };

/**
 * One immutable execution.  Renderer code reads `tree` only; page results
 * retain target-local failure isolation for show, view, and static policy.
 */
export interface ReportExecution {
  readonly report: ReportExecutionIdentity;
  readonly sample: ReportSampleSummary;
  readonly target: ReportTargetSelection;
  readonly pageSummaries: readonly ReportPageSummary[];
  readonly pages: readonly ReportPageResult[];
  readonly downloads: readonly ReportDownloadResult[];
  readonly problemTable: readonly ClosedReportProblem[];
  readonly tree: ClosedReportTree;
}

/**
 * Freezes renderer-safe Sample facts after all narrowing is complete. Report
 * never reopens Record or infers these counts from physical storage.
 */
export function reportSampleSummary(snapshot: SampleSnapshot): ReportSampleSummary {
  const activeSlots = snapshot.slots.filter((slot) => slot.state !== "excluded");
  const runIds = new Set(activeSlots.map((slot) => slot.runId));
  return Object.freeze({
    identity: Object.freeze({ ...snapshot.identity }),
    selection: freezeSampleSelection(snapshot.selection),
    coverage: Object.freeze({ ...snapshot.coverage }),
    runCount: runIds.size,
    slotCount: activeSlots.length,
    denominator: activeSlots.length,
  });
}

export function reportLimit(
  limit: ReportLimitExceeded["limit"],
  maximum: number,
  observedAtLeast: number,
): ReportLimitExceeded {
  return Object.freeze({
    code: "report-limit-exceeded" as const,
    limit,
    maximum,
    observedAtLeast,
  });
}

/** Materializes one renderer-safe execution after all callback work has ended. */
export function freezeReportExecution(input: {
  readonly report: ReportExecutionIdentity;
  readonly sample: ReportSampleSummary;
  readonly target: ReportTargetSelection;
  readonly pageSummaries: readonly ReportPageSummary[];
  readonly pages: readonly ReportPageResult[];
  readonly downloads: readonly ReportDownloadResult[];
  readonly problemTable: readonly ClosedReportProblem[];
}): ReportExecution {
  const tree = freezeClosedReportTree({
    pages: input.pages.flatMap((page) => page.state === "rendered" ? [page.tree] : []),
    downloads: input.downloads.flatMap((download) => download.state === "built" ? [download.download] : []),
    problemTable: input.problemTable,
  });
  assertClosedDownloadLinks(tree);
  const pageByKey = indexClosedPages(tree.pages);
  const downloadById = indexClosedDownloads(tree.downloads);
  const pages = Object.freeze(input.pages.map((page) => freezePageResult(page, pageByKey)));
  const downloads = Object.freeze(input.downloads.map((download) => freezeDownloadResult(download, downloadById)));
  return Object.freeze({
    report: Object.freeze({
      id: input.report.id,
      ...(input.report.title === undefined ? {} : { title: freezeLocalizedText(input.report.title) }),
    }),
    sample: freezeReportSampleSummary(input.sample),
    target: freezeTarget(input.target),
    pageSummaries: Object.freeze(input.pageSummaries.map((page) => Object.freeze({ ...page }))),
    pages,
    downloads,
    problemTable: tree.problemTable,
    tree,
  });
}

function freezeReportSampleSummary(input: ReportSampleSummary): ReportSampleSummary {
  return Object.freeze({
    identity: Object.freeze({ ...input.identity }),
    selection: freezeSampleSelection(input.selection),
    coverage: Object.freeze({ ...input.coverage }),
    runCount: input.runCount,
    slotCount: input.slotCount,
    denominator: input.denominator,
  });
}

function freezeSampleSelection(
  selection: SampleSnapshot["selection"],
): SampleSnapshot["selection"] {
  const selectedRunIds = Object.freeze([...selection.selectedRunIds]);
  const problems = Object.freeze(selection.problems.map((problem) => Object.freeze({ ...problem })));
  if (selection.policy === "explicit-runs") {
    return Object.freeze({
      policy: "explicit-runs" as const,
      runIds: Object.freeze([...selection.runIds]),
      selectedRunIds,
      problems,
    });
  }
  return Object.freeze({
    policy: "project-current" as const,
    experimentIds: selection.experimentIds === "all"
      ? "all"
      : Object.freeze([...selection.experimentIds]),
    selectedRunIds,
    problems,
  });
}

export function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const delta = leftBytes[index]! - rightBytes[index]!;
    if (delta !== 0) return delta;
  }
  return leftBytes.length - rightBytes.length;
}

function freezePageResult(
  value: ReportPageResult,
  pages: ReadonlyMap<string, ClosedReportPage>,
): ReportPageResult {
  if (value.state === "rendered") {
    const tree = pages.get(closedPageKey(value.pageId, value.route));
    if (tree === undefined) {
      throw new TypeError("a rendered Page result must occur in the closed Report tree");
    }
    return Object.freeze({
      state: "rendered" as const,
      pageId: value.pageId,
      route: value.route,
      tree,
      problemIds: tree.problemIds,
    });
  }
  return Object.freeze({
    state: "execution-failed" as const,
    pageId: value.pageId,
    ...(value.route === undefined ? {} : { route: value.route }),
    problemIds: freezeNonEmpty(value.problemIds),
  });
}

function freezeDownloadResult(
  value: ReportDownloadResult,
  downloads: ReadonlyMap<string, ClosedDownload>,
): ReportDownloadResult {
  if (value.state === "execution-failed") {
    return Object.freeze({
      state: "execution-failed" as const,
      downloadId: value.downloadId,
      problemIds: freezeNonEmpty(value.problemIds),
    });
  }
  const download = downloads.get(value.download.id);
  if (download === undefined) {
    throw new TypeError("a built Download result must occur in the closed Report tree");
  }
  return Object.freeze({
    state: "built" as const,
    download,
  });
}

function freezeNonEmpty(value: readonly [number, ...number[]]): readonly [number, ...number[]] {
  const copy: [number, ...number[]] = [value[0], ...value.slice(1)];
  return Object.freeze(copy);
}

function closedPageKey(pageId: string, route: string): string {
  return `${pageId}\u0000${route}`;
}

function indexClosedPages(pages: readonly ClosedReportPage[]): ReadonlyMap<string, ClosedReportPage> {
  const indexed = new Map<string, ClosedReportPage>();
  for (const page of pages) {
    const key = closedPageKey(page.pageId, page.route);
    if (indexed.has(key)) throw new TypeError("a closed Report tree cannot repeat a Page route");
    indexed.set(key, page);
  }
  return indexed;
}

function indexClosedDownloads(downloads: readonly ClosedDownload[]): ReadonlyMap<string, ClosedDownload> {
  const indexed = new Map<string, ClosedDownload>();
  for (const download of downloads) {
    if (indexed.has(download.id)) throw new TypeError("a closed Report tree cannot repeat a Download id");
    indexed.set(download.id, download);
  }
  return indexed;
}

function assertClosedDownloadLinks(tree: ClosedReportTree): void {
  const ids = new Set(tree.downloads.map((download) => download.id));
  for (const page of tree.pages) assertNodeDownloadLinks(page.node, ids);
}

function assertNodeDownloadLinks(node: ClosedReportNode, ids: ReadonlySet<string>): void {
  switch (node.type) {
    case "stack":
    case "grid":
    case "callout":
      for (const child of node.children) assertNodeDownloadLinks(child, ids);
      return;
    case "download":
      if (!ids.has(node.id)) throw new TypeError("a closed Download node must target this Report execution");
      for (const child of node.children) assertNodeDownloadLinks(child, ids);
      return;
    case "primitive":
      assertNodeDownloadLinks(node.text, ids);
      assertNodeDownloadLinks(node.web, ids);
      return;
    case "text":
    case "table":
    case "bars":
    case "line":
    case "scatter":
    case "stat":
      return;
  }
}

function freezeTarget(value: ReportTargetSelection): ReportTargetSelection {
  switch (value.kind) {
    case "show":
      return Object.freeze({
        kind: "show" as const,
        ...(value.route === undefined ? {} : { route: value.route }),
      });
    case "view":
      return Object.freeze({ kind: "view" as const, route: value.route });
    case "static":
      return Object.freeze({ kind: "static" as const });
  }
}

function freezeLocalizedText(value: LocalizedText): LocalizedText {
  return typeof value === "string" ? value : Object.freeze({ ...value });
}
