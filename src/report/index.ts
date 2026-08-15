/**
 * `niceeval/report` is the complete Report author surface.  It restores the
 * familiar v0.12 vocabulary while delegating statistics to `niceeval/analysis`
 * and leaving Record readers, revisions, and renderer ownership with Host.
 */

export {
  aggregate,
  attemptEvidenceView,
  attemptObservabilityView,
  costUSD,
  fileChangesView,
  query,
  sandboxHistoryView,
  sourcesView,
} from "../analysis/index.ts";
export type {
  AggregateRequest,
  AggregateRow,
  ClosedRows,
  Dimension,
  DomainView,
  DomainViewQuery,
  DomainViewRequest,
  Measure,
  MetricValue,
  Sample,
  SemanticFrame,
} from "../analysis/index.ts";

export {
  agent,
  durationMs,
  evalId,
  experiment,
  hasMetricValue,
  metricCoverage,
  metricFacts,
  model,
  passRate,
  sortRowsByMetric,
} from "./model/calculation.ts";
export type {
  MetricFacts,
  ReportDimension,
  ReportMeasure,
} from "./model/calculation.ts";

export {
  toEvidenceRows,
  toIssueRows,
  toIssueText,
  toMetricDetailRow,
} from "./model/conversions.ts";
export type { MetricDetailRow } from "./model/conversions.ts";

export {
  formatAxisTick,
  formatLocalizedText,
  formatMetricNumber,
  formatMetricValue,
  missingText,
  presentMetric,
} from "./model/format.ts";
export type { MetricPresentation } from "./model/format.ts";

export {
  DEFAULT_REPORT_LOCALE,
  localizedText,
  localizedTextEquals,
  resolveLocalizedText,
} from "./model/locale.ts";
export type { LocalizedText, ReportLocale } from "./model/locale.ts";

export {
  CLASSIC_SERIES_COLORS,
  presentDimension,
  shortestUniqueLabels,
  stableColorIndex,
} from "./model/presentation.ts";
export type {
  DimensionDeclaration,
  DimensionEncoding,
  PresentedDimension,
} from "./model/presentation.ts";

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
  DEFAULT_PAGE_ID,
  DEFAULT_PAGE_TITLE,
  buildReportMeta,
  defineReport,
  isReport,
  isReportDefinition,
  resolveReportTitle,
  reportDefinition,
  Style,
} from "./definition.ts";
export type {
  DimensionPins,
  EvidenceLocator,
  HeadAttributes,
  HeadAttributeValue,
  HeadTag,
  NormalizedPageDefinition,
  NormalizedParameterizedPageDefinition,
  NormalizedPlainPageDefinition,
  NonEmptyArray,
  PageDefinition,
  PageEvidence,
  PageLoad,
  PageLoadContext,
  PageParams,
  PageRender,
  ParameterizedPageDefinition,
  PlainPageDefinition,
  Report,
  ReportDefinition,
  ReportMeta,
  ReportMetaPage,
  ReportShell,
  StyleDeclaration,
  StyleNode,
  StyleProps,
} from "./definition.ts";

export {
  Callout,
  defineComponent,
  Download,
  Stack,
} from "./components.ts";
export type {
  AuthorComposeContext,
  AuthorResolveContext,
  ChartAxisKey,
  ChartDimensionKey,
  ChartProps,
  ComponentFaces,
  ComposeContext,
  DownloadFile,
  PageContext,
  ReportComponent,
  ResolveContext,
  TableColumn,
  TextContext,
  WebContext,
} from "./components.ts";

export {
  Area,
  applyBarsSortLimit,
  Bars,
  Callouts,
  Chart,
  Col,
  CommandEvidence,
  Conversation,
  CopyBlock,
  DiffView,
  Grid,
  Line,
  Markdown,
  Metric,
  Row,
  Scatter,
  Section,
  Series,
  SourceView,
  Stat,
  Tab,
  Table,
  Tabs,
  Text,
  Waterfall,
} from "./classic/primitives.ts";
export type {
  BarsSort,
  CalloutItem,
  ClassicChild,
  ClassicChildren,
  ClassicChartProps,
  ClassicNode,
  CommandEvidenceItem,
  ConversationEntry,
  DiffFile,
  LayoutProps,
  SourceBlock,
  TabItem,
  WaterfallRow,
} from "./classic/primitives.ts";

export {
  AttemptAssessment,
  AttemptDetails,
  AttemptList,
  AttemptSummary,
  Comparison,
  DataList,
  EvidenceSummary,
  ExperimentDetails,
  ExperimentScatter,
  ExperimentTable,
  FailureList,
  Hero,
  HeroCard,
  IssueSummary,
  MetricSummary,
  PoweredBy,
  RunNotices,
  SampleFixPrompt,
  SampleNotices,
  SampleOverview,
  SampleSummary,
  StabilityOverview,
} from "./classic/components.ts";
export type {
  AttemptDetailsProps,
  AttemptListProps,
  ComparisonProps,
  EvidenceEntry,
  ExperimentScatterProps,
  ExperimentTableProps,
  HeroLink,
  HeroLogo,
  HeroProps,
  MetricSummaryItem,
  SampleFixPromptProps,
  SampleNoticesProps,
  SampleOverviewProps,
  SampleSummaryProps,
} from "./classic/components.ts";

export {
  isReportElement,
} from "./author/element.ts";
export type {
  AuthorReportNode,
  ReportElement,
} from "./author/element.ts";

export {
  REPORT_AUTHOR_EXPORT_MANIFEST,
} from "./author/manifest.ts";
export type {
  ReportAuthorExportManifest,
  ReportAuthorTypeExport,
  ReportAuthorValueExport,
} from "./author/manifest.ts";

export {
  REPORT_DOCUMENT_DEPTH_MAX,
  REPORT_DOCUMENT_NODES_MAX,
  REPORT_DOWNLOAD_FILE_BYTES_MAX,
  REPORT_DOWNLOAD_FILES_MAX,
  REPORT_PAGES_MAX,
} from "./execution/model.ts";
export type {
  ReportExecution,
  ReportPageResult,
} from "./execution/model.ts";
export type {
  ReportExecutionProblem,
  ReportProblem,
  ReportProblemTable,
  ReportProblemTableEntry,
} from "./execution/problems.ts";

export {
  basalt,
  chalk,
  defineTheme,
} from "./host/theme.ts";
export type {
  ReportTheme,
  ThemeColor,
  ThemeDefinition,
  ThemeFontSize,
  ThemeFontTokens,
  ThemeHex,
  ThemeRadius,
  ThemeSeries,
} from "./host/theme.ts";
