// niceeval/report —— 报告积木:指标 × 双面组件 × defineReport。
// 契约见 docs/feature/reports/README.md 与 docs/feature/reports/library/ 分篇。
//
// import 边界即运行时边界:计算函数经 sources 在 resolve 阶段代调,只能进服务端 / 脚本;
// 组件的渲染面纯同步零 IO。text 宿主遍历渲染不需要 react-dom
// (renderReportToText);web 宿主的 renderReportToStaticHtml 在 ./runtime/web.ts,只有那一侧
// import react-dom。写报告文件的项目要装 react(.tsx 编译产物 import react/jsx-runtime)。

// 指标与维度读取器
export {
  assistantTurns,
  costUSD,
  defineMeasure,
  durationMs,
  executionReliability,
  repeatedFailedCommands,
  passRate,
  taskPassRate,
  tokens,
  totalScore,
} from "./model/metrics.ts";
export { defineComposition, defineSource } from "./source.ts";
export { sources } from "./sources.ts";
export type { Composition, CompositionContext, Source, SourceInput } from "./source.ts";
export { presentDimension, shortestUniqueLabels } from "./presentation.ts";
export type { DimensionDeclaration, DimensionEncoding, PresentedDimension } from "./presentation.ts";
export { flag, label, numericFlag, numericLabel, numericRunConfig, runConfig } from "./model/flag.ts";
export { scoringComposition } from "./model/scoring.ts";

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
export { basalt, defineTheme, isThemeDefinition, themeStylesheet } from "./theme.ts";
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
export { defineComponent, createTextContext, renderNodeToText, resolveReportTree, validateReportTree, ResolveMemo } from "./definition/tree.ts";
export type { AttemptEvidence, AttemptEvidenceCapabilities } from "../record/attempt-evidence.ts";
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
export {
  Callouts,
  Chart,
  Col,
  Column,
  Conversation,
  CopyBlock,
  DiffView,
  Grid,
  Markdown,
  Row,
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
  ColumnProps,
  ConversationContent,
  ConversationEntry,
  ConversationProps,
  ConversationTurn,
  CopyBlockContent,
  CopyBlockProps,
  DiffChange,
  DiffContent,
  DiffFile,
  DiffViewProps,
  FailedCommandContent,
  GridProps,
  LayoutProps,
  MarkdownProps,
  RowProps,
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
  TableColumn,
  TableProps,
  TableRow,
  TabsProps,
  TextProps,
  WaterfallContent,
  WaterfallNode,
  WaterfallProps,
  WaterfallRow,
} from "./definition/primitives.tsx";
export type { Cell, ColumnSpec, TableContent, TableContentRow, VerdictCounts } from "./definition/cell.ts";
export { formatCellText } from "./definition/cell.ts";

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

// 官方组合组件与站点组件。
export { SampleOverview, SampleSummary } from "./components/summaries/index.tsx";
export type { SampleOverviewProps, SampleSummaryProps } from "./components/summaries/index.tsx";
export {
  Hero,
  HeroCard,
  PoweredBy,
  RunNotices,
  SampleFixPrompt,
  SampleNotices,
} from "./components/site-components/index.tsx";
export type { HeroCardProps, HeroProps } from "./components/site-components/index.tsx";

// 实体列表。
export { FailureList } from "./components/entity-lists/index.tsx";

// Attempt 详情组合组件(docs/feature/reports/components/attempt-detail/README.md)。
export {
  AttemptAssessment,
  AttemptDetail,
  AttemptSummary,
} from "./components/attempt-detail/index.tsx";
export type { AttemptSectionProps } from "./components/attempt-detail/index.tsx";

// 数据契约(Content / Row / Cell 等;计算经 sources 在 resolve 阶段代调,不从此处导出 *Data 函数)
export type {
  Aggregator,
  AttemptListItem,
  AttemptLocator,
  BuiltInDimension,
  CopyFixPromptData,
  CustomDimension,
  DeltaCell,
  DeltaData,
  Dataset,
  DatasetField,
  DatasetRow,
  DatasetValue,
  DimensionInput,
  DimensionOptions,
  DimensionRef,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  FlagConditions,
  HeroData,
  LineData,
  MatrixData,
  Measure,
  MeasureAggregate,
  MeasureFormat,
  NumericAxis,
  NumericAxisOptions,
  NumericRunConfigAxisOptions,
  ReportInput,
  RunConfigKey,
  ScatterData,
  MeasureCell,
  MeasureColumn,
  MeasureRowsContent,
  SampleSummaryContent,
  SampleIssue,
  ScoreboardData,
  ScoringComposition,
  SeriesInput,
  SnapshotDiagnosticsData,
  SnapshotDiagnosticsItem,
  StabilityMatrixCell,
  StabilityMatrixData,
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
  UsageTableData,
} from "./model/types.ts";

// 数据层输入的类型(家在 niceeval/record,这里 re-export 方便写指标 / 报告)
export type { AttemptHandle, Record, Sample, Run } from "../record/types.ts";
