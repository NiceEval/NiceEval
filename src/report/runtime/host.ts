// Compatibility import path for in-repository callers while the old report
// runtime is retired. This module deliberately has no loader, Record, Sample,
// page callback, or Promise runtime of its own.

export {
  executeReport,
  ReportConsole,
  renderReportExecutionProblemsText,
  renderReportExecutionText,
  showReport,
  openReportViewSession,
  exportStaticReport,
  ReportFileSystem,
  NodeReportFileSystemLive,
  makeNodeReportFileSystem,
} from "../host/index.ts";
export type {
  OpenReportViewSessionInput,
  ReportConsoleError,
  ReportConsoleService,
  ReportDefinitionInvalid,
  ReportExecution,
  ReportExecutionError,
  ReportShowError,
  ReportShowRenderError,
  ReportViewOpenError,
  ReportViewProblem,
  ReportViewRebuildFailure,
  ReportViewRevision,
  ReportViewSession,
  ReportViewSessionClosed,
  ReportViewState,
  ShowReportInput,
  ReportExportError,
  ReportExportExecutionProblem,
  ReportExportTargetExists,
  ReportFileSystemError,
  ReportFileSystemFailure,
  ReportFileSystemService,
  ReportHostOutputPath,
  ReportStaticExportReceipt,
} from "../host/index.ts";
export {
  NodeReportViewHost,
  NodeReportViewHostLive,
  openNodeReportView,
  openNodeReportViewServer,
} from "../host/node.ts";
export type {
  NodeReportViewHostService,
  NodeViewServerError,
  ReportViewRequest,
  ReportViewServer,
  ViewOptions,
} from "../host/node.ts";
