// A static site plan is a pure projection of one ReportExecution. Filesystem
// publication belongs to the report host's Effect boundary, not this planner.

import type { ReportExecution } from "../report/execution/model.ts";
import { renderReportExecutionText } from "../report/host/presentation.ts";
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
  readonly files: readonly SiteFile[];
}

export interface SitePlanOptions {
  readonly execution?: ReportExecution;
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
  const text = renderReportExecutionText({ execution });
  return Object.freeze({
    execution,
    files: Object.freeze([
      Object.freeze({
        path: "index.html",
        contentType: "text/html; charset=utf-8",
        content: renderHtml(text),
      }),
    ]),
  });
}

/** Publication stays Effect-native and writes the plan's fixed execution once. */
export function writeSite(
  plan: SitePlan,
  out: string,
): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return exportStaticReport({ execution: plan.execution, out });
}

export function renderHtml(text: string): string {
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
