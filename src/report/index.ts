// niceeval/report —— 报告积木:计算 × 双面组件 × defineReport。
// 契约见 docs/feature/reports/README.md 与 docs/feature/reports/library/ 分篇。
//
// page.render 里用公开 to* / rollup / aggregate 算出普通值，再交给组件。
// 组件的渲染面纯同步零 IO。text 宿主遍历渲染不需要 react-dom
// (renderReportToText);web 宿主的 renderReportToStaticHtml 在 ./runtime/web.ts,只有那一侧
// import react-dom。写报告文件的项目要装 react(.tsx 编译产物 import react/jsx-runtime)。

// 官方 Calculation（普通值作者模型）；内部切片仍可用 AttemptMetric 字面量，不导出 defineMeasure。
// 普通值计算内核
export {
  aggregate,
  agent,
  costUSD,
  dedupeLocators,
  durationMs,
  evalId,
  evidenceRow,
  experiment,
  isCalculation,
  isMetricValue,
  max,
  mean,
  metricValue,
  min,
  model,
  parseEvidenceRow,
  parseEvidenceRows,
  passRate,
  percentile,
  rollup,
  sum,
  tokens,
  totalScore,
} from "./model/calculation.ts";
export type {
  AggregateRow,
  AggregationSubject,
  Calculation,
  EvidenceRow,
  GroupFunction,
  MetricBasis,
  MetricFormat,
  MetricValue,
  Reducer,
  RollupOptions,
} from "./model/calculation.ts";
export {
  toAttemptAssertions,
  toAttemptFacts,
  toAttemptFixPrompt,
  toAttemptListRows,
  toAttemptNotices,
  toAttemptRows,
  toAttemptSource,
  toAttemptSummary,
  toAttemptUsage,
  toConversationTurns,
  toDiffFiles,
  toEvalRows,
  toExperimentDetails,
  toExperimentRows,
  toHeroData,
  toRunNotices,
  toSampleFixPrompt,
  toSampleNotices,
  toSummaryItems,
  toTimelineNodes,
  toTraceNodes,
} from "./model/conversions.ts";
export { presentDimension, shortestUniqueLabels } from "./presentation.ts";
export type {
  ColorPresentation,
  DimensionDeclaration,
  DimensionEncoding,
  DimensionPresentation,
  FillSeriesPresentation,
  LabelPresentation,
  LineSeriesPresentation,
  PresentedDimension,
  ScatterSeriesPresentation,
} from "./presentation.ts";
export { flag, label, numericFlag, numericLabel, numericRunConfig, runConfig } from "./model/flag.ts";
export { evaluationKindComposition } from "./model/evaluation-kind.ts";

// 内建任务结果：page、show text 与 ShowJson 的共同计算锚点。
export {
  annotatedSourceResult,
  attemptDetailsResult,
  comparisonResult,
  conversationResult,
  diffResult,
  historyResult,
  stabilityResult,
  standardOverviewResult,
  timingResult,
  usageResult,
} from "./tasks.ts";
export type {
  AnnotatedSourceOptions,
  AnnotatedSourceResult,
  AttemptDetailsResult,
  AttemptTimingResult,
  ComparisonCoverageResult,
  ComparisonOptions,
  ComparisonResult,
  ConversationResult,
  DiffResult,
  HistoryAttemptResult,
  HistoryOptions,
  HistoryResult,
  HistorySectionResult,
  RunTimingBuildResult,
  RunTimingResult,
  StabilityOptions,
  StabilityResult,
  StandardOverviewChartResult,
  StandardOverviewPoint,
  StandardOverviewResult,
  TimingResult,
  UsageResult,
} from "./tasks.ts";

// 报告定义与组件基座
export {
  buildReportMeta,
  defineReport,
  isReportDefinition,
  resolveReportTitle,
  DEFAULT_PAGE_ID,
} from "./definition/report.ts";
export type {
  NonEmptyArray,
  HeadTag,
  ReportAsset,
  ReportDef,
  ReportDefinition,
  ReportMeta,
  ReportMetaPage,
  ReportOptions,
  ReportPage,
  ReportPageBase,
  ReportShell,
  ReportTarget,
  PageDefinition,
  PageDefinitionInput,
  PageLoad,
  PageLoadContext,
  PageParams,
  PageRender,
} from "./definition/report.ts";
export { basalt, chalk, defineTheme, isThemeDefinition, themeStylesheet } from "./theme.ts";
export type { ReportTheme, ThemeColor, ThemeDefinition, ThemeHex, ThemeSeries } from "./theme.ts";
export {
  pickReportPage,
  renderReportToText,
  renderReportTreeToText,
  reportTitleText,
  ReportPageNotFoundError,
  ReportPageNeedsLocatorError,
} from "./runtime/text.ts";
export type {
  HostCommandContext,
  RenderReportTextOptions,
  RenderTreeTextOptions,
  ReportTreeHostContext,
  ReportHostContext,
} from "./runtime/text.ts";
export {
  executePageRender,
  resolveDefinitionPage,
  renderTarget,
  createPageLoadContext,
  encodeTargetKey,
  targetHref,
  targetKey,
  UnknownPageError,
} from "./runtime/page-render.ts";
export type { PageRenderInput, RenderTargetHostContext } from "./runtime/page-render.ts";
export { defineComponent, createTextContext, renderNodeToText, resolveReportTree, validateReportTree } from "./definition/tree.ts";
export type { AttemptEvidence, AttemptEvidenceCapabilities } from "../record/attempt-evidence.ts";
export type {
  ComponentFaces,
  ComposeContext,
  PageContext,
  ReportComponent,
  ReportElement,
  ReportNode,
  ResolveContext,
  ResolveEnv,
  TextContext,
  TextRenderOptions,
  WebContext,
} from "./definition/tree.ts";

