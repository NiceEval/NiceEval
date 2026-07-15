// niceeval/report —— 报告积木:指标 × 计算函数 × 双面组件 × defineReport。
// 契约见 docs/feature/reports/README.md;公开叙事的准绳是 docs-site/zh/guides/custom-reports.mdx
// 与 report-components.mdx。
//
// import 边界即运行时边界:计算函数(挂在组件上的 .data)会经句柄触碰文件系统
// (懒加载 artifact),只能进服务端 / 脚本;组件的渲染面纯同步零 IO。text 宿主遍历渲染
// 不需要 react-dom(renderReportToText);web 宿主的 renderReportToStaticHtml 在
// ./web.ts,只有那一侧 import react-dom。写报告文件的项目要装 react(.tsx 编译产物
// import react/jsx-runtime)。

// 指标与维度读取器(flag / config)
export {
  defineMetric,
  taskPassRate,
  executionReliability,
  endToEndPassRate,
  examScore,
  durationMs,
  tokens,
  costUSD,
  turns,
} from "./metrics.ts";
export { flag, config } from "./flag.ts";

// 报告基座与双面组件基座
export { defineReport, isReportDefinition, renderReportToText } from "./report.ts";
export type { ReportContext, ReportDefinition } from "./report.ts";
export { defineComponent } from "./tree.ts";
export type {
  ComponentFaces,
  ReportComponent,
  ReportElement,
  ReportNode,
  TextContext,
  TextRenderOptions,
  WebContext,
} from "./tree.ts";

// 排版原语(六个内置双面组件)
export { Row, Col, Section, Text, Style, Table } from "./primitives.tsx";
export type { LayoutProps, SectionProps, StyleProps, TableColumn, TableProps, TableRow } from "./primitives.tsx";

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

// 内置报告兼组合件(show / view 裸跑时报告槽的出厂填充;也可作组件整体引用,
// `<ExperimentComparison data={await ExperimentComparison.data(selection)} />`),无 renderer 特权
export { ExperimentComparison } from "./built-ins/index.ts";
export type { ExperimentComparisonData, ExperimentComparisonProps } from "./built-ins/index.ts";

// locale:官方组件 chrome 文案的语言(en / zh-CN);指标 label 可按 locale 给字典
export { DEFAULT_REPORT_LOCALE, resolveMetricLabel } from "./locale.ts";
export type { LocalizedLabel, ReportLocale } from "./locale.ts";

// 官方双面组件(各自带 data 计算函数;MetricBars.data = MetricMatrix.data)
export {
  AttemptList,
  DeltaTable,
  EvalList,
  ExperimentList,
  GroupSummary,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  RunOverview,
  Scoreboard,
} from "./components.tsx";
export type {
  AttemptListProps,
  DeltaTableProps,
  EvalListProps,
  ExperimentListProps,
  GroupSummaryProps,
  MetricLineProps,
  MetricMatrixProps,
  MetricScatterProps,
  MetricTableProps,
  RunOverviewProps,
  ScoreboardProps,
} from "./components.tsx";

// 计算函数的选项类型(函数本体挂在组件上,不做顶层导出)
export type {
  AttemptListDataOptions,
  DeltaDataOptions,
  DeltaPair,
  LineDataOptions,
  MatrixDataOptions,
  ScatterDataOptions,
  ScoreboardDataOptions,
  TableDataOptions,
} from "./compute.ts";

// 数据契约(组件的 data props)
export type {
  Aggregator,
  AttemptListItem,
  AttemptLocator,
  AxisInput,
  ConfigRef,
  DeltaData,
  Dimension,
  DimensionInput,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  GroupSummaryData,
  LineAxis,
  LineData,
  MatrixData,
  Metric,
  MetricAggregate,
  MetricCell,
  MetricColumn,
  OverviewData,
  FlagRef,
  ScatterData,
  ScoreboardData,
  SelectionWarning,
  TableData,
  TableRowMeta,
} from "./types.ts";

// 数据层输入的类型(家在 niceeval/results,这里 re-export 方便写指标 / 报告)
export type { AttemptHandle, Results, Selection, Snapshot } from "../results/types.ts";

// experiment id 的组键推导(id 的目录前缀,如 `compare/bub-low` 的 `compare`)。
// 重新导出,让自定义报告能按同一份口径把 experiment 分组,不必自己重写这两行逻辑。
export { experimentGroupOf } from "../shared/aggregate.ts";
