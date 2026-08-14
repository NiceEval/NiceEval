/**
 * Host-only bridges for the Report author model. They deliberately live
 * outside the public author entry so renderer code can resolve callbacks while
 * the Sample Scope is live without exposing that authority to Report authors.
 */
export {
  isReport,
  reportDefinition,
} from "./definition.ts";

export {
  isReportComponentInvocation,
  reportComponentDescriptor,
} from "./components.ts";

export type {
  ComposeComponentDescriptor,
  PrimitiveComponentDescriptor,
  ReportComponentDescriptor,
} from "./components.ts";
