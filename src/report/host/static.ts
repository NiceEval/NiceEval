import { Context, Effect } from "effect";
import type {
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
  canonicalJson,
  closedDownloadPath,
  compareUtf8,
  isExecutionReportProblem,
  renderReportExecutionJson,
  type ReportShowRenderError,
} from "./presentation.ts";
import { basalt, type ThemeDefinition } from "./theme.ts";

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

export type ReportExportError =
  | ReportLimitExceeded
  | ReportExportExecutionProblem
  | ReportExportTargetExists
  | ReportFileSystemError;

/**
 * Exports one fixed, static execution. Every output byte and collision is
 * calculated before the target is created; any execution problem fails closed.
 */
export function exportStaticReport(input: {
  readonly execution: ReportExecution;
  readonly out: string;
  /** A closed host Theme; omission uses the same Basalt default as live view. */
  readonly theme?: ThemeDefinition;
}): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return Effect.gen(function* () {
    const executionProblems = executionProblemsForStatic(input.execution.tree.problemTable);
    if (executionProblems.length > 0) {
      return yield* Effect.fail({
        code: "report-export-execution-problem" as const,
        problems: executionProblems,
      });
    }

    // This computes every HTML byte, download byte placement, host-data byte,
    // manifest byte, and collision before prepareOutput can create the target.
    const files = yield* staticFiles(input.execution, input.theme ?? basalt).pipe(
      Effect.mapError((error): ReportFileSystemError => ({
        code: "report-export-write-failed",
        operation: error.operation,
      })),
    );
    const fileSystem = yield* ReportFileSystem;
    yield* fileSystem.prepareOutput(input.out);
    for (const file of files) {
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
    return Object.freeze({ out: input.out, filesWritten: files.length });
  });
}

interface StaticFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

const HOST_DATA_PATH = "_niceeval/execution.json";
const MANIFEST_PATH = "_niceeval/manifest.json";
const PROBLEMS_PATH = "_niceeval/problems/index.html";
const RUNTIME_PATH = "_niceeval/runtime.js";
const COMPLETE_PATH = "_niceeval/complete";
const encoder = new TextEncoder();

function staticFiles(
  execution: ReportExecution,
  theme: ThemeDefinition,
): Effect.Effect<readonly StaticFile[], ReportShowRenderError> {
  return Effect.gen(function* () {
    const hostData = yield* renderReportExecutionJson({ execution });
    return yield* Effect.try({
      try: () => buildStaticFiles(execution, theme, hostData),
      catch: (): ReportShowRenderError => ({
        code: "report-show-render-failed",
        operation: "render",
      }),
    });
  });
}

function buildStaticFiles(
  execution: ReportExecution,
  theme: ThemeDefinition,
  hostData: string,
): readonly StaticFile[] {
  if (!validateClosedReportTree(execution.tree).valid) {
    throw new StaticPreflightError("the closed Report tree is invalid");
  }
  assertDownloadClosure(execution.tree);
  const files: StaticFile[] = [];
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
    files.push(Object.freeze({ path: output.posix, bytes: new Uint8Array(download.bytes) }));
  }

  const hostDataPath = hostStaticPath(HOST_DATA_PATH);
  const problemsPath = hostStaticPath(PROBLEMS_PATH);
  const runtimePath = hostStaticPath(RUNTIME_PATH);
  const manifestPath = hostStaticPath(MANIFEST_PATH);
  const completePath = hostStaticPath(COMPLETE_PATH);
  paths.push(hostDataPath, problemsPath, runtimePath, manifestPath, completePath);
  files.push(
    staticTextFile(hostDataPath.posix, hostData),
    staticTextFile(problemsPath.posix, renderReportHtml({
      tree: execution.tree,
      surface: "problems",
      theme,
    })),
    // The document intentionally does not load this. It is present as a
    // fixed built-in host asset without making JS necessary for any content.
    staticTextFile(runtimePath.posix, "export {};\n"),
  );

  preflightPaths(paths);
  const manifest = staticManifest(execution, files, manifestPath.posix);
  files.push(staticTextFile(manifestPath.posix, `${canonicalJson(manifest)}\n`));
  return Object.freeze([...files].sort((left, right) => compareUtf8(left.path, right.path)));
}

function staticManifest(
  execution: ReportExecution,
  files: readonly StaticFile[],
  manifestPath: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    format: "niceeval.report-static/v1",
    files: Object.freeze(
      [...files.map((file) => file.path), manifestPath]
        .sort(compareUtf8),
    ),
    pages: Object.freeze(
      [...execution.tree.pages]
        .sort(comparePages)
        .map((page) => Object.freeze({
          pageId: page.pageId,
          route: page.route,
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
    runtime: RUNTIME_PATH,
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

function staticTextFile(path: string, text: string): StaticFile {
  return Object.freeze({ path, bytes: encoder.encode(text) });
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