// 排版原语(十个内置双面组件)
export {
  Area,
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
  applyBarsSortLimit,
} from "./definition/primitives.tsx";
export type {
  AreaProps,
  BarsProps,
  BarsSort,
  EvidenceAxisKey,
  EvidenceDimensionKey,
  CalloutGroup,
  CalloutItem,
  CalloutLevel,
  CalloutsProps,
  ChartPresentation,
  ChartProps,
  ChartAxisBinding,
  ChartFieldBinding,
  ChartSeriesOverride,
  ColProps,
  ConversationContent,
  ConversationEntry,
  ConversationProps,
  ConversationTurn,
  CopyBlockContent,
  CopyBlockProps,
  DiffChange,
  DiffContent,
  DiffFile,
  DiffFileWindow,
  DiffViewProps,
  ExternalAreaProps,
  ExternalAxisKey,
  ExternalBarsProps,
  ExternalLineProps,
  ExternalScatterProps,
  CommandEvidenceContent,
  CommandEvidenceItem,
  CommandEvidenceProps,
  GridProps,
  LayoutProps,
  LineProps,
  MarkdownProps,
  PlainTableColumn,
  RowProps,
  ScatterProps,
  SectionProps,
  SeriesProps,
  SourceBlockContent,
  SourceCallContent,
  SourceContent,
  SourceLine,
  SourceViewProps,
  StatProps,
  StatTone,
  StyleProps,
  TabProps,
  TableProps,
  TabsProps,
  TextProps,
  WaterfallContent,
  WaterfallNode,
  WaterfallProps,
  WaterfallRow,
} from "./definition/primitives.tsx";
export type { Cell, VerdictCounts } from "./definition/cell.ts";
export { formatCellText } from "./definition/cell.ts";

// 格式化与呈现工具箱(docs/feature/reports/library/presentation.md):渲染侧单点入口。
export { formatAxisTick, formatInstant, formatMetricValue, formatTimeDistance, missingText } from "./model/format.ts";

// 文本排版工具箱:自定义组件的 text 面用的就是官方组件那把尺子。
// 表格有 <Table> 承担,这里只给表以外的形态用 —— 尤其别拿 String.prototype.padEnd 对齐:
// 它数 UTF-16 码元不数显示列宽,一带中文列就撕歪。renderAlignedRows 刻意不导出。
export {
  stringWidth,
  padDisplay as padEnd,
  padStartDisplay as padStart,
  wrapDisplay as wrapText,
  indentBlock as indent,
  textBar as bar,
  joinColumns as columns,
} from "./model/text-layout.ts";
export type { ColumnAlign } from "./model/text-layout.ts";

// locale:官方组件 chrome 文案的语言(内置词典覆盖 en / zh-CN,其它 locale 走回退)
export {
  DEFAULT_REPORT_LOCALE,
  localizedTextEquals,
  resolveLocalizedText,
  resolveMetricLabel,
} from "./model/locale.ts";
export type { LocalizedText, ReportLocale } from "./model/locale.ts";

// 官方组合组件与站点组件。
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
  Hero,
  HeroCard,
  PoweredBy,
  RunNotices,
  SampleFixPrompt,
  SampleNotices,
} from "./components/site-components/index.tsx";
export type { HeroCardProps, HeroLink, HeroLogo, HeroProps } from "./components/site-components/index.tsx";

// 实体列表。
export { AttemptList, ExperimentTable, FailureList } from "./components/entity-lists/index.tsx";
export type { ExperimentTableProps } from "./components/entity-lists/index.tsx";

// 目标与下钻(docs/feature/reports/library.md「目标与下钻」)。
export { targetOfRefs, ATTEMPT_PAGE_ID } from "./components/shared.ts";

// Attempt 详情组合组件(docs/feature/reports/components/attempt-detail/README.md)。
export {
  AttemptAssessment,
  AttemptDetails,
  AttemptSummary,
} from "./components/attempt-detail/index.tsx";
export type { AttemptDetailsProps } from "./components/attempt-detail/index.tsx";

// Experiment 详情组合组件(docs/feature/reports/components/experiment-detail/README.md)。
export { ExperimentDetails } from "./components/experiment-detail/index.tsx";
export type { ExperimentDetailsProps } from "./components/experiment-detail/index.tsx";

// 数据契约(Content / Row / Cell 等;AttemptMetric/Dataset/Scoreboard 旧协议不从此处导出)
export type {
  Aggregator,
  AttemptListItem,
  AttemptLocator,
  BuiltInDimension,
  CopyFixPromptData,
  CustomDimension,
  DeltaCell,
  DeltaData,
  DimensionInput,
  DimensionOptions,
  DimensionRef,
  EvalListItem,
  ExperimentDetailsData,
  ExperimentListEvalRow,
  ExperimentListItem,
  FlagConditions,
  HeroData,
  NumericAxis,
  NumericAxisOptions,
  NumericRunConfigAxisOptions,
  ReportInput,
  RunConfigKey,
  SampleSummaryContent,
  SampleIssue,
  EvaluationKindComposition,
  SeriesInput,
  SnapshotDiagnosticsData,
  SnapshotDiagnosticsItem,
  StaleConclusionReference,
  TraceSpanSummary,
  TraceWaterfallRow,
  VerdictTally,
} from "./model/types.ts";

// Attempt 详情组件族的数据契约
export type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptConversationRound,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFactsData,
  AttemptFixPromptData,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  UsageTableData,
} from "./model/types.ts";

// 数据层输入的类型(家在 niceeval/record,这里 re-export 方便写指标 / 报告)
export type { AttemptHandle, Record, Sample, Run } from "../record/types.ts";
