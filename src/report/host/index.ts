// This is the platform-neutral current-process host boundary. Node loaders,
// watchers, and filesystem services live at niceeval/report/host/node.
export { executeReport } from "./execute.ts";
export type {
  ReportAuthoringInvalid,
  ReportExecutionError,
} from "./execute.ts";
export {
  executeReportForAttemptFromRecord,
  executeReportFromRecord,
} from "./from-record.ts";
export type {
  ExecuteReportForAttemptFromRecordError,
  ExecuteReportFromRecordError,
  ExecuteReportFromRecordRequirements,
} from "./from-record.ts";
export type { ReportExecution } from "../execution/model.ts";
export {
  ReportConsole,
  renderReportExecutionProblemsText,
  renderReportExecutionText,
  showReport,
} from "./presentation.ts";
export type {
  ReportConsoleError,
  ReportConsoleService,
  ReportShowError,
  ReportShowRenderError,
  ShowReportInput,
} from "./presentation.ts";
export { openReportViewSession } from "./view-session.ts";
export type {
  OpenReportViewSessionInput,
  ReportViewOpenError,
  ReportViewProblem,
  ReportViewRebuildFailure,
  ReportViewExecutionRebuild,
  ReportViewRebuild,
  ReportViewRevision,
  ReportViewSession,
  ReportViewSessionClosed,
  ReportViewState,
  ReportViewThemeRebuild,
} from "./view-session.ts";
export { exportStaticReport, ReportFileSystem } from "./static.ts";
export type {
  ReportExportError,
  ReportExportExecutionProblem,
  ReportExportTargetExists,
  ReportFileSystemError,
  ReportFileSystemFailure,
  ReportFileSystemService,
  ReportHostOutputPath,
  ReportStaticExportReceipt,
} from "./static.ts";
