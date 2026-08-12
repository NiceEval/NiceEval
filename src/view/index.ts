// Node view facade. The production state machine is Effect-native in
// `niceeval/report/host/node`; these legacy-shaped CLI exports intentionally do
// not attempt to reopen the retired Record graph.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import {
  IncompatibleResultsError,
  ViewInputError,
  type ViewScanOptions,
} from "./data.ts";
import {
  openViewServer,
  type NodeViewServerError,
  type ReportViewServer,
  type ViewOptions,
} from "./server.ts";
import {
  exportStaticReport,
  ReportFileSystem,
  type ReportExportError,
  type ReportStaticExportReceipt,
} from "../report/host/static.ts";
import { makeNodeReportFileSystem } from "../report/host/node.ts";
import { basalt, type ThemeDefinition } from "../report/host/node/theme.ts";
import type { ReportExecution } from "../report/execution/model.ts";
import type { ReportViewSessionClosed } from "../report/host/view-session.ts";

export {
  NodeReportViewHost,
  NodeReportFileSystemLive,
  NodeReportViewHostLive,
  makeNodeReportFileSystem,
  openNodeReportView,
  openNodeReportViewServer,
} from "../report/host/node.ts";
export type {
  NodeReportViewHostService,
  ReportViewRequest,
} from "../report/host/node.ts";
export { exportStaticReport, ReportFileSystem } from "../report/host/static.ts";
export type {
  ReportExportError,
  ReportExportExecutionProblem,
  ReportExportTargetExists,
  ReportFileSystemError,
  ReportFileSystemFailure,
  ReportFileSystemService,
  ReportHostOutputPath,
  ReportStaticExportReceipt,
} from "../report/host/static.ts";
export {
  openReportViewSession,
} from "../report/host/view-session.ts";
export type {
  OpenReportViewSessionInput,
  ReportViewOpenError,
  ReportViewProblem,
  ReportViewRebuildFailure,
  ReportViewRevision,
  ReportViewSession,
  ReportViewSessionClosed,
  ReportViewState,
} from "../report/host/view-session.ts";
export {
  openViewServer,
  type NodeViewServerError,
  type ReportViewServer,
  type ViewOptions,
} from "./server.ts";
export { planSite, renderHtml, writeSite, type SiteFile, type SitePlan } from "./site.ts";
export {
  IncompatibleResultsError,
  ViewInputError,
  incompatibleHint,
  incompatibleHistoryKey,
  incompatibleViewCommand,
  loadCarryInputs,
  readCurrentExecutionReusePlanResults,
  readCurrentReusedAttempt,
  readFrozenAttemptAttachmentProjection,
  loadLatestResultsPerEval,
  loadViewScan,
  viewRoot,
  type CarryInputs,
  type CurrentReusedAttemptReadback,
  type CurrentReusedAttemptScore,
  type CurrentReusedAttemptSource,
  type CurrentReusedAttemptTarget,
  type CurrentReusedExecutionError,
  type CurrentReuseReadbackPlanInvalid,
  type IncompatibleRun,
  type LoadedDefinitions,
  type ReportPageRenderer,
  type ViewScan,
  type ViewScanOptions,
} from "./data.ts";

/** Retains CLI parsing rules without treating a positional value as Record data. */
export function resolveViewInput(
  cwd: string,
  positionals: readonly string[],
  options: { readonly record?: string; readonly run?: string } = {},
): { readonly input?: string; readonly patterns: string[] } {
  if (options.record !== undefined && options.run !== undefined) {
    throw new ViewInputError("--record and --run are mutually exclusive.");
  }
  if (options.record !== undefined) {
    const input = resolve(cwd, options.record);
    if (!existsSync(input)) throw new ViewInputError(`Record directory not found: ${input}`);
    return Object.freeze({ input, patterns: [...positionals] });
  }
  if (options.run !== undefined) {
    const input = resolve(cwd, options.run);
    if (!statSyncSafe(input)) throw new ViewInputError(`--run expects a readable Run file: ${input}`);
    return Object.freeze({ input, patterns: [...positionals] });
  }
  return Object.freeze({ patterns: [...positionals] });
}

export interface ReportViewExportInputError {
  readonly code: "report-view-export-input-invalid";
  readonly reason: string;
}

/** Effect-native `--out` composition around one immutable execution. */
export function exportViewSite(
  options: ViewOptions = {},
): Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError | ReportViewExportInputError | ReportViewSessionClosed,
  ReportFileSystem
> {
  const out = resolve(options.out ?? ".niceeval/site");
  if (/\.html?$/i.test(out)) {
    return Effect.fail(Object.freeze({
      code: "report-view-export-input-invalid" as const,
      reason: "--out expects a directory, not a single HTML file",
    }));
  }
  if (existsSync(out)) {
    return Effect.fail(Object.freeze({ code: "report-export-target-exists" as const }));
  }
  const revision: Effect.Effect<
    Readonly<{ readonly execution: ReportExecution; readonly theme: ThemeDefinition }>,
    ReportViewExportInputError | ReportViewSessionClosed
  > = options.reportExecution === undefined
    ? options.session === undefined
      ? Effect.fail<ReportViewExportInputError>(Object.freeze({
        code: "report-view-export-input-invalid" as const,
        reason: "view export needs a fixed ReportExecution or an open ReportViewSession",
      }))
      : Effect.map(options.session.snapshot, (state) => state.current)
    : Effect.succeed(Object.freeze({ execution: options.reportExecution, theme: options.theme ?? basalt }));
  return Effect.flatMap(revision, (value) => exportStaticReport({
    execution: value.execution,
    out,
    theme: value.theme,
  }));
}

/** Node-facing publication service, still entirely inside the caller's Effect. */
export function buildViewEffect(
  options: ViewOptions = {},
): Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError | ReportViewExportInputError | ReportViewSessionClosed
> {
  return exportViewSite(options).pipe(
    Effect.provideService(ReportFileSystem, makeNodeReportFileSystem()),
  );
}

function statSyncSafe(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
