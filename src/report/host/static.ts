import { readFileSync } from "node:fs";
import { Context, Effect } from "effect";
import type {
  ClosedSiteFile,
  ClosedSiteRevision,
  ClosedReportNode,
  ClosedReportTree,
  ReportExecution,
  ReportLimitExceeded,
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
import type {
  ReportExecutionProblem,
  ReportProblemTableEntry,
} from "../execution/problems.ts";
import { validateClosedReportTree } from "../semantic/closed.ts";
import { renderReportHtml } from "./html.ts";
import {
  REPORT_CLASSIC_STYLESHEET_PATH,
  REPORT_REFRESH_RUNTIME_PATH,
} from "./site-assets.ts";
import {
  canonicalJson,
  closedDownloadPath,
  compareUtf8,
  isExecutionReportProblem,
  renderReportExecutionJson,
} from "./presentation.ts";
import { basalt, type ThemeDefinition } from "./theme.ts";
import { classicStylesheet } from "../assets/classic.ts";

/** A host-private normalized output path. Semantic routes never become filesystem paths directly. */
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
  /**
   * Begins exactly one export invocation. It exclusively creates the empty
   * target directory, or reports target-exists before any output byte is
   * written. Callers must not reuse a successful preparation across exports.
   */
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
  /** Does not include the final zero-byte complete marker. */
  readonly filesWritten: number;
}

export interface ReportExportExecutionProblem {
  readonly code: "report-export-execution-problem";
  readonly problems: readonly ReportExecutionProblem[];
}

/** A complete site cannot be formed when its semantic closure has execution failures. */
export interface ReportSiteBuildExecutionProblem {
  readonly code: "report-site-execution-problem";
  readonly problems: readonly ReportExecutionProblem[];
}

export interface ReportSiteBuildFailure {
  readonly code: "report-site-build-failed";
  readonly operation: "render" | "identity";
}

export type ReportSiteBuildError = ReportSiteBuildExecutionProblem | ReportSiteBuildFailure;

export type ReportExportError =
  | ReportLimitExceeded
  | ReportExportExecutionProblem
  | ReportExportTargetExists
  | ReportFileSystemError;

/**
 * SSG-first closure. It materializes every final page, host asset, and
 * download before a product surface may select a page or open a listener.
 * The resulting revision contains no renderer work or mutable host metadata.
 */
export function buildSiteRevision(input: {
  readonly execution: ReportExecution;
  readonly theme?: ThemeDefinition;
}): Effect.Effect<ClosedSiteRevision, ReportSiteBuildError> {
  return Effect.gen(function* () {
    const executionProblems = executionProblemsForStatic(input.execution.tree.problemTable);
    // A ClosedSiteRevision is publishable by definition. Product surfaces may
    // choose different projections only after the same complete SSG closure
    // succeeds; none may turn an incomplete execution into a valid revision.
    if (executionProblems.length > 0) {
      return yield* Effect.fail({
        code: "report-site-execution-problem" as const,
        problems: executionProblems,
      });
    }
    const files = yield* buildSiteFiles(input.execution, input.theme ?? basalt);
    const identity = yield* siteRevisionIdentity(input.execution, files);
    return Object.freeze({
      identity: Object.freeze({
        format: "niceeval.report-site-revision/v1" as const,
        contentHash: identity,
        renderer: "niceeval.report-ssg/v1" as const,
      }),
      execution: input.execution,
      files,
    });
  });
}

/**
 * Exports one fixed, static execution. Every output byte and collision is
 * calculated before the target is created; any execution problem fails closed.
 */
export function exportStaticReport(input: {
  readonly revision: ClosedSiteRevision;
  readonly out: string;
}): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return Effect.gen(function* () {
    const executionProblems = executionProblemsForStatic(input.revision.execution.tree.problemTable);
    if (executionProblems.length > 0) {
      return yield* Effect.fail({
        code: "report-export-execution-problem" as const,
        problems: executionProblems,
      });
    }

    const files = closedRevisionFiles(input.revision);
    const fileSystem = yield* ReportFileSystem;
    yield* fileSystem.prepareOutput(input.out);
    for (const file of files) {
      if (file.path === COMPLETE_PATH) continue;
      yield* fileSystem.writeFile({
        out: input.out,
        path: Object.freeze({ value: file.path }),
        bytes: file.bytes,
      });
    }
    // A failure or interruption above intentionally leaves a target without a
    // marker. A later attempt sees target-exists rather than reusing it.
    yield* fileSystem.writeCompleteMarker(input.out);
    yield* fileSystem.syncDirectory(input.out);
    return Object.freeze({ out: input.out, filesWritten: files.length - 1 });
  });
}

