// niceeval/report/react —— 纯 web 渲染面的导出点:把某一块指标表嵌进已有 React 页面时
// 从这里 import。组件只收算好的可序列化 `data`(data 形态),不含任何读盘 / artifact
// 计算代码;计算函数、spec 形态与组合组件只住在 niceeval/report。
//
// 契约:
//   - 组件只认「算好的可序列化数据」:零 hooks、零数据操作;
//   - 样式随包发布:配套 ./styles.css(niceeval-* 稳定类名),使用者在其后加载覆盖即可;
//   - 渐进增强脚本 ./enhance.js 可选加载,初始静态 HTML 无 JS 完整可读;
//   - 跨块配色一致:维度键 → 稳定散列 → 固定调色板下标(../assets/colors.ts)。

export {
  Callouts,
  Chart,
  Col,
  Conversation,
  CopyBlock,
  DiffView,
  Grid,
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
} from "../definition/primitives.tsx";
export { HeroCard } from "../components/site-components/HeroCard.tsx";
export type { HeroLink, HeroLogo } from "../components/site-components/hero-types.ts";
export { PoweredBy } from "../components/site-components/PoweredBy.tsx";

// 数据契约类型(家在 ../model/types.ts,「算」与「画」两侧共用同一份)
export type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptConversationRound,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptListItem,
  AttemptLocator,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  CopyFixPromptData,
  Dataset,
  DatasetField,
  DatasetRow,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  HeroData,
  MetricColumn,
  MetricValue,
  SampleSummaryContent,
  SampleIssue,
  SnapshotDiagnosticsData,
  SnapshotDiagnosticsItem,
  StaleConclusionReference,
  TraceSpanSummary,
  TraceWaterfallRow,
  UsageTableData,
  VerdictTally,
} from "../model/types.ts";
export type { Cell, VerdictCounts } from "../definition/cell.ts";
export { formatCellText } from "../definition/cell.ts";
export type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../record/attempt-evidence.ts";

// 格式化与呈现工具箱(docs/feature/reports/library/presentation.md):自有 React 页面与报告面同实现。
export { formatAxisTick, formatInstant, formatMetricValue, formatTimeDistance, missingText } from "../model/format.ts";
export { presentDimension, shortestUniqueLabels } from "../presentation.ts";
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
} from "../presentation.ts";

// locale(官方组件 chrome 文案的语言;LocalizedText 的按 locale 解析也用它)
export {
  DEFAULT_REPORT_LOCALE,
  localizedTextEquals,
  resolveLocalizedText,
  resolveMetricLabel,
} from "../model/locale.ts";
export type { LocalizedText, ReportLocale } from "../model/locale.ts";
