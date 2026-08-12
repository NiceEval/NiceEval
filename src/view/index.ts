// View is a thin Node host over an already completed ReportExecution. Record
// opening, AnalysisSample selection, projection, and report execution belong
// to the application composition boundary in `cli.ts`.

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

export { openReportViewSession } from "../report/host/view-session.ts";
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
export type { ViewScanOptions } from "./data.ts";
