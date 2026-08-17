/** The exact public author surface fixed in docs/feature/reports/library.md. */

export { defineReport } from "./definition/report.ts";
export type {
  HeadTag,
  Page,
  PageContext,
  PageEvidence,
  PageLoad,
  PageLoadContext,
  PageParams,
  ParameterizedPage,
  PlainPage,
  PricingProfile,
  ReportDefinition,
  ReportMeta,
  ReportMetaPage,
  ReportShell,
  Sample,
} from "./definition/report.ts";

export { defineComponent } from "./definition/tree.ts";
export type {
  ComponentContext,
  ComponentFaces,
  ComposeContext,
  ReportComponent,
  ResolveContext,
  TextContext,
  WebContext,
} from "./definition/tree.ts";

export {
  agent,
  aggregate,
  attempt,
  evalId,
  experiment,
  flag,
  label,
  model,
  reasoningEffort,
} from "./model/aggregate.ts";
export type {
  AggregationSubject,
  GroupFunction,
} from "./model/aggregate.ts";

export {
  costUSD,
  durationMs,
  evidenceRow,
  passRate,
  tokens,
  totalCostUSD,
} from "./model/metrics.ts";
export type { EvidenceRow } from "./model/metrics.ts";
export type {
  AnalysisIssue,
  ClosedRows,
  CostBasis,
  CostCoverageReason,
  CostCoverageReasonCode,
  CostLedgerEntry,
  CostMeasure,
  CostMetricValue,
  CostProjectionAggregate,
  CostProjectionKnown,
  CostProjectionProfile,
  CostProjectionState,
  CostProjectionUnavailable,
  CostProjectionValue,
  EstimatedRequestCostComponent,
  EstimatedTokenCostComponent,
  EvidenceRef,
  MeasureFormat,
  MetricState,
  MetricValue,
  ObservedCostComponent,
  ObservedOtherCurrency,
  ProjectedMoney,
} from "../analysis/index.ts";

export { builtInPricingProfile, definePricingProfile } from "../analysis/index.ts";
export type {
  PricedCoverage,
  PricedCoverageInput,
  PricingCharge,
  PricingChargeInput,
  PricingCoverage,
  PricingCoverageId,
  PricingCoverageInput,
  PricingDisplay,
  PricingDisplayInput,
  PricingEffectiveCondition,
  PricingEffectiveConditionInput,
  PricingProfileContentIdentity,
  PricingProfileInput,
  PricingProvenance,
  PricingProvenanceInput,
  PricingSelector,
  PricingSelectorInput,
  UnpricedCoverage,
  UnpricedCoverageInput,
} from "../analysis/index.ts";

export {
  toAttemptEvidence,
  toAttemptObservability,
  toEvidenceRows,
  toFileChanges,
  toIssueRows,
  toIssueText,
  toMetricDetailRow,
  toSandboxHistory,
  toSourceNavigation,
  toSources,
} from "./model/conversions.ts";
export type { MetricDetailRow } from "./model/conversions.ts";
export type {
  AttemptEvidenceDomainView,
  AttemptObservabilityDomainView,
  FileChangesDomainView,
  SandboxHistoryDomainView,
  SourceNavigationDomainView,
  SourcesDomainView,
} from "../analysis/index.ts";

export {
  basalt,
  chalk,
  defineTheme,
} from "./theme.ts";
export type {
  ReportTheme,
  ThemeColor,
  ThemeDefinition,
  ThemeHex,
  ThemeSeries,
} from "./theme.ts";

export {
  presentDimension,
  shortestUniqueLabels,
} from "./presentation.ts";
export type {
  DimensionDeclaration,
  DimensionEncoding,
  PresentedDimension,
} from "./presentation.ts";

export {
  formatAxisTick,
  formatInstant,
  formatMetricValue,
  formatTimeDistance,
  missingText,
} from "./model/format.ts";
export type { MetricFormat } from "./model/format.ts";
export type { Cell, VerdictCounts } from "./definition/cell.tsx";

export {
  DEFAULT_REPORT_LOCALE,
  localizedTextEquals,
  resolveLocalizedText,
  resolveMetricLabel,
} from "./model/locale.ts";
export type {
  LocalizedText,
  ReportLocale,
} from "./model/locale.ts";

export {
  bar,
  columns,
  indent,
  padEnd,
  padStart,
  stringWidth,
  wrapText,
} from "./model/text-layout.ts";
export type { ColumnAlign } from "./model/text-layout.ts";

export {
  Area,
  applyBarsSortLimit,
  Bars,
  Callouts,
  Chart,
  Col,
  CommandEvidence,
  Conversation,
  TurnTrace,
  CopyBlock,
  DiffView,
  Grid,
  Line,
  Link,
  Markdown,
  Row,
  Scatter,
  Section,
  Series,
  SourceView,
  Stat,
  Style,
  Tab,
  Table,
  Tabs,
  Text,
  Waterfall,
} from "./definition/primitives.tsx";
export type {
  AreaProps,
  BarsProps,
  BarsSort,
  CalloutGroup,
  CalloutItem,
  CalloutLevel,
  CalloutsProps,
  ChartProps,
  ColProps,
  CommandEvidenceContent,
  CommandEvidenceItem,
  CommandEvidenceProps,
  ConversationContent,
  ConversationEntry,
  ConversationProps,
  TurnTraceProps,
  CopyBlockContent,
  CopyBlockProps,
  DiffChange,
  DiffContent,
  DiffFile,
  DiffViewProps,
  GridProps,
  LayoutProps,
  LineProps,
  MarkdownProps,
  RowProps,
  ScatterProps,
  SectionProps,
  SeriesProps,
  SourceContent,
  SourceViewProps,
  StatProps,
  StyleProps,
  TabProps,
  TableProps,
  TabsProps,
  TextProps,
  WaterfallContent,
  WaterfallNode,
  WaterfallProps,
} from "./definition/primitives.tsx";

export {
  Hero,
  HeroCard,
  PoweredBy,
  RunNotices,
  SampleFixPrompt,
  SampleNotices,
} from "./components/site-components/index.tsx";
export type {
  HeroCardProps,
  HeroLink,
  HeroLogo,
  HeroProps,
  RunNoticesProps,
  SampleFixPromptProps,
  SampleNoticesProps,
} from "./components/site-components/index.tsx";

export {
  ExperimentScatter,
  SampleOverview,
  SampleSummary,
  StabilityOverview,
} from "./components/summaries/index.tsx";
export type {
  ExperimentScatterProps,
  SampleOverviewProps,
  SampleSummaryProps,
  StabilityOverviewProps,
} from "./components/summaries/index.tsx";

export {
  AttemptList,
  ExperimentTable,
  FailureList,
} from "./components/entity-lists/index.tsx";
export type {
  AttemptListProps,
  ExperimentTableProps,
  FailureListProps,
} from "./components/entity-lists/index.tsx";

export {
  AttemptAssessment,
  AttemptDetails,
  AttemptSummary,
} from "./components/attempt-detail/index.tsx";
export type { AttemptDetailsProps } from "./components/attempt-detail/index.tsx";

export { ExperimentDetails } from "./components/experiment-detail/index.tsx";
export type { ExperimentDetailsProps } from "./components/experiment-detail/index.tsx";

export type {
  AttemptDetailTarget,
  ExperimentDetailTarget,
  LibraryDetailTarget,
} from "./library/details.ts";
