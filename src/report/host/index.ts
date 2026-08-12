// This is the current-process host boundary. A future ./node host may own
// loaders, watchers, and filesystem services, but it must consume the fixed
// ReportExecution produced here instead of reopening a Sample or Record.
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
export {
  basalt,
  chalk,
  NodeReportViewHost,
  NodeReportFileSystemLive,
  NodeReportViewHostLive,
  loadTrustedReportConfig,
  loadTrustedReportModule,
  loadTrustedThemeModule,
  makeNodeReportFileSystem,
  openNodeReportView,
  openNodeReportViewServer,
  ReportModuleLoadError,
  resolveTrustedModulePath,
} from "./node.ts";
export type {
  LoadedTrustedConfig,
  LoadedTrustedReport,
  LoadedTrustedTheme,
  NodeReportViewHostService,
  NodeViewServerError,
  ReportModuleLoadCode,
  ReportModuleLoadStage,
  ReportViewRequest,
  ReportViewServer,
  ThemeDefinition,
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
