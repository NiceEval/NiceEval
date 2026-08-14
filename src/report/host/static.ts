import { Context, Effect } from "effect";
import {
  staticPathForReportDownload,
  staticPathForReportRoute,
} from "../author/identity.ts";
import type { ReportExecution, ReportLimitExceeded } from "../execution/model.ts";
import type { ReportExecutionProblem } from "../execution/problems.ts";
import {
  renderReportExecutionJson,
  renderReportExecutionProblemsText,
  renderReportExecutionText,
  type ReportShowRenderError,
} from "./presentation.ts";
import { renderReportHtml } from "./html.ts";
import { basalt, type ThemeDefinition } from "./theme.ts";
import type { ViewRevisionClosure } from "./view-closure.ts";

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
  /** A closed host Theme; omission uses the same Basalt default as live view. */
  readonly theme?: ThemeDefinition;
}): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return Effect.gen(function* () {
    const executionProblems = executionProblemsOf(input.execution);
    if (executionProblems.length > 0) {
      return yield* Effect.fail({
        code: "report-export-execution-problem" as const,
        problems: Object.freeze(executionProblems),
      });
    }

    const fileSystem = yield* ReportFileSystem;
    const files = yield* staticFiles(input.execution, input.theme ?? basalt).pipe(
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

/**
 * Exports a validated bilingual view closure. Every ordinary canonical route
 * gets exactly one English no-JavaScript HTML page; the Simplified Chinese
 * execution is delivered as closed host data on the same routes, so the
 * built-in runtime can switch localized text without locale routes or
 * duplicated canonical pages. Downloads are written once (closure validation
 * already proved the two locale file sets identical). Execution problems in
 * either locale execution fail closed before the first write.
 */
export function exportStaticReportViewClosure(input: {
  readonly closure: ViewRevisionClosure;
  readonly out: string;
  /** A closed host Theme; omission uses the same Basalt default as live view. */
  readonly theme?: ThemeDefinition;
}): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return Effect.gen(function* () {
    const enProblems = executionProblemsOf(input.closure.en);
    const zhCNProblems = executionProblemsOf(input.closure["zh-CN"]);
    const executionProblems = enProblems.length > 0 ? enProblems : zhCNProblems;
    if (executionProblems.length > 0) {
      return yield* Effect.fail({
        code: "report-export-execution-problem" as const,
        problems: Object.freeze(executionProblems),
      });
    }

    const fileSystem = yield* ReportFileSystem;
    const files = yield* closureStaticFiles(input.closure, input.theme ?? basalt).pipe(
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

function executionProblemsOf(execution: ReportExecution): readonly ReportExecutionProblem[] {
  return execution.problemTable
    .map((entry) => entry.problem)
    .filter((problem): problem is ReportExecutionProblem => problem.category === "execution");
}

interface StaticFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

function staticFiles(
  execution: ReportExecution,
  theme: ThemeDefinition,
): Effect.Effect<readonly StaticFile[], ReportShowRenderError> {
  const encoder = new TextEncoder();
  return renderedStaticFiles(execution, theme, encoder).pipe(
    Effect.flatMap((files) =>
      Effect.map(renderReportExecutionJson({ execution }), (json) => {
        files.push(Object.freeze({
          path: "_niceeval/execution.json",
          bytes: encoder.encode(json),
        }));
        return Object.freeze(files.sort((left, right) => compareText(left.path, right.path)));
      })
    ),
  );
}

/**
 * One closure publishes the English canonical pages and downloads once, then
 * both locale host-data documents. Closure validation already proved that
 * the two executions share routes, downloads, and business payloads, so the
 * zh-CN execution is delivered only as closed per-route content (embedded by
 * the renderer for the built-in language runtime) plus host data — never as
 * duplicated HTML or a locale route.
 */
function closureStaticFiles(
  closure: ViewRevisionClosure,
  theme: ThemeDefinition,
): Effect.Effect<readonly StaticFile[], ReportShowRenderError> {
  const encoder = new TextEncoder();
  const en = closure.en;
  const zhCN = closure["zh-CN"];
  const zhCNByRoute = new Map<string, { readonly locale: ReportExecution["locale"]; readonly page: ReportExecution["pages"][number] }>();
  for (const page of zhCN.pages) {
    if (page.route !== undefined) zhCNByRoute.set(page.route, { locale: zhCN.locale, page });
  }
  return renderedStaticFiles(en, theme, encoder, zhCNByRoute).pipe(
    Effect.flatMap((files) =>
      Effect.flatMap(renderReportExecutionJson({ execution: en }), (enJson) =>
        Effect.map(renderReportExecutionJson({ execution: zhCN }), (zhCNJson) => {
          files.push(Object.freeze({
            path: "_niceeval/execution.json",
            bytes: encoder.encode(enJson),
          }));
          files.push(Object.freeze({
            path: "_niceeval/execution.zh-CN.json",
            bytes: encoder.encode(zhCNJson),
          }));
          return Object.freeze(files.sort((left, right) => compareText(left.path, right.path)));
        })
      )
    ),
  );
}

function renderedStaticFiles(
  execution: ReportExecution,
  theme: ThemeDefinition,
  encoder: TextEncoder,
  localePages?: ReadonlyMap<string, {
    readonly locale: ReportExecution["locale"];
    readonly page: ReportExecution["pages"][number];
  }>,
): Effect.Effect<StaticFile[], ReportShowRenderError> {
  return Effect.try({
    try: () => {
      const files: StaticFile[] = [];
      let wroteRootPage = false;
      for (const page of [...execution.pages].sort(comparePages)) {
        if (page.state !== "rendered") continue;
        if (page.route === "/") wroteRootPage = true;
        const localeEntry = localePages?.get(page.route);
        const localePage = localeEntry?.page;
        files.push(Object.freeze({
          path: staticPathForReportRoute(page.route).posix,
          bytes: encoder.encode(renderReportHtml({
            document: page.document,
            route: page.route,
            locale: execution.locale,
            theme,
            ...(localeEntry === undefined || localePage === undefined || localePage.state !== "rendered"
              ? {}
              : { localeDocuments: Object.freeze([{ locale: localeEntry.locale, document: localePage.document }]) }),
          })),
        }));
      }
      // An execution may have no rendered author route (for example, every
      // page is data-unavailable). Preserve a root document in that case so
      // the built-in problems surface remains reachable in a static host.
      if (!wroteRootPage) {
        files.push(Object.freeze({
          path: "index.html",
          bytes: encoder.encode(renderReportHtml({
            text: renderReportExecutionText({ execution }),
            locale: execution.locale,
            theme,
          })),
        }));
      }
      for (const download of [...execution.downloads].sort((left, right) => compareText(left.downloadId, right.downloadId))) {
        if (download.state !== "built") continue;
        for (const file of [...download.files].sort((left, right) => compareText(left.path, right.path))) {
          files.push(Object.freeze({
            path: staticPathForReportDownload(file.path).posix,
            bytes: new Uint8Array(file.bytes),
          }));
        }
      }
      files.push(Object.freeze({
        path: "_niceeval/problems/index.html",
        bytes: encoder.encode(renderReportHtml({
          text: renderReportExecutionProblemsText(execution),
          locale: execution.locale,
          theme,
        })),
      }));
      return files;
    },
    catch: (): ReportShowRenderError => ({
      code: "report-show-render-failed",
      operation: "render",
    }),
  });
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
