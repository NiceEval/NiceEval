// niceeval/report is the Report authoring surface. Execution is deliberately
// separate at niceeval/report/host; legacy show/view implementation remains
// package-private behind its own internal imports.
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
  ReportBlockV1,
  ReportChartV1,
  ReportCodeV1,
  ReportDocumentClosure,
  ReportDocumentIssue,
  ReportDocumentV1,
  ReportDocumentValidation,
  ReportInlineV1,
  ReportListV1,
  ReportMetricV1,
  ReportParagraphV1,
  ReportScalarV1,
  ReportSectionV1,
  ReportStatusV1,
  ReportTableV1,
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
