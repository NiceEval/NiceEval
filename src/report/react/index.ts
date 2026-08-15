/**
 * React-adjacent, data-only facade.  It exposes the same closed semantic
 * primitives for hosts embedding Report content; it performs no data loading,
 * Record access, hook-driven recomputation, or browser network work.
 */
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
} from "../classic/primitives.ts";
export type {
  CalloutItem,
  ClassicNode,
  CommandEvidenceItem,
  ConversationEntry,
  DiffFile,
  LayoutProps,
  SourceBlock,
  TabItem,
  WaterfallRow,
} from "../classic/primitives.ts";
export {
  Comparison,
  DataList,
  EvidenceSummary,
  IssueSummary,
  MetricSummary,
} from "../classic/components.ts";
export type {
  ComparisonProps,
  EvidenceEntry,
  MetricSummaryItem,
} from "../classic/components.ts";
export {
  formatAxisTick,
  formatMetricValue,
  presentMetric,
} from "../classic/format.ts";
export {
  DEFAULT_REPORT_LOCALE,
  resolveLocalizedText,
} from "../classic/locale.ts";
export {
  CLASSIC_SERIES_COLORS,
  presentDimension,
  shortestUniqueLabels,
  stableColorIndex,
} from "../classic/presentation.ts";
export {
  bar,
  columns,
  indent,
  padEnd,
  padStart,
  stringWidth,
  wrapText,
} from "../classic/text-layout.ts";
export type { ColumnAlign } from "../classic/text-layout.ts";
export { classicAssetManifest, classicStylesheet } from "../extension/assets.ts";
/** Scoped CSS is a Report-head declaration; it never injects arbitrary DOM style nodes. */
export { Style } from "../definition.ts";
export type { StyleDeclaration } from "../definition.ts";
