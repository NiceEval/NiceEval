// `niceeval/report` is the complete public Report authoring surface. aggregate()
// is intentionally lifted for Page and component callbacks; Sample and other
// Analysis executors stay in `niceeval/analysis`, while public Host composition
// remains the separate `niceeval/report/host` entry.

export {
  aggregate,
  type ClosedRows,
  type MetricValue,
} from "../analysis/index.ts";

export {
  defineReport,
} from "./definition.ts";
export type {
  EvidenceLocator,
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
} from "./definition.ts";

export {
  Bars,
  Callout,
  defineComponent,
  Download,
  Grid,
  Line,
  Scatter,
  Stack,
  Stat,
  Table,
  Text,
} from "./components.ts";
export type {
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