const HOST_DATA_PATH = "_niceeval/execution.json";
const MANIFEST_PATH = "_niceeval/manifest.json";
const PROBLEMS_PATH = "_niceeval/problems/index.html";
const COMPLETE_PATH = "_niceeval/complete";
const encoder = new TextEncoder();

/**
 * The identical enhancement asset is emitted for static export and live view.
 * A static/file site has no probe endpoint, so it exits without noise. The
 * report body, navigation, problem details, and downloads stay fully useful
 * when JavaScript is disabled or this fetch is unavailable.
 */
const REFRESH_PROBE_RUNTIME = `(() => {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const source = document.currentScript && document.currentScript.src;
  if (!source) return;
  const endpoint = new URL("refresh", source).toString();
  let observed;
  const probe = async () => {
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-niceeval-refresh-probe": "1" },
      });
      if (response.status !== 204) return;
      const identity = response.headers.get("x-niceeval-report-content-hash");
      if (response.headers.get("x-niceeval-view-stale") === "1" ||
        (observed !== undefined && identity !== null && identity !== observed)) {
        location.reload();
        return;
      }
      if (identity !== null) observed = identity;
      setTimeout(probe, 1000);
    } catch {
      // Missing/offline endpoints are an optional enhancement, not an error.
    }
  };
  setTimeout(probe, 1000);
})();
`;

// Package-owned browser behavior is closed into the same runtime byte that
// every generated document already references. The asset lives beside this
// compiled Host graph, so it never reaches into an author project or network.
const CLASSIC_TABS_ENHANCER = readFileSync(new URL("../react/enhance.js", import.meta.url), "utf8");

function buildSiteFiles(
  execution: ReportExecution,
  theme: ThemeDefinition,
): Effect.Effect<readonly ClosedSiteFile[], ReportSiteBuildFailure> {
  return Effect.gen(function* () {
    const hostData = yield* renderReportExecutionJson({ execution }).pipe(
      Effect.mapError((): ReportSiteBuildFailure => ({
        code: "report-site-build-failed" as const,
        operation: "render" as const,
      })),
    );
    return yield* Effect.try({
      try: () => buildStaticFiles(execution, theme, hostData),
      catch: (): ReportSiteBuildFailure => ({
        code: "report-site-build-failed" as const,
        operation: "render" as const,
      }),
    });
  });
}

