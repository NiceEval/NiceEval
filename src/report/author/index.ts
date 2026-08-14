/**
 * The Report author entry contains only direct Pages and semantic component
 * constructors. Record projections, calculations, legacy execution-bound components, and
 * legacy Page factories intentionally do not cross this boundary.
 */
export {
  defineReport,
} from "../definition.ts";

export type {
  PageDefinition,
  PageEvidence,
  PageLoad,
  PageLoadContext,
  PageParams,
  PageRender,
  EvidenceLocator,
  ParameterizedPageDefinition,
  PlainPageDefinition,
  Report,
  ReportDefinition,
} from "../definition.ts";

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
} from "../components.ts";

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
} from "../components.ts";
