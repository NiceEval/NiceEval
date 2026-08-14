/**
 * Execution result variants live with the closed execution model.  Keeping
 * this module as a type-only forwarding boundary avoids making renderer code
 * reach into host callback scheduling.
 */
export type {
  ClosedDownload,
  ClosedReportNode,
  ClosedReportPage,
  ClosedReportTree,
  ReportDownloadResult,
  ReportExecution,
  ReportExecutionIdentity,
  ReportPageResult,
  ReportPageSummary,
  ReportSampleSummary,
  ReportTargetSelection,
} from "./model.ts";
