import type { AnalysisSample } from "../../analysis/index.ts";
import type { ProjectedSample, ProjectionAccess } from "../../projection/model.ts";
import type { RecordProjection } from "../../projection/projector.ts";
import type { ReportCalculationResult } from "../execution/results.ts";
import type { ReportDocument } from "../semantic/document.ts";
import type {
  ReportComponentId,
  ReportId,
  ReportInstanceKey,
  ReportRoute,
} from "./identity.ts";
import {
  authorInternalCalculationContents,
  authorInternalDataPlanContents,
  authorInternalDownloadContents,
  authorInternalPageContents,
  authorInternalPageFamilyContents,
  authorInternalPageMemberContents,
  authorInternalReportContents,
  type AnyReportCalculation,
  type Report,
  type ReportCompleteness,
  type ReportCalculationSet,
  type ReportDataPlan,
  type ReportDownload,
  type ReportDownloadFile,
  type ReportPage,
  type ReportPageFamily,
} from "./model.ts";

/**
 * Package-private execution input. It deliberately erases author projection
 * shapes after their exact ReportDataPlan has been checked.
 */
export type ReportHostInputs = Readonly<
  Record<string, ProjectedSample<ProjectionAccess, unknown>>
>;

/** Package-private calculation result lookup for one executing component. */
export type ReportHostCalculations = Readonly<
  Record<string, ReportCalculationResult<unknown>>
>;

export interface ReportCalculationHostContext {
  readonly sample: AnalysisSample;
  readonly inputs: ReportHostInputs;
}

export interface ReportHostContext extends ReportCalculationHostContext {
  readonly calculations: ReportHostCalculations;
}

export interface ReportGraphDescriptor {
  readonly id: ReportId;
  /** Canonical author key to exact registered Calculation mapping. */
  readonly calculations: ReportCalculationSet;
  /** Stable execution view; it never replaces the authored key mapping. */
  readonly calculationsById: readonly AnyReportCalculation[];
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads: readonly ReportDownload[];
}

export interface ReportProjectionDeclaration {
  readonly key: string;
  readonly projection: RecordProjection<ProjectionAccess, unknown>;
}

export interface ReportDataPlanDescriptor {
  readonly declarations: readonly ReportProjectionDeclaration[];
  readonly cardinality: "empty" | "non-empty";
}

export interface ReportComponentReferences {
  readonly inputs?: ReportDataPlan;
  readonly completeness?: ReportCompleteness;
  /** Canonical author key to exact referenced Calculation mapping. */
  readonly calculations: ReportCalculationSet;
  /** Stable execution view; it never replaces the authored key mapping. */
  readonly calculationsById: readonly AnyReportCalculation[];
}

/**
 * The callback is intentionally erased at the host boundary. Its owning
 * Calculation has already passed exact WeakMap identity validation.
 */
export interface ReportCalculationDescriptor extends ReportComponentReferences {
  readonly kind: "calculation";
  readonly id: ReportComponentId;
  readonly inputs: ReportDataPlan;
  readonly calculate: (context: ReportCalculationHostContext) => unknown;
}

export interface ReportPageDescriptor extends ReportComponentReferences {
  readonly kind: "page";
  readonly id: ReportComponentId;
  readonly route: ReportRoute;
  readonly render: (context: ReportHostContext) => ReportDocument;
}

export interface ReportPageFamilyDescriptor extends ReportComponentReferences {
  readonly kind: "page-family";
  readonly id: ReportComponentId;
  readonly instances: (context: ReportHostContext) => Iterable<unknown>;
  readonly key: (instance: unknown) => ReportInstanceKey;
  readonly route: (instance: unknown) => ReportRoute;
  readonly render: (context: ReportHostContext & { readonly instance: unknown }) => ReportDocument;
}

export interface ReportDownloadDescriptor extends ReportComponentReferences {
  readonly kind: "download";
  readonly id: ReportComponentId;
  readonly build: (context: ReportHostContext) => Iterable<ReportDownloadFile>;
}

export type ReportPageMemberDescriptor =
  | ReportPageDescriptor
  | ReportPageFamilyDescriptor;

/**
 * Reads the exact Report graph without putting private callback authority onto
 * the public Report object.
 */
