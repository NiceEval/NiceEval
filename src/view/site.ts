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
  type ReportExportError,
  type ReportFileSystem,
  type ReportStaticExportReceipt,
} from "../report/host/static.ts";
import type { ViewScanOptions } from "./data.ts";
import type { Effect } from "effect";

export interface SiteFile {
  readonly path: string;
  readonly contentType: string;
  readonly content: string;
}

export interface SitePlan {
  readonly execution: ReportExecution;
  /** A site is fixed to the same closed Theme as its source view revision. */
  readonly theme: ThemeDefinition;
  readonly files: readonly SiteFile[];
}

export interface SitePlanOptions {
  readonly execution?: ReportExecution;
  readonly theme?: ThemeDefinition;
}

export function planSite(
  _input?: string,
  options: ViewScanOptions = {},
  site: SitePlanOptions = {},
): SitePlan {
  const execution = site.execution ?? options.execution;
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
    theme,
    files: Object.freeze([
      Object.freeze({
        path: "index.html",
        contentType: "text/html; charset=utf-8",
        content: root === undefined
          ? renderHtml(renderReportExecutionText({ execution }), theme)
          : renderHtml({ document: root.document, route: root.route, theme }),
      }),
    ]),
  });
}

/** Publication stays Effect-native and writes the plan's fixed execution once. */
export function writeSite(
  plan: SitePlan,
  out: string,
): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
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
