/**
 * The Report author entry contains only direct Pages and semantic component
 * constructors. Record projections, calculations, legacy execution-bound components, and
 * legacy Page factories intentionally do not cross this boundary.
 */
export {
  buildReportMeta,
  defineReport,
  isReportDefinition,
  resolveReportTitle,
  Style,
} from "../definition.ts";

export type {
  DimensionPins,
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
  ReportMeta,
  ReportMetaPage,
  ReportShell,
  HeadAttributes,
  HeadAttributeValue,
  HeadTag,
  NormalizedPageDefinition,
  NormalizedParameterizedPageDefinition,
  NormalizedPlainPageDefinition,
  NonEmptyArray,
  StyleDeclaration,
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
  AuthorComposeContext,
  AuthorResolveContext,
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

export {
  isReportElement,
} from "./element.ts";
export type {
  AuthorReportNode,
  ReportElement,
} from "./element.ts";

export {
  REPORT_AUTHOR_EXPORT_MANIFEST,
} from "./manifest.ts";
export type {
  ReportAuthorExportManifest,
  ReportAuthorTypeExport,
  ReportAuthorValueExport,
} from "./manifest.ts";
