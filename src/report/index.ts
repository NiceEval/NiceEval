// niceeval/report —— 报告积木:指标 × 计算函数 × 双面组件 × defineReport。
// 契约见 docs/feature/reports/README.md 与 docs/feature/reports/library/ 分篇。
//
// import 边界即运行时边界:计算函数(*Data)会经句柄触碰文件系统(懒加载 artifact),
// 只能进服务端 / 脚本;组件的渲染面纯同步零 IO。text 宿主遍历渲染不需要 react-dom
// (renderReportToText);web 宿主的 renderReportToStaticHtml 在 ./runtime/web.ts,只有那一侧
// import react-dom。写报告文件的项目要装 react(.tsx 编译产物 import react/jsx-runtime)。

// 指标与维度读取器
export {
  assistantTurns,
  costUSD,
  defineMetric,
  durationMs,
  endToEndPassRate,
  examScore,
  executionReliability,
  repeatedFailedCommands,
  taskPassRate,
  tokens,
} from "./model/metrics.ts";
export { flag, label, numericFlag, numericLabel, numericRunConfig, runConfig } from "./model/flag.ts";

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
  ReportLink,
  ReportMeta,
  ReportMetaPage,
  ReportPage,
  ReportPageBase,
  ReportShell,
} from "./definition/report.ts";
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
export { defineComponent, createTextContext, renderNodeToText, resolveReportTree, validateReportTree, ResolveMemo } from "./definition/tree.ts";
export type { AttemptEvidence, AttemptEvidenceCapabilities } from "../results/attempt-evidence.ts";
export type {
  AttemptPageContext,
  ComponentFaces,
  ComposeContext,
  PageContext,
  ReportComponent,
  ReportElement,
  ReportNode,
  ResolveContext,
  ResolveEnv,
  ScopePageContext,
  TextContext,
  TextRenderOptions,
  WebContext,
} from "./definition/tree.ts";

// 排版原语(十个内置双面组件)
export { Col, Grid, Row, Section, Stat, Style, Tab, Table, Tabs, Text } from "./definition/primitives.tsx";
export type {
  ColProps,
  GridProps,
  LayoutProps,
  RowProps,
  SectionProps,
  StatProps,
  StatTone,
  StyleProps,
  TabProps,
  TableColumn,
  TableProps,
  TableRow,
  TabsProps,
  TextProps,
} from "./definition/primitives.tsx";

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
export { DEFAULT_REPORT_LOCALE, localizedTextEquals, resolveLocalizedText, resolveMetricLabel } from "./model/locale.ts";
export type { LocalizedText, ReportLocale } from "./model/locale.ts";

// 官方双面组件(spec / data 双形态;配套 *Data 计算函数在下面成对导出)
// 与站点组件(Hero / HeroCard / PoweredBy / ScopeWarnings / CopyFixPrompt / TraceWaterfall)
export { ScopeSummary, ExperimentComparison } from "./components/summaries/index.tsx";
export type { ScopeSummaryProps, ExperimentComparisonProps } from "./components/summaries/index.tsx";
export { AttemptList, EvalList, ExperimentList, FailureList } from "./components/entity-lists/index.tsx";
export type {
  AttemptListProps,
  EvalListProps,
  ExperimentListProps,
  FailureListProps,
} from "./components/entity-lists/index.tsx";
export {
  DeltaTable,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  Scoreboard,
} from "./components/metric-views/index.tsx";
export type {
  DeltaTableProps,
  MetricBarsProps,
  MetricLineProps,
  MetricMatrixProps,
  MetricScatterProps,
  MetricTableProps,
  ScoreboardProps,
} from "./components/metric-views/index.tsx";
export {
  CopyFixPrompt,
  Hero,
  HeroCard,
  PoweredBy,
  ScopeWarnings,
  TraceWaterfall,
} from "./components/site-components/index.tsx";
export type {
  CopyFixPromptProps,
  HeroCardProps,
  HeroProps,
  ScopeWarningsProps,
  TraceWaterfallProps,
} from "./components/site-components/index.tsx";

// Attempt 详情组件族(docs/feature/reports/library/attempt-detail.md):11 个叶子 + 2 个
// 只装配叶子的组合组件(AttemptAssessment / AttemptDetail),都从 niceeval/report 导出。
export {
  AttemptAssertions,
  AttemptAssessment,
  AttemptConversation,
  AttemptDetail,
  AttemptDiagnostics,
  AttemptDiff,
  AttemptError,
  AttemptFixPrompt,
  AttemptSource,
  AttemptSummary,
  AttemptTimeline,
  AttemptTrace,
  AttemptUsage,
} from "./components/attempt-detail/index.tsx";
export type { AttemptSectionProps } from "./components/attempt-detail/index.tsx";

// 计算函数(组件解析面的具名形式,与组件成对;spec 形态下由管线代调,data 形态与
// 嵌入场景下由作者手工调)
export { scopeSummaryData } from "./components/summaries/compute.ts";
export { attemptListData, evalListData, experimentListData } from "./components/entity-lists/compute.ts";
export {
  deltaTableData,
  metricLineData,
  metricMatrixData,
  metricScatterData,
  metricTableData,
  pairsByFlag,
  scoreboardData,
} from "./components/metric-views/compute.ts";
export type {
  DeltaTableOptions,
  MetricLineOptions,
  MetricMatrixOptions,
  MetricScatterOptions,
  MetricTableOptions,
  ScoreboardOptions,
} from "./components/metric-views/compute.ts";
export {
  copyFixPromptData,
  heroData,
  scopeWarningsData,
  traceWaterfallData,
} from "./components/site-components/compute.ts";

// Attempt 详情组件族的计算函数:输入恒为单个 AttemptEvidence,同步纯派生(不读文件、不 fetch)。
export {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSourceData,
  attemptSummaryData,
  attemptTimelineData,
  attemptTraceData,
  attemptUsageData,
} from "./components/attempt-detail/compute.ts";

// 数据契约(组件的 data)
export type {
  Aggregator,
  AttemptListItem,
  AttemptLocator,
  BuiltInDimension,
  CopyFixPromptData,
  CustomDimension,
  DeltaData,
  DeltaPair,
  DimensionInput,
  DimensionOptions,
  DimensionRef,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  FlagPairs,
  HeroData,
  LineData,
  MatrixData,
  Metric,
  MetricAggregate,
  MetricCell,
  MetricColumn,
  NumericAxis,
  NumericAxisOptions,
  NumericRunConfigAxisOptions,
  ReportInput,
  RunConfigKey,
  ScatterData,
  ScopeSummaryData,
  ScopeWarning,
  ScoreboardData,
  SeriesInput,
  TableData,
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
  AttemptDiffFileEntry,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSourceData,
  AttemptSourceLineData,
  AttemptSourceTurn,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  AttemptUsageData,
} from "./model/types.ts";

// 数据层输入的类型(家在 niceeval/results,这里 re-export 方便写指标 / 报告)
export type { AttemptHandle, Results, Scope, Snapshot } from "../results/types.ts";
