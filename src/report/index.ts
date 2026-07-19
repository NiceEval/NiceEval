// niceeval/report —— 报告积木:指标 × 计算函数 × 双面组件 × defineReport。
// 契约见 docs/feature/reports/README.md 与 docs/feature/reports/library/ 分篇。
//
// import 边界即运行时边界:计算函数(*Data)会经句柄触碰文件系统(懒加载 artifact),
// 只能进服务端 / 脚本;组件的渲染面纯同步零 IO。text 宿主遍历渲染不需要 react-dom
// (renderReportToText);web 宿主的 renderReportToStaticHtml 在 ./web.ts,只有那一侧
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
} from "./metrics.ts";
export { flag, label, numericFlag, numericLabel, numericRunConfig, runConfig } from "./flag.ts";

// 报告定义与组件基座
export {
  buildReportMeta,
  defineReport,
  isReportDefinition,
  pickReportPage,
  renderReportToText,
  renderReportTreeToText,
  reportTitleText,
  resolveReportTitle,
  ReportPageNotFoundError,
  ReportPageNeedsLocatorError,
  DEFAULT_PAGE_ID,
} from "./report.ts";
export type {
  HostCommandContext,
  NonEmptyArray,
  RenderReportTextOptions,
  RenderTreeTextOptions,
  ReportTreeHostContext,
  HeadTag,
  ReportAsset,
  ReportDef,
  ReportDefinition,
  ReportHostContext,
  ReportLink,
  ReportMeta,
  ReportMetaPage,
  ReportPage,
  ReportPageBase,
  ReportShell,
} from "./report.ts";
export { defineComponent, createTextContext, renderNodeToText, resolveReportTree, validateReportTree, ResolveMemo } from "./tree.ts";
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
} from "./tree.ts";

// 排版原语(八个内置双面组件)
export { Col, Row, Section, Style, Tab, Table, Tabs, Text } from "./primitives.tsx";
export type {
  ColProps,
  LayoutProps,
  RowProps,
  SectionProps,
  StyleProps,
  TabProps,
  TableColumn,
  TableProps,
  TableRow,
  TabsProps,
  TextProps,
} from "./primitives.tsx";

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
} from "./text/layout.ts";
export type { ColumnAlign } from "./text/layout.ts";

// locale:官方组件 chrome 文案的语言(内置词典覆盖 en / zh-CN,其它 locale 走回退)
export { DEFAULT_REPORT_LOCALE, localizedTextEquals, resolveLocalizedText, resolveMetricLabel } from "./locale.ts";
export type { LocalizedText, ReportLocale } from "./locale.ts";

// 官方双面组件(spec / data 双形态;配套 *Data 计算函数在下面成对导出)
// 与站点组件(Hero / HeroCard / PoweredBy / ScopeWarnings / CopyFixPrompt / TraceWaterfall)
export {
  AttemptList,
  CopyFixPrompt,
  DeltaTable,
  EvalList,
  ExperimentComparison,
  ExperimentList,
  FailureList,
  Hero,
  HeroCard,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  PoweredBy,
  Scoreboard,
  ScopeSummary,
  ScopeWarnings,
  TraceWaterfall,
} from "./components.tsx";
export type {
  AttemptListProps,
  CopyFixPromptProps,
  DataProps,
  DeltaTableProps,
  EvalListProps,
  ExperimentComparisonProps,
  ExperimentListProps,
  FailureListProps,
  HeroCardProps,
  HeroProps,
  MetricBarsProps,
  MetricLineProps,
  MetricMatrixProps,
  MetricScatterProps,
  MetricTableProps,
  ScoreboardProps,
  ScopeSummaryProps,
  ScopeWarningsProps,
  TraceWaterfallProps,
} from "./components.tsx";

// 计算函数(组件解析面的具名形式,与组件成对;spec 形态下由管线代调,data 形态与
// 嵌入场景下由作者手工调)
export {
  attemptListData,
  copyFixPromptData,
  deltaTableData,
  evalListData,
  experimentComparisonData,
  experimentListData,
  heroData,
  metricLineData,
  metricMatrixData,
  metricScatterData,
  metricTableData,
  pairsByFlag,
  scopeSummaryData,
  scopeWarningsData,
  scoreboardData,
  traceWaterfallData,
} from "./compute.ts";
export type {
  DeltaTableOptions,
  ExperimentComparisonOptions,
  MetricLineOptions,
  MetricMatrixOptions,
  MetricScatterOptions,
  MetricTableOptions,
  ScoreboardOptions,
} from "./compute.ts";

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
  ExperimentComparisonData,
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
} from "./types.ts";

// 数据层输入的类型(家在 niceeval/results,这里 re-export 方便写指标 / 报告)
export type { AttemptHandle, Results, Scope, Snapshot } from "../results/types.ts";
