// niceeval/report/react —— 纯 web 渲染面的导出点:把某一块指标表嵌进已有 React 页面时
// 从这里 import。组件只收算好的可序列化 `data`(data 形态),不含任何读盘 / artifact
// 计算代码;计算函数、spec 形态与组合组件只住在 niceeval/report。
//
// 契约:
//   - 组件只认「算好的可序列化数据」:零 hooks、零数据操作;
//   - 样式随包发布:配套 ./styles.css(nre-* 稳定类名),使用者在其后加载覆盖即可;
//   - 渐进增强脚本 ./enhance.js 可选加载,初始静态 HTML 无 JS 完整可读;
//   - 跨块配色一致:维度键 → 稳定散列 → 固定调色板下标(../assets/colors.ts)。

export { AttemptList } from "../components/entity-lists/AttemptList.tsx";
export { EvalList } from "../components/entity-lists/EvalList.tsx";
export { ExperimentList } from "../components/entity-lists/ExperimentList.tsx";
export { ScopeSummary } from "../components/summaries/ScopeSummary.tsx";
export { MetricTable } from "../components/metric-views/MetricTable.tsx";
export { MetricMatrix } from "../components/metric-views/MetricMatrix.tsx";
export { MetricBars } from "../components/metric-views/MetricBars.tsx";
export { MetricScatter } from "../components/metric-views/MetricScatter.tsx";
export { MetricLine } from "../components/metric-views/MetricLine.tsx";
export { DeltaTable } from "../components/metric-views/DeltaTable.tsx";
export { StabilityMatrix } from "../components/metric-views/StabilityMatrix.tsx";
export { Scoreboard } from "../components/metric-views/Scoreboard.tsx";

// 站点组件的纯 web 面(data 形态;Hero 是组合组件,只住 niceeval/report)
export { HeroCard } from "../components/site-components/HeroCard.tsx";
export { PoweredBy } from "../components/site-components/PoweredBy.tsx";
export { ScopeWarnings } from "../components/site-components/ScopeWarnings.tsx";
export { SnapshotDiagnostics } from "../components/site-components/SnapshotDiagnostics.tsx";
export { CopyFixPrompt } from "../components/site-components/CopyFixPrompt.tsx";
export { TraceWaterfall } from "../components/site-components/TraceWaterfall.tsx";

// Attempt 详情组件族的纯 web 面(data 形态;AttemptAssessment / AttemptDetail 是组合组件,
// 不产生新渲染面,只住 niceeval/report)
export { AttemptSummary } from "../components/attempt-detail/AttemptSummary.tsx";
export { AttemptError } from "../components/attempt-detail/AttemptError.tsx";
export { AttemptAssertions } from "../components/attempt-detail/AttemptAssertions.tsx";
export { AttemptSource } from "../components/attempt-detail/AttemptSource.tsx";
export { AttemptFixPrompt } from "../components/attempt-detail/AttemptFixPrompt.tsx";
export { AttemptTimeline } from "../components/attempt-detail/AttemptTimeline.tsx";
export { AttemptConversation } from "../components/attempt-detail/AttemptConversation.tsx";
export { AttemptDiagnostics } from "../components/attempt-detail/AttemptDiagnostics.tsx";
export { UsageTable } from "../components/attempt-detail/UsageTable.tsx";
export { AttemptTrace } from "../components/attempt-detail/AttemptTrace.tsx";
export { AttemptDiff } from "../components/attempt-detail/AttemptDiff.tsx";

// 数据契约类型(家在 ../model/types.ts,「算」与「画」两侧共用同一份)
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
  AttemptListItem,
  AttemptLocator,
  AttemptSourceData,
  AttemptSourceLineData,
  AttemptSourceTurn,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  CopyFixPromptData,
  DeltaData,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  HeroData,
  LineData,
  MatrixData,
  MetricCell,
  MetricColumn,
  ScatterData,
  ScopeSummaryData,
  ScopeWarning,
  ScoreboardData,
  SnapshotDiagnosticsData,
  SnapshotDiagnosticsItem,
  StabilityMatrixCell,
  StabilityMatrixData,
  TableData,
  TraceSpanSummary,
  TraceWaterfallRow,
  UsageTableData,
  VerdictTally,
} from "../model/types.ts";
export type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../results/attempt-evidence.ts";

// locale(官方组件 chrome 文案的语言;LocalizedText 的按 locale 解析也用它)
export { DEFAULT_REPORT_LOCALE, resolveLocalizedText, resolveMetricLabel } from "../model/locale.ts";
export type { LocalizedText, ReportLocale } from "../model/locale.ts";

// 稳定配色(自定义组件想与官方组件同键同色时用;seriesClassForKey 配 CSS 的 --nre-series)
export { NRE_PALETTE, colorClassForKey, colorHexForKey, colorIndexForKey, seriesClassForKey } from "../assets/colors.ts";
