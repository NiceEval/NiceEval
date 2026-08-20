/** The exact React-adjacent facade fixed in docs/feature/reports/library.md. */
export {
  Callouts,
  Chart,
  Col,
  Conversation,
  TurnTrace,
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

export {
  HeroCard,
  PoweredBy,
} from "../components/site-components/index.tsx";

export { formatCellText } from "../definition/cell.tsx";
export {
  formatAxisTick,
  formatInstant,
  formatMetricValue,
  formatTimeDistance,
} from "../model/format.ts";
export {
  DEFAULT_REPORT_LOCALE,
  localizedTextEquals,
  resolveLocalizedText,
  resolveMetricLabel,
} from "../model/locale.ts";

export type { Cell, VerdictCounts } from "../definition/cell.tsx";
export type { LocalizedText, ReportLocale } from "../model/locale.ts";
export type { MetricValue } from "../../analysis/index.ts";
