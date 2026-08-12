// niceeval/report is the Report authoring surface. Execution is deliberately
// separate at niceeval/report/host.
export {
  defineCalculation,
  defineDownload,
  definePage,
  definePageFamily,
  defineReport,
  reportComponentId,
  reportDownloadPath,
  reportId,
  reportInputs,
  reportInstanceKey,
  reportInstanceKeyFromRecordId,
  reportRoute,
  reportRouteFromKeys,
} from "./author/index.ts";

export type {
  AnyReportCalculation,
  Report,
  ReportCalculation,
  ReportCalculationResults,
  ReportCalculationSet,
  ReportCompleteness,
  ReportComponentContext,
  ReportComponentId,
  ReportDataPlan,
  ReportDataShape,
  ReportDataState,
  ReportDownload,
  ReportDownloadFile,
  ReportDownloadPath,
  ReportId,
  ReportInstanceKey,
  ReportPage,
  ReportPageFamily,
  ReportPathIssue,
  ReportProjectedValues,
  ReportRoute,
} from "./author/index.ts";

export {
  REPORT_DOCUMENT_DEPTH_MAX,
  REPORT_DOCUMENT_NODES_MAX,
  freezeReportDocument,
  reportChart,
  reportCode,
  reportCodeBlock,
  reportDocument,
  reportEmphasis,
  reportLink,
  reportList,
  reportMetric,
  reportParagraph,
  reportSection,
  reportStatus,
  reportTable,
  reportText,
  validateReportDocument,
} from "./semantic/index.ts";

export type {
  ReportBlock,
  ReportChart,
  ReportCode,
  ReportDocumentClosure,
  ReportDocumentIssue,
  ReportDocument,
  ReportDocumentValidation,
  ReportInline,
  ReportList,
  ReportMetric,
  ReportParagraph,
  ReportScalar,
  ReportSection,
  ReportStatus,
  ReportTable,
} from "./semantic/index.ts";

// Completed execution data is immutable and safe for an author to inspect.
// Constructors, host callbacks, and scheduling mechanics stay private.
export type {
  ReportExecution,
} from "./execution/model.ts";
export type {
  ReportCalculationExecutionResult,
  ReportCalculationResult,
  ReportDownloadResult,
  ReportPageFamilyResult,
  ReportPageResult,
  ReportProjectionId,
  ReportProjectionSummary,
} from "./execution/results.ts";
export type {
  ReportExecutionProblem,
  ReportProblem,
  ReportProblemId,
  ReportProblemTable,
  ReportProblemTableEntry,
  ReportRecordedDataProblem,
} from "./execution/problems.ts";
