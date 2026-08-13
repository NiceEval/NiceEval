export {
  aggregate,
  costUSD,
  experiment,
  foldEvalVerdict,
  meanMetric,
  passRate,
  totalAttempts,
} from "./aggregate.ts";
export type {
  AggregateRow,
  ClassicCalculation,
  GroupFunction,
} from "./aggregate.ts";

export {
  Bars,
  Col,
  ExperimentScatter,
  ExperimentTable,
  Hero,
  SampleSummary,
  Section,
} from "./components.ts";
export type {
  ClassicBarsProps,
  ClassicColProps,
  ClassicHeroLogo,
  ClassicHeroProps,
  ClassicSectionProps,
} from "./components.ts";

export {
  defineReport,
  isClassicReport,
  classicReportContents,
  isClassicReportDefinition,
  renderClassicDocument,
} from "./define.ts";
export type {
  ClassicCompiledPage,
  ClassicPageRender,
  ClassicReportContents,
  ClassicReportDefinition,
  ClassicReportPageDefinition,
} from "./define.ts";

export { bindClassicHost, classicHostBinding } from "./host.ts";
export type { ClassicHostBinding } from "./host.ts";

export {
  defineComponent,
  Fragment,
  jsx,
  jsxDEV,
  jsxs,
} from "./jsx.ts";
export type {
  ClassicComponent,
  ClassicComponentContext,
  ClassicElement,
} from "./jsx.ts";

export {
  isLocalizedText,
  resolveClassicLocale,
  resolveLocalizedText,
} from "./localize.ts";
export type { ClassicLocale, LocalizedText } from "./localize.ts";

export { metricValue, isMetricValue } from "./metric.ts";
export type { MetricBasis, MetricBetter, MetricBounds, MetricValue } from "./metric.ts";

export {
  CLASSIC_SELECTION_PROFILE_UNAVAILABLE,
  currentDeclarationSelectionOrigin,
  partialClassicSelectionOrigin,
} from "./origin.ts";
export type {
  ClassicExperimentProfile,
  ClassicSelectionNotice,
  ClassicSelectionOrigin,
} from "./origin.ts";

export { buildClassicSample } from "./project.ts";
export type { ClassicProjectedInputs } from "./project.ts";

export { classicAttemptTarget, slotKey, unitKey } from "./sample.ts";
export type {
  AggregationSubject,
  ClassicAttemptRow,
  ClassicAttemptTarget,
  ClassicEvalUnit,
  ClassicExperimentView,
  ClassicMetadataOrigin,
  ClassicRunView,
  ClassicSample,
  ClassicVerdict,
  Sample,
} from "./sample.ts";
