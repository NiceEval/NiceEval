// A site plan is an exact projection of one already-closed SiteRevision.
// Rendering and filesystem publication belong to the report host's Effect
// boundaries; this module must never rebuild a subset of Report callbacks.

import type { ClosedSiteRevision } from "../report/execution/model.ts";
import {
  renderReportHtml,
  type RenderReportHtmlInput,
} from "../report/host/html.ts";
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
  /** Exact closed bytes, including binary downloads and host assets. */
  readonly bytes: Uint8Array;
}

export interface SitePlan {
  readonly revision: ClosedSiteRevision;
  readonly files: readonly SiteFile[];
}

export interface SitePlanOptions {
  readonly revision?: ClosedSiteRevision;
}

/**
 * Retained as a view-level inspection helper. It only copies the revision's
 * finished file mapping; `writeSite` below publishes that same mapping.
 */
export function planSite(
  _input?: string,
  options: ViewScanOptions = {},
  site: SitePlanOptions = {},
): SitePlan {
  const revision = site.revision ?? options.revision;
  if (revision === undefined) {
    throw new Error("A static Report site requires a completed ClosedSiteRevision.");
  }
  return Object.freeze({
    revision,
    files: Object.freeze(revision.files.map((file) => Object.freeze({
      path: file.path,
      contentType: file.mediaType,
      bytes: new Uint8Array(file.bytes),
    }))),
  });
}

/** Publication writes the exact closed revision, never a fresh render. */
export function writeSite(
  plan: SitePlan,
  out: string,
): Effect.Effect<ReportStaticExportReceipt, ReportExportError, ReportFileSystem> {
  return exportStaticReport({ revision: plan.revision, out });
}

/** A standalone HTML helper, separate from SiteRevision construction. */
export function renderHtml(input: RenderReportHtmlInput): string {
  return renderReportHtml(input);
}