function buildStaticFiles(
  execution: ReportExecution,
  theme: ThemeDefinition,
  hostData: string,
): readonly ClosedSiteFile[] {
  if (!validateClosedReportTree(execution.tree).valid) {
    throw new StaticPreflightError("the closed Report tree is invalid");
  }
  assertDownloadClosure(execution.tree);
  const files: ClosedSiteFile[] = [];
  const paths: ReportStaticPath[] = [];
  let hasRoot = false;

  for (const page of [...execution.tree.pages].sort(comparePages)) {
    requireValidRoute(page.route);
    const output = staticPathForRoute(page.route);
    if (page.route === "/") hasRoot = true;
    paths.push(output);
    files.push(staticTextFile(
      output.posix,
      renderReportHtml({ tree: execution.tree, page, theme }),
    ));
  }

  // Static output remains browseable even when an otherwise valid report has
  // no authored root route. A page at / owns index.html when it exists.
  if (!hasRoot) {
    const index = hostStaticPath("index.html");
    paths.push(index);
    files.push(staticTextFile(index.posix, renderReportHtml({
      tree: execution.tree,
      surface: "index",
      theme,
    })));
  }

  for (const download of [...execution.tree.downloads].sort((left, right) =>
    compareUtf8(closedDownloadPath(left), closedDownloadPath(right)) || compareUtf8(left.id, right.id)
  )) {
    const path = closedDownloadPath(download);
    requireValidDownloadPath(path);
    const output = staticPathForDownload(path);
    if (!(download.bytes instanceof Uint8Array)) {
      throw new StaticPreflightError("a closed download has invalid bytes");
    }
    paths.push(output);
    files.push(Object.freeze({
      path: output.posix,
      mediaType: download.mediaType,
      bytes: new Uint8Array(download.bytes),
    }));
  }

  const hostDataPath = hostStaticPath(HOST_DATA_PATH);
  const problemsPath = hostStaticPath(PROBLEMS_PATH);
  const stylesheetPath = hostStaticPath(REPORT_CLASSIC_STYLESHEET_PATH);
  const runtimePath = hostStaticPath(REPORT_REFRESH_RUNTIME_PATH);
  const manifestPath = hostStaticPath(MANIFEST_PATH);
  const completePath = hostStaticPath(COMPLETE_PATH);
  paths.push(hostDataPath, problemsPath, stylesheetPath, runtimePath, manifestPath, completePath);
  files.push(
    staticTextFile(hostDataPath.posix, hostData, "application/json; charset=utf-8"),
    staticTextFile(problemsPath.posix, renderReportHtml({
      tree: execution.tree,
      surface: "problems",
      theme,
    }), "text/html; charset=utf-8"),
    staticTextFile(stylesheetPath.posix, classicStylesheet, "text/css; charset=utf-8"),
    staticTextFile(
      runtimePath.posix,
      `${REFRESH_PROBE_RUNTIME}\n${CLASSIC_TABS_ENHANCER}`,
      "text/javascript; charset=utf-8",
    ),
  );

  preflightPaths(paths);
  const manifest = staticManifest(execution, files, manifestPath.posix);
  files.push(
    staticTextFile(manifestPath.posix, `${canonicalJson(manifest)}\n`, "application/json; charset=utf-8"),
    Object.freeze({ path: completePath.posix, mediaType: "application/octet-stream", bytes: new Uint8Array() }),
  );
  return Object.freeze([...files].sort((left, right) => compareUtf8(left.path, right.path)));
}

function staticManifest(
  execution: ReportExecution,
  files: readonly ClosedSiteFile[],
  manifestPath: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    format: "niceeval.report-static/v1",
    files: Object.freeze(
      [...files.map((file) => file.path), manifestPath, COMPLETE_PATH]
        .sort(compareUtf8),
    ),
    pages: Object.freeze(
      [...execution.tree.pages]
        .sort(comparePages)
        .map((page) => Object.freeze({
          pageId: page.pageId,
          route: page.route,
          navigation: page.navigation,
          path: staticPathForRoute(page.route).posix,
        })),
    ),
    downloads: Object.freeze(
      [...execution.tree.downloads]
        .sort((left, right) => compareUtf8(closedDownloadPath(left), closedDownloadPath(right)) || compareUtf8(left.id, right.id))
        .map((download) => Object.freeze({
          id: download.id,
          path: staticPathForDownload(closedDownloadPath(download)).posix,
          mediaType: download.mediaType,
          byteLength: download.bytes.byteLength,
        })),
    ),
    hostData: HOST_DATA_PATH,
    problems: PROBLEMS_PATH,
    stylesheet: REPORT_CLASSIC_STYLESHEET_PATH,
    runtime: REPORT_REFRESH_RUNTIME_PATH,
  });
}

function preflightPaths(paths: readonly ReportStaticPath[]): void {
  for (const path of paths) {
    if (encoder.encode(path.posix).byteLength > 1_024 ||
      path.segments.length === 0 || path.segments.some((segment) => encoder.encode(segment).byteLength > 128)) {
      throw new StaticPreflightError("a static output path exceeds its portable limit");
    }
  }
  if (staticPathConflicts(paths).length > 0) {
    throw new StaticPreflightError("static output paths collide on a supported filesystem");
  }
}

function requireValidRoute(route: string): void {
  if (validateReportRoute(route) !== undefined || route.split("/")[1] === "_niceeval") {
    throw new StaticPreflightError("a closed page route is invalid for static output");
  }
}

function requireValidDownloadPath(path: string): void {
  if (validateDownloadPath(path) !== undefined) {
    throw new StaticPreflightError("a closed download path is invalid for static output");
  }
}

/** Download nodes may only point at bytes already closed into this execution. */
function assertDownloadClosure(tree: ClosedReportTree): void {
  const downloadIds = new Set(tree.downloads.map((download) => download.id));
  for (const page of tree.pages) assertNodeDownloads(page.node, downloadIds);
}

