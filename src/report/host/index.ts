// This is the current-process host boundary. A future ./node host may own
// loaders, watchers, and filesystem services, but it must consume the fixed
// ReportExecution produced here instead of reopening a Sample or Record.
export { executeReport } from "./execute.ts";
export type {
  ReportDefinitionInvalid,
  ReportExecutionError,
} from "./execute.ts";
export type { ReportExecution } from "../execution/model.ts";
export {
  ReportConsole,
  renderReportExecutionJson,
  renderReportExecutionProblemsText,
  renderReportExecutionText,
  reportExecutionShowDocument,
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
  ReportViewRevision,
  ReportViewSession,
  ReportViewSessionClosed,
  ReportViewState,
} from "./view-session.ts";
export {
  NodeReportViewHost,
  NodeReportFileSystemLive,
  NodeReportViewHostLive,
  makeNodeReportFileSystem,
  openNodeReportView,
  openNodeReportViewServer,
} from "./node.ts";
export type {
  NodeReportViewHostService,
  NodeViewServerError,
  ReportViewRequest,
  ReportViewServer,
  ViewOptions,
} from "./node.ts";
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