export function reportGraphDescriptor(report: Report): ReportGraphDescriptor {
  const contents = authorInternalReportContents(report);
  return Object.freeze({
    id: report.id,
    calculations: contents.calculations,
    calculationsById: contents.calculationsById,
    pages: Object.freeze([...contents.pages]),
    downloads: Object.freeze([...contents.downloads]),
  });
}

/** Returns the canonical projection declarations for an exact ReportDataPlan. */
export function reportDataPlanDescriptor(plan: ReportDataPlan): ReportDataPlanDescriptor {
  const contents = authorInternalDataPlanContents(plan);
  return Object.freeze({
    declarations: Object.freeze(
      contents.entries.map((entry) =>
        Object.freeze({ key: entry.key, projection: entry.projection })
      ),
    ),
    cardinality: contents.cardinality,
  });
}

export function reportCalculationDescriptor(
  calculation: AnyReportCalculation,
): ReportCalculationDescriptor {
  const contents = authorInternalCalculationContents(calculation);
  return Object.freeze({
    kind: "calculation" as const,
    id: calculation.id,
    ...componentReferences(contents),
    inputs: contents.inputs,
    calculate: (context: ReportCalculationHostContext): unknown =>
      invoke(contents.calculate, context),
  });
}

export function reportPageDescriptor(page: ReportPage): ReportPageDescriptor {
  return pageDescriptor(page, authorInternalPageContents(page));
}

export function reportPageFamilyDescriptor(
  family: ReportPageFamily,
): ReportPageFamilyDescriptor {
  return pageFamilyDescriptor(family, authorInternalPageFamilyContents(family));
}

/** Reads either exact page kind without relying on public object shape. */
export function reportPageMemberDescriptor(
  member: ReportPage | ReportPageFamily,
): ReportPageMemberDescriptor {
  const contents = authorInternalPageMemberContents(member);
  return contents.kind === "page"
    ? pageDescriptor(member as ReportPage, contents.contents)
    : pageFamilyDescriptor(member as ReportPageFamily, contents.contents);
}

export function reportDownloadDescriptor(
  download: ReportDownload,
): ReportDownloadDescriptor {
  const contents = authorInternalDownloadContents(download);
  return Object.freeze({
    kind: "download" as const,
    id: download.id,
    ...componentReferences(contents),
    build: (context: ReportHostContext): Iterable<ReportDownloadFile> =>
      invoke(contents.build, context) as Iterable<ReportDownloadFile>,
  });
}

function pageDescriptor(
  page: ReportPage,
  contents: ReturnType<typeof authorInternalPageContents>,
): ReportPageDescriptor {
  return Object.freeze({
    kind: "page" as const,
    id: page.id,
    route: page.route,
    ...componentReferences(contents),
    render: (context: ReportHostContext): ReportDocument =>
      invoke(contents.render, context) as ReportDocument,
  });
}

function pageFamilyDescriptor(
  family: ReportPageFamily,
  contents: ReturnType<typeof authorInternalPageFamilyContents>,
): ReportPageFamilyDescriptor {
  return Object.freeze({
    kind: "page-family" as const,
    id: family.id,
    ...componentReferences(contents),
    instances: (context: ReportHostContext): Iterable<unknown> =>
      invoke(contents.instances, context) as Iterable<unknown>,
    key: (instance: unknown): ReportInstanceKey =>
      invoke(contents.key, instance) as ReportInstanceKey,
    route: (instance: unknown): ReportRoute =>
      invoke(contents.route, instance) as ReportRoute,
    render: (context: ReportHostContext & { readonly instance: unknown }): ReportDocument =>
      invoke(contents.render, context) as ReportDocument,
  });
}

function componentReferences(
  contents: {
    readonly calculations: ReportCalculationSet;
    readonly calculationsById: readonly AnyReportCalculation[];
    readonly inputs?: ReportDataPlan;
    readonly completeness?: ReportCompleteness;
  },
): ReportComponentReferences {
  return Object.freeze({
    calculations: contents.calculations,
    calculationsById: contents.calculationsById,
    ...(contents.inputs === undefined ? {} : { inputs: contents.inputs }),
    ...(contents.completeness === undefined
      ? {}
      : { completeness: contents.completeness }),
  });
}

function invoke(callback: Function, argument: unknown): unknown {
  return Reflect.apply(callback, undefined, [argument]);
}