function assertNodeDownloads(node: ClosedReportNode, downloadIds: ReadonlySet<string>): void {
  switch (node.type) {
    case "stack":
    case "grid":
    case "callout":
    case "element":
    case "link":
      for (const child of node.children) assertNodeDownloads(child, downloadIds);
      return;
    case "download":
      if (!downloadIds.has(node.id)) {
        throw new StaticPreflightError("a Download node does not target this closed execution");
      }
      for (const child of node.children) assertNodeDownloads(child, downloadIds);
      return;
    case "primitive":
      assertNodeDownloads(node.text, downloadIds);
      assertNodeDownloads(node.web, downloadIds);
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

function staticTextFile(path: string, text: string, mediaType = "text/html; charset=utf-8"): ClosedSiteFile {
  return Object.freeze({ path, mediaType, bytes: encoder.encode(text) });
}

/** Ensures every view/export consumer receives a deterministic, complete map. */
function closedRevisionFiles(revision: ClosedSiteRevision): readonly ClosedSiteFile[] {
  const files = [...revision.files].sort((left, right) => compareUtf8(left.path, right.path));
  const paths = new Set<string>();
  let hasComplete = false;
  for (const file of files) {
    if (paths.has(file.path) || file.path.length === 0 || !(file.bytes instanceof Uint8Array) || file.mediaType.length === 0) {
      throw new StaticPreflightError("a closed site revision has an invalid file map");
    }
    paths.add(file.path);
    if (file.path === COMPLETE_PATH) {
      if (file.bytes.byteLength !== 0) throw new StaticPreflightError("a complete marker must be zero bytes");
      hasComplete = true;
    }
  }
  if (!hasComplete) throw new StaticPreflightError("a closed site revision has no complete marker");
  return Object.freeze(files);
}

/**
 * The content address deliberately lives outside the emitted files, avoiding
 * a self-referential manifest while still hashing normalized closure metadata
 * and every final byte (including the zero-byte completion marker).
 */
function siteRevisionIdentity(
  execution: ReportExecution,
  files: readonly ClosedSiteFile[],
): Effect.Effect<string, ReportSiteBuildFailure> {
  const metadata = canonicalJson({
    format: "niceeval.report-site-revision/v1",
    renderer: "niceeval.report-ssg/v1",
    report: execution.report,
    sample: execution.sample,
  });
  const chunks: Uint8Array[] = [encoder.encode(metadata), new Uint8Array([0])];
  for (const file of [...files].sort((left, right) => compareUtf8(left.path, right.path))) {
    chunks.push(encoder.encode(file.path), new Uint8Array([0]));
    chunks.push(encoder.encode(file.mediaType), new Uint8Array([0]));
    chunks.push(new Uint8Array(file.bytes), new Uint8Array([0]));
  }
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const material = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    material.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    return Effect.fail({ code: "report-site-build-failed" as const, operation: "identity" as const });
  }
  return Effect.map(
    Effect.tryPromise({
      try: () => subtle.digest("SHA-256", material),
      catch: (): ReportSiteBuildFailure => ({
        code: "report-site-build-failed" as const,
        operation: "identity" as const,
      }),
    }),
    (digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

function comparePages(
  left: ReportExecution["tree"]["pages"][number],
  right: ReportExecution["tree"]["pages"][number],
): number {
  return compareUtf8(left.route, right.route) || compareUtf8(left.pageId, right.pageId);
}

function executionProblemsForStatic(
  table: readonly ReportProblemTableEntry[],
): readonly ReportExecutionProblem[] {
  return Object.freeze(table
    .filter(isExecutionReportProblem)
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((problem) => Object.freeze({
      category: "execution" as const,
      code: executionProblemCode(problem.code),
      summary: problem.summary,
    })));
}

function executionProblemCode(code: string): ReportExecutionProblem["code"] {
  return EXECUTION_PROBLEM_CODES.has(code as ReportExecutionProblem["code"])
    ? code as ReportExecutionProblem["code"]
    : "semantic-tree-invalid";
}

const EXECUTION_PROBLEM_CODES = new Set<ReportExecutionProblem["code"]>([
  "page-params-invalid",
  "page-load-failed",
  "page-render-failed",
  "component-compose-failed",
  "component-resolve-failed",
  "semantic-tree-invalid",
  "route-conflict",
  "download-conflict",
]);

class StaticPreflightError extends Error {}
