import { Context, Effect } from "effect";
import type { ReportExecution, ReportLimitExceeded } from "../execution/model.ts";
import type { ReportExecutionProblem } from "../execution/problems.ts";
import {
  renderReportExecutionJson,
  renderReportExecutionProblemsText,
  renderReportExecutionText,
  type ReportShowRenderError,
} from "./presentation.ts";

/** A host-private normalized output path. Author route strings never become filesystem paths directly. */
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
 * Exports exactly one completed execution. This never invokes author code or
 * reads Record data; any execution problem fails closed before the first write.
 * Each invocation prepares its target once before writing any output byte.
 */
export function exportStaticReport(input: {
  readonly execution: ReportExecution;
  readonly out: string;
}): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return Effect.gen(function* () {
    const executionProblems = input.execution.problemTable
      .map((entry) => entry.problem)
      .filter((problem): problem is ReportExecutionProblem => problem.category === "execution");
    if (executionProblems.length > 0) {
      return yield* Effect.fail({
        code: "report-export-execution-problem" as const,
        problems: Object.freeze(executionProblems),
      });
    }

    const fileSystem = yield* ReportFileSystem;
    const files = yield* staticFiles(input.execution).pipe(
      Effect.mapError((error): ReportFileSystemError => ({
        code: "report-export-write-failed",
        operation: error.operation,
      })),
    );
    yield* fileSystem.prepareOutput(input.out);
    for (const file of files) {
      yield* fileSystem.writeFile({
        out: input.out,
        path: Object.freeze({ value: file.path }),
        bytes: file.bytes,
      });
    }
    yield* fileSystem.writeCompleteMarker(input.out);
    yield* fileSystem.syncDirectory(input.out);
    return Object.freeze({ out: input.out, filesWritten: files.length });
  });
}

interface StaticFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function staticFiles(
  execution: ReportExecution,
): Effect.Effect<readonly StaticFile[], ReportShowRenderError> {
  const encoder = new TextEncoder();
  return Effect.try({
    try: () => {
      const files: StaticFile[] = [];
      let wroteRootPage = false;
      for (const page of [...execution.pages].sort(comparePages)) {
        if (page.state !== "rendered") continue;
        if (page.route === "/") wroteRootPage = true;
        const text = renderReportExecutionText({ execution, page: page.route });
        files.push(Object.freeze({
          path: outputPathForRoute(page.route),
          bytes: encoder.encode(renderStaticHtml(text)),
        }));
      }
      // An execution may have no rendered author route (for example, every
      // page is data-unavailable). Preserve a root document in that case so
      // the built-in problems surface remains reachable in a static host.
      if (!wroteRootPage) {
        files.push(Object.freeze({
          path: "index.html",
          bytes: encoder.encode(renderStaticHtml(renderReportExecutionText({ execution }))),
        }));
      }
      for (const download of [...execution.downloads].sort((left, right) => compareText(left.downloadId, right.downloadId))) {
        if (download.state !== "built") continue;
        for (const file of [...download.files].sort((left, right) => compareText(left.path, right.path))) {
          files.push(Object.freeze({
            path: `downloads/${file.path}`,
            bytes: new Uint8Array(file.bytes),
          }));
        }
      }
      files.push(Object.freeze({
        path: "_niceeval/problems/index.html",
        bytes: encoder.encode(renderStaticHtml(renderReportExecutionProblemsText(execution))),
      }));
      return files;
    },
    catch: (): ReportShowRenderError => ({
      code: "report-show-render-failed",
      operation: "render",
    }),
  }).pipe(Effect.flatMap((files) =>
    Effect.map(renderReportExecutionJson({ execution }), (json) => {
      files.push(Object.freeze({
        path: "_niceeval/execution.json",
        bytes: encoder.encode(json),
      }));
      return Object.freeze(files.sort((left, right) => compareText(left.path, right.path)));
    })
  ));
}

function comparePages(
  left: ReportExecution["pages"][number],
  right: ReportExecution["pages"][number],
): number {
  if (left.route !== undefined && right.route !== undefined) {
    const route = compareText(left.route, right.route);
    return route === 0 ? compareText(left.pageId, right.pageId) : route;
  }
  if (left.route !== undefined) return -1;
  if (right.route !== undefined) return 1;
  return compareText(left.pageId, right.pageId);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function outputPathForRoute(route: string): string {
  return route === "/" ? "index.html" : `${route.slice(1)}/index.html`;
}

function renderStaticHtml(text: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>NiceEval report</title><body><pre>${escapeHtml(text)}</pre></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
