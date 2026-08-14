// A static site plan is a pure projection of one ReportExecution. Filesystem
// publication belongs to the report host's Effect boundary, not this planner.

import type { ReportExecution } from "../report/execution/model.ts";
import {
  renderReportHtml,
  type RenderReportHtmlInput,
} from "../report/host/html.ts";
import { renderReportExecutionText } from "../report/host/presentation.ts";
import { basalt, type ThemeDefinition } from "../report/host/node/theme.ts";
import {
  exportStaticReport,
  exportStaticReportViewClosure,
  type ReportExportError,
  type ReportFileSystem,
  type ReportStaticExportReceipt,
} from "../report/host/static.ts";
import type { ViewRevisionClosure } from "../report/host/view-closure.ts";
import type { ViewScanOptions } from "./data.ts";
import type { Effect } from "effect";

export interface SiteFile {
  readonly path: string;
  readonly contentType: string;
  readonly content: string;
}

export interface SitePlan {
  readonly execution: ReportExecution;
  /**
   * The validated bilingual closure a site plan may carry. When present,
   * publication writes one English canonical page per ordinary route and the
   * closed zh-CN host data from the same closure.
   */
  readonly closure?: ViewRevisionClosure;
  /** A site is fixed to the same closed Theme as its source view revision. */
  readonly theme: ThemeDefinition;
  readonly files: readonly SiteFile[];
}

export interface SitePlanOptions {
  readonly execution?: ReportExecution;
  readonly closure?: ViewRevisionClosure;
  readonly theme?: ThemeDefinition;
}

export function planSite(
  _input?: string,
  options: ViewScanOptions = {},
  site: SitePlanOptions = {},
): SitePlan {
  const execution = site.execution ?? site.closure?.en ?? options.execution;
  if (execution === undefined) {
    throw new Error("A static Report site requires a completed ReportExecution.");
  }
  const theme = site.theme ?? basalt;
  const root = execution.pages.find(
    (page): page is Extract<ReportExecution["pages"][number], { readonly state: "rendered" }> =>
      page.state === "rendered" && page.route === "/",
  );
  return Object.freeze({
    execution,
    ...(site.closure === undefined ? {} : { closure: site.closure }),
    theme,
    files: Object.freeze([
      Object.freeze({
        path: "index.html",
        contentType: "text/html; charset=utf-8",
        content: root === undefined
          ? renderReportHtml({
              text: renderReportExecutionText({ execution }),
              locale: execution.locale,
              theme,
            })
          : renderHtml({ document: root.document, route: root.route, locale: execution.locale, theme }),
      }),
    ]),
  });
}

/**
 * Publication stays Effect-native. A closure plan writes one English
 * canonical HTML page per ordinary route plus the closed zh-CN host data; a
 * single-execution plan keeps the legacy low-level export.
 */
export function writeSite(
  plan: SitePlan,
  out: string,
): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  if (plan.closure !== undefined) {
    return exportStaticReportViewClosure({ closure: plan.closure, out, theme: plan.theme });
  }
  return exportStaticReport({ execution: plan.execution, out, theme: plan.theme });
}

export function renderHtml(text: string, theme?: ThemeDefinition): string;
export function renderHtml(input: RenderReportHtmlInput): string;
export function renderHtml(
  input: string | RenderReportHtmlInput,
  theme?: ThemeDefinition,
): string {
  return typeof input === "string"
    ? renderReportHtml({ text: input, ...(theme === undefined ? {} : { theme }) })
    : renderReportHtml(input);
}
