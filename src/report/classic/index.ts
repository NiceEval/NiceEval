export {
  aggregate,
  agent,
  costUSD,
  durationMs,
  evalId,
  experiment,
  foldEvalVerdict,
  mean,
  meanMetric,
  passRate,
  rollup,
  scoreStatus,
  scoringComposition,
  tokens,
  totalScore,
  totalAttempts,
} from "./aggregate.ts";
export type {
  AggregateRow,
  Calculation,
  ClassicCalculation,
  GroupFunction,
  Reducer,
  RollupCalculation,
  RollupOptions,
  ScoreStatus,
  ScoringComposition,
} from "./aggregate.ts";

export {
  AttemptAssessment,
  AttemptSummary,
  Bars,
  Col,
  CopyBlock,
  ExperimentScatter,
  ExperimentTable,
  Grid,
  Hero,
  SampleNotices,
  SampleSummary,
  Section,
  Stat,
  Table,
} from "./components.ts";
export type {
  ClassicBarsProps,
  ClassicCellTableProps,
  ClassicColProps,
  ClassicGridProps,
  ClassicHeroLogo,
  ClassicHeroProps,
  ClassicSectionProps,
  ClassicStatProps,
  CopyBlockProps,
  StatTone,
} from "./components.ts";

export { formatCellText } from "./cell.ts";
export type { Cell, VerdictCounts } from "./cell.ts";

export {
  toAttemptFixPrompt,
  toAttemptListRows,
  toAttemptSummary,
  toSummaryItems,
} from "./conversions.ts";

export { formatMetricValue } from "./format.ts";

export type {
  AttemptEvidence,
  AttemptListItem,
  AttemptSummaryData,
  CopyBlockContent,
  SampleSummaryContent,
} from "./attempt.ts";

export {
  defineReport,
  isClassicReport,
  classicReportContents,
  isClassicReportDefinition,
  renderClassicDocument,
} from "./define.ts";
export type {
  ClassicCompiledPage,
  ClassicPageRender,
  ClassicReportContents,
  ClassicReportDefinition,
  ClassicReportPageDefinition,
} from "./define.ts";

export { bindClassicHost, classicHostBinding } from "./host.ts";
export type { ClassicHostBinding } from "./host.ts";

export {
  defineComponent,
  Fragment,
  jsx,
  jsxDEV,
  jsxs,
} from "./jsx.ts";
export type {
  ClassicComponent,
  ClassicComponentContext,
  ClassicElement,
} from "./jsx.ts";

export {
  isLocalizedText,
  resolveClassicLocale,
  resolveLocalizedText,
} from "./localize.ts";
export type { ClassicLocale, LocalizedText } from "./localize.ts";

export { metricValue, isMetricValue } from "./metric.ts";
export type { MetricBasis, MetricBetter, MetricBounds, MetricFormat, MetricValue } from "./metric.ts";

export {
  CLASSIC_SELECTION_PROFILE_UNAVAILABLE,
  currentDeclarationSelectionOrigin,
  partialClassicSelectionOrigin,
} from "./origin.ts";
export type {
  ClassicExperimentProfile,
  ClassicSelectionNotice,
  ClassicSelectionOrigin,
} from "./origin.ts";

export { buildClassicSample } from "./project.ts";
export type { ClassicProjectedInputs } from "./project.ts";

export { classicAttemptTarget, slotKey, unitKey } from "./sample.ts";
export type {
  AggregationSubject,
  ClassicAttemptRow,
  ClassicAttemptTarget,
  ClassicEvalUnit,
  ClassicExperimentView,
  ClassicMetadataOrigin,
  ClassicRunView,
  ClassicSample,
  ClassicVerdict,
  Sample,
} from "./sample.ts";
